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
- Signup also ensures a Default project exists for the new user (multi-project).
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
from backend.core import projects as projmod

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

# 7 days — long enough for dashboard use; still re-auth on deploy DB wipe.
SESSION_MAX_AGE = int(os.environ.get("SESSION_MAX_AGE_SECONDS", str(7 * 24 * 3600)))


def _is_https(request: Request | None) -> bool:
    if request is None:
        return False
    if request.headers.get("x-forwarded-proto", "").lower() == "https":
        return True
    return request.url.scheme == "https"


def _cookie_secure(request: Request | None = None) -> bool:
    raw = os.environ.get("SESSION_COOKIE_SECURE")
    if raw is not None:
        return raw.strip().lower() in ("1", "true", "yes", "on")
    return _is_https(request)


def _cookie_samesite(request: Request | None = None) -> str:
    raw = os.environ.get("SESSION_COOKIE_SAMESITE")
    if raw is not None:
        return raw.strip().lower()
    return "none" if _is_https(request) else "lax"


def get_db() -> Database:
    db = Database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    db.connect()
    try:
        yield db
    finally:
        db.close()


def _set_session_cookie(response: Response, raw_token: str, request: Request | None = None) -> None:
    """
    Set httpOnly session cookie for the dashboard.

    Cross-site (Vercel → Render) requires SameSite=None; Secure.
    Chrome also expects the Partitioned attribute for third-party cookies
    (CHIPS). Starlette's set_cookie does not expose Partitioned on all
    versions, so we append a second Set-Cookie header when needed.
    """
    samesite = _cookie_samesite(request)
    secure = _cookie_secure(request)
    if samesite == "none":
        secure = True

    # Primary set via Starlette (works everywhere)
    response.set_cookie(
        key="session_token",
        value=raw_token,
        httponly=True,
        secure=secure,
        samesite=samesite,  # type: ignore[arg-type]
        path="/",
        max_age=SESSION_MAX_AGE,
    )

    # Chrome third-party / CHIPS: Partitioned cookie when cross-site HTTPS
    if samesite == "none" and secure:
        # Override with explicit header so Partitioned is present.
        # Note: multiple Set-Cookie headers for the same name — last wins in
        # practice for browsers that understand Partitioned.
        parts = [
            f"session_token={raw_token}",
            "Path=/",
            "HttpOnly",
            "Secure",
            "SameSite=None",
            "Partitioned",
            f"Max-Age={SESSION_MAX_AGE}",
        ]
        response.headers.append("Set-Cookie", "; ".join(parts))


def _clear_session_cookie(response: Response, request: Request | None = None) -> None:
    samesite = _cookie_samesite(request)
    secure = _cookie_secure(request)
    if samesite == "none":
        secure = True
    response.delete_cookie(
        "session_token",
        path="/",
        secure=secure,
        samesite=samesite,  # type: ignore[arg-type]
    )
    if samesite == "none" and secure:
        response.headers.append(
            "Set-Cookie",
            "session_token=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0",
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
    """Create a new user account, Default project, and start a session."""
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

    default_project = None
    try:
        default_project = projmod.ensure_default_project(db, user.id)
    except Exception:
        logger.error("Failed to ensure Default project on signup", exc_info=True)

    session = create_session(db, user.id)
    _set_session_cookie(response, session.token, request)
    record_event("success", f"User signed up: {user.email}")

    out = {
        "id": user.id,
        "email": user.email,
        "created_at": to_utc_iso(user.created_at),
    }
    if default_project:
        out["default_project"] = {
            "id": default_project["id"],
            "slug": default_project.get("slug") or default_project["project_id"],
            "name": default_project["name"],
        }
    return out


@router.post("/login")
async def login(body: _EmailBody, response: Response, request: Request, db: Database = Depends(get_db)):
    """Authenticate by email/password and set the session cookie."""
    user = authenticate_user(db, body.email, body.password)
    if user is None:
        raise HTTPException(
            status_code=401,
            detail=ErrorResponse(
                code="unauthorized", message="Incorrect email or password"
            ).model_dump(),
        )
    try:
        projmod.ensure_default_project(db, user.id)
    except Exception:
        logger.warning("ensure_default_project on login failed", exc_info=True)

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
    _clear_session_cookie(response, request)
    return {"message": "Logged out"}


@router.get("/me")
async def me(request: Request, db: Database = Depends(get_db)):
    """Return the current session user, or 401 if not authenticated."""
    token = request.cookies.get("session_token")
    user = validate_session(db, token) if token else None
    if user is None:
        raise HTTPException(
            status_code=401,
            detail=ErrorResponse(
                code="unauthorized", message="Not authenticated"
            ).model_dump(),
        )
    return {"authenticated": True, "email": user.email, "id": user.id}
