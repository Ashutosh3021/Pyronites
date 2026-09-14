"""
Authentication endpoints: signup / login / logout / password reset.
"""

import logging
import os
import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator

from backend.auth.users import (
    UserAlreadyExistsError,
    create_user,
    authenticate_user,
    get_user_by_email,
    get_user_by_id,
    set_user_password,
    delete_user,
)
from backend.auth.sessions import (
    create_session,
    revoke_session,
    validate_session,
    revoke_all_sessions_for_user,
)
from backend.auth.password_reset import create_reset_token, consume_reset_token
from backend.core.email_brevo import send_password_reset_email
from backend.core.db import Database, DatabaseError
from backend.api.schemas import ErrorResponse, to_utc_iso
from backend.core.logring import record_event
from backend.core import projects as projmod

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_MAX_AGE = int(os.environ.get("SESSION_MAX_AGE_SECONDS", str(7 * 24 * 3600)))

_FORGOT_LOCK = Lock()
_FORGOT_HITS: dict[str, list[float]] = defaultdict(list)
_FORGOT_WINDOW_SEC = 3600
_FORGOT_MAX_PER_KEY = 5


def _rate_limit_forgot(ip: str, email: str) -> bool:
    now = time.time()
    keys = [f"ip:{ip or 'unknown'}", f"email:{(email or '').lower()}"]
    with _FORGOT_LOCK:
        for key in keys:
            hits = [t for t in _FORGOT_HITS[key] if now - t < _FORGOT_WINDOW_SEC]
            _FORGOT_HITS[key] = hits
            if len(hits) >= _FORGOT_MAX_PER_KEY:
                return False
        for key in keys:
            _FORGOT_HITS[key].append(now)
    return True


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
    samesite = _cookie_samesite(request)
    secure = _cookie_secure(request)
    if samesite == "none":
        secure = True
    response.set_cookie(
        key="session_token",
        value=raw_token,
        httponly=True,
        secure=secure,
        samesite=samesite,  # type: ignore[arg-type]
        path="/",
        max_age=SESSION_MAX_AGE,
    )


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


class _ForgotBody(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()


class _ResetBody(BaseModel):
    token: str = Field(..., min_length=10, max_length=256)
    password: str = Field(..., min_length=8, max_length=256)


_GENERIC_FORGOT_MSG = (
    "If an account exists for that email, we sent password reset instructions."
)


@router.post("/signup")
async def signup(body: _EmailBody, response: Response, request: Request, db: Database = Depends(get_db)):
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
        projmod.set_last_project(db, user.id, default_project["id"])
    except Exception:
        logger.exception("Failed to ensure Default project on signup")

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
    user = authenticate_user(db, body.email, body.password)
    if user is None:
        raise HTTPException(
            status_code=401,
            detail=ErrorResponse(
                code="unauthorized", message="Incorrect email or password"
            ).model_dump(),
        )
    try:
        default_project = projmod.ensure_default_project(db, user.id)
        projmod.set_last_project(db, user.id, default_project["id"])
    except Exception:
        logger.exception("ensure_default_project on login failed")

    session = create_session(db, user.id)
    _set_session_cookie(response, session.token, request)
    record_event("info", f"User logged in: {user.email}")
    return {"email": user.email}


@router.post("/logout")
async def logout(request: Request, response: Response, db: Database = Depends(get_db)):
    token = request.cookies.get("session_token")
    if token:
        try:
            revoke_session(db, token)
        except DatabaseError:
            logger.exception("Failed to revoke session on logout")
        record_event("info", "User logged out")
    _clear_session_cookie(response, request)
    return {"message": "Logged out"}


@router.get("/me")
async def me(request: Request, db: Database = Depends(get_db)):
    token = request.cookies.get("session_token")
    user = validate_session(db, token) if token else None
    if user is None:
        raise HTTPException(
            status_code=401,
            detail=ErrorResponse(
                code="unauthorized", message="Not authenticated"
            ).model_dump(),
        )
    last_project_id = None
    try:
        cur = db.execute("SELECT last_project_id FROM users WHERE id = ?", (user.id,))
        row = cur.fetchone()
        last_project_id = row[0] if row and row[0] else None
    except Exception:
        logger.warning("Failed to read last_project_id for /auth/me", exc_info=True)
    return {
        "authenticated": True,
        "email": user.email,
        "id": user.id,
        "last_project_id": last_project_id,
    }


@router.post("/forgot-password")
async def forgot_password(
    body: _ForgotBody,
    request: Request,
    db: Database = Depends(get_db),
):
    client_ip = request.client.host if request.client else "unknown"
    if not _rate_limit_forgot(client_ip, body.email):
        raise HTTPException(
            status_code=429,
            detail=ErrorResponse(
                code="rate_limited",
                message="Too many reset requests. Try again later.",
            ).model_dump(),
        )

    try:
        user = get_user_by_email(db, body.email)
        if user is not None and user.is_active:
            raw = create_reset_token(db, user.id)
            send_password_reset_email(user.email, raw)
            record_event("info", "Password reset requested")
    except Exception:
        logger.exception("forgot-password processing failed")

    return {"message": _GENERIC_FORGOT_MSG}


@router.post("/reset-password")
async def reset_password(
    body: _ResetBody,
    db: Database = Depends(get_db),
):
    if len(body.password) < 8:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="bad_request",
                message="Password must be at least 8 characters",
            ).model_dump(),
        )

    try:
        user_id = consume_reset_token(db, body.token)
    except DatabaseError:
        logger.exception("reset-password token lookup failed")
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Could not reset password"
            ).model_dump(),
        )

    if user_id is None:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="invalid_token",
                message="This reset link is invalid or has expired",
            ).model_dump(),
        )

    try:
        ok = set_user_password(db, user_id, body.password)
        if not ok:
            raise HTTPException(
                status_code=400,
                detail=ErrorResponse(
                    code="invalid_token",
                    message="This reset link is invalid or has expired",
                ).model_dump(),
            )
        revoke_all_sessions_for_user(db, user_id)
    except HTTPException:
        raise
    except Exception:
        logger.exception("reset-password update failed")
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Could not reset password"
            ).model_dump(),
        )

    record_event("success", "Password reset completed")
    return {"message": "Password updated. You can log in with your new password."}


# ── Account deletion ─────────────────────────────────────────────────────────


class DeleteAccountBody(BaseModel):
    password: str


@router.delete("/account")
async def delete_account(
    body: DeleteAccountBody,
    request: Request,
    response: Response,
    db: Database = Depends(get_db),
):
    """Self-service account deletion. Requires password confirmation."""
    session_token = request.cookies.get("session_token")
    if not session_token:
        raise HTTPException(
            status_code=401,
            detail=ErrorResponse(code="unauthorized", message="Not authenticated").model_dump(),
        )

    user = validate_session(db, session_token)
    if not user:
        raise HTTPException(
            status_code=401,
            detail=ErrorResponse(code="unauthorized", message="Invalid session").model_dump(),
        )

    authenticated = authenticate_user(db, user.email, body.password)
    if not authenticated:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message="Incorrect password").model_dump(),
        )

    user_id = user.id

    # Delete user's projects (hard delete all)
    user_projects = projmod.list_projects_for_owner(db, user_id)
    for proj in user_projects:
        try:
            projmod.hard_delete_project(db, proj["id"], proj["project_name"], owner_id=user_id)
        except Exception:
            logger.warning("Failed to delete project %s during account deletion", proj["id"], exc_info=True)

    # Delete user's API keys
    from backend.auth.api_keys import list_api_keys, revoke_api_key

    keys = list_api_keys(db)
    user_keys = [k for k in keys if k.project_id in [p["id"] for p in user_projects] or k.project_id in [p.get("project_id") for p in user_projects]]
    for key in user_keys:
        try:
            revoke_api_key(db, key.id)
        except Exception:
            logger.warning("Failed to revoke key %s during account deletion", key.id, exc_info=True)

    # Revoke all sessions
    revoke_all_sessions_for_user(db, user_id)

    # Delete the user
    delete_user(db, user_id)

    # Clear session cookie
    _clear_session_cookie(response, request)

    record_event("warning", f"Account deleted: {user.email}")
    return {"message": "Account deleted successfully"}
