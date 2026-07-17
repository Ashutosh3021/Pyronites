"""
Authentication endpoints for the dashboard (signup / login / logout).

These are the ONLY public, unauthenticated endpoints in the API — everything
else requires a session cookie (dashboard) or a Bearer API key (external
clients).  Login sets an httpOnly ``session_token`` cookie so the browser
dashboard stays authenticated without re-sending credentials on every request.

Security notes
--------------
- The raw session token is returned to the client exactly once, inside the
  httpOnly cookie.  It is never echoed in a JSON body and is never logged.
- Signup auto-creates a session (common SPA pattern) so a freshly registered
  user can immediately hit authenticated endpoints (e.g. /api/projects)
  without a separate login round-trip.
"""

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, field_validator

from backend.auth.users import (
    UserAlreadyExistsError,
    create_user,
    authenticate_user,
)
from backend.auth.sessions import create_session, revoke_session, validate_session
from backend.core.db import Database, DatabaseError
from backend.api.schemas import ErrorResponse, to_utc_iso
from backend.core.logring import record_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


def _is_https(request: Request | None) -> bool:
    """Best-effort detection of whether the request arrived over HTTPS.

    Behind a platform proxy (Render/Fly) the scheme is reported via the
    ``x-forwarded-proto`` header; fall back to the URL scheme otherwise.
    """
    if request is None:
        return False
    if request.headers.get("x-forwarded-proto", "").lower() == "https":
        return True
    return request.url.scheme == "https"


def _cookie_secure(request: Request | None = None) -> bool:
    """
    Whether the session cookie should be marked ``Secure``.

    Defaults to following the request's scheme: HTTPS -> Secure, HTTP
    (localhost) -> insecure.  This lets a cross-origin HTTPS dashboard work
    without manual env config.  Can be forced with ``SESSION_COOKIE_SECURE``.
    """
    raw = os.environ.get("SESSION_COOKIE_SECURE")
    if raw is not None:
        return raw.strip().lower() in ("1", "true", "yes", "on")
    return _is_https(request)


def _cookie_samesite(request: Request | None = None) -> str:
    """
    SameSite policy for the session cookie.

    Defaults to ``none`` over HTTPS (a cross-origin HTTPS dashboard needs the
    cookie forwarded on cross-site requests) and ``lax`` over plain HTTP
    (localhost).  Can be overridden with ``SESSION_COOKIE_SAMESITE``.
    """
    raw = os.environ.get("SESSION_COOKIE_SAMESITE")
    if raw is not None:
        return raw.strip().lower()
    return "none" if _is_https(request) else "lax"


def get_db() -> Database:
    """Open a single DB connection for the lifetime of the request."""
    db = Database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    db.connect()
    try:
        yield db
    finally:
        db.close()


def _set_session_cookie(response: Response, raw_token: str, request: Request | None = None) -> None:
    """
    Persist the opaque session token as an httpOnly cookie.

    Cookie security is deployment-driven (see ``_cookie_secure`` /
    ``_cookie_samesite``): localhost stays insecure/Lax, but a deployed HTTPS
    backend serving a cross-origin dashboard uses Secure + SameSite=None so the
    browser forwards the cookie and authenticated requests succeed.
    """
    samesite = _cookie_samesite(request)
    secure = _cookie_secure(request)
    if samesite == "none":
        # Browsers refuse SameSite=None unless the cookie is also Secure.
        secure = True
    response.set_cookie(
        key="session_token",
        value=raw_token,
        httponly=True,
        secure=secure,
        samesite=samesite,
        path="/",
    )


class _EmailBody(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()


@router.post("/signup")
async def signup(body: _EmailBody, response: Response, request: Request, db: Database = Depends(get_db)):
    """Create a new user account and start a session for them."""
    try:
        user = create_user(db, body.email, body.password)
    except UserAlreadyExistsError:
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(
                code="already_exists",
                message="An account with that email already exists",
            ).model_dump(),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message=str(e)).model_dump(),
        )

    # Auto-login: a brand-new user should be able to continue straight to the
    # project wizard without a second credential prompt.
    session = create_session(db, user.id)
    _set_session_cookie(response, session.token, request)
    record_event("success", f"User signed up: {user.email}")
    return {
        "id": user.id,
        "email": user.email,
        "created_at": to_utc_iso(user.created_at),
    }


@router.post("/login")
async def login(body: _EmailBody, response: Response, request: Request, db: Database = Depends(get_db)):
    """Authenticate by email/password and set the session cookie."""
    user = authenticate_user(db, body.email, body.password)
    if user is None:
        # Generic message — never reveal whether the email exists.
        raise HTTPException(
            status_code=401,
            detail=ErrorResponse(
                code="unauthorized", message="Incorrect email or password"
            ).model_dump(),
        )
    session = create_session(db, user.id)
    _set_session_cookie(response, session.token, request)
    record_event("info", f"User logged in: {user.email}")
    return {"email": user.email}


@router.post("/logout")
async def logout(request: Request, response: Response, db: Database = Depends(get_db)):
    """Revoke the current session and clear the cookie."""
    token = request.cookies.get("session_token")
    if token:
        try:
            revoke_session(db, token)
        except DatabaseError:
            logger.warning("Failed to revoke session on logout", exc_info=True)
        record_event("info", "User logged out")
    response.delete_cookie(
        "session_token",
        path="/",
        secure=_cookie_secure(request),
        samesite=_cookie_samesite(request),
    )
    return {"message": "Logged out"}


@router.get("/me")
async def me(request: Request, db: Database = Depends(get_db)):
    """Return the current session user, or 401 if not authenticated.

    The dashboard uses this to decide whether to show the app or redirect to
    /login.  It relies only on the session cookie, so it works for the
    browser SPA without exposing the token anywhere.
    """
    token = request.cookies.get("session_token")
    user = validate_session(db, token) if token else None
    if user is None:
        raise HTTPException(
            status_code=401,
            detail=ErrorResponse(
                code="unauthorized", message="Not authenticated"
            ).model_dump(),
        )
    return {"authenticated": True, "email": user.email}
