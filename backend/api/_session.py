"""
Session cookie + auth rate-limit helpers shared by the auth routers.

These live here so ``backend.api.auth`` and ``backend.api.oauth`` cannot drift
into two different cookie implementations. Cookie attributes are decided per
request because the app is deployed split (backend on Render, dashboard on
Vercel) and the right SameSite/Secure pair depends on the scheme the request
actually arrived over.

Env vars are read at request time, not import time, so tests can monkeypatch
them.
"""

import os
import time

from fastapi import HTTPException, Request, Response

from backend.api.schemas import ErrorResponse

SESSION_COOKIE_NAME = "session_token"

# Rate-limit windows in seconds.
AUTH_RATE_WINDOW = 60
OAUTH_RATE_WINDOW = 60


def get_session_max_age() -> int:
    return int(os.environ.get("SESSION_MAX_AGE_SECONDS", str(7 * 24 * 3600)))


def get_auth_rate_limit() -> int:
    return int(os.environ.get("AUTH_RATE_LIMIT_PER_MIN", "20"))


def get_oauth_rate_limit() -> int:
    return int(os.environ.get("OAUTH_RATE_LIMIT_PER_MIN", "30"))


def get_forgot_rate_limit() -> int:
    return int(os.environ.get("FORGOT_RATE_LIMIT_PER_HOUR", "5"))


def rate_limit_response(
    retry_after: int,
    limit: int,
    remaining: int,
    reset_at: float,
) -> HTTPException:
    """Build a 429 HTTPException with Retry-After and X-RateLimit-* headers."""
    return HTTPException(
        status_code=429,
        detail=ErrorResponse(
            code="rate_limited",
            message=f"Rate limit exceeded. Try again in {retry_after}s.",
        ).model_dump(),
        headers={
            "Retry-After": str(retry_after),
            "X-RateLimit-Limit": str(limit),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset": str(int(reset_at)),
        },
    )


def retry_after_seconds(reset_at: float) -> int:
    return max(1, int(reset_at - time.time()))


def is_https(request: Request | None) -> bool:
    if request is None:
        return False
    if request.headers.get("x-forwarded-proto", "").lower() == "https":
        return True
    return request.url.scheme == "https"


def cookie_secure(request: Request | None = None) -> bool:
    raw = os.environ.get("SESSION_COOKIE_SECURE")
    if raw is not None:
        return raw.strip().lower() in ("1", "true", "yes", "on")
    return is_https(request)


def cookie_samesite(request: Request | None = None) -> str:
    raw = os.environ.get("SESSION_COOKIE_SAMESITE")
    if raw is not None:
        return raw.strip().lower()
    return "none" if is_https(request) else "lax"


def set_session_cookie(
    response: Response,
    raw_token: str,
    request: Request | None = None,
) -> None:
    """Attach the opaque session token to the response.

    SameSite=None always forces Secure, per the browser rule that a
    cross-site cookie without Secure is rejected outright.
    """
    samesite = cookie_samesite(request)
    secure = cookie_secure(request)
    if samesite == "none":
        secure = True
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        secure=secure,
        samesite=samesite,  # type: ignore[arg-type]
        path="/",
        max_age=get_session_max_age(),
    )


def clear_session_cookie(
    response: Response,
    request: Request | None = None,
) -> None:
    samesite = cookie_samesite(request)
    secure = cookie_secure(request)
    if samesite == "none":
        secure = True
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        secure=secure,
        samesite=samesite,  # type: ignore[arg-type]
    )
    if samesite == "none" and secure:
        # CHIPS opt-in so the cookie is partitioned correctly even when the
        # dashboard moves back to a same-site origin.
        response.headers.append(
            "Set-Cookie",
            f"{SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; "
            "Partitioned; Max-Age=0",
        )