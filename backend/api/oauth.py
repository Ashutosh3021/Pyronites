"""
OAuth 2.0 authorization-code endpoints (Google, GitHub).

The callback lives on the **backend**, not the dashboard, because the session
cookie is a backend cookie and the two are deployed on different origins
(Render + Vercel). The provider redirects here, we set the cookie, then bounce
to the dashboard.
"""

import logging
import os
import urllib.parse
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from backend.api._session import (
    OAUTH_RATE_WINDOW,
    get_oauth_rate_limit,
    rate_limit_response,
    retry_after_seconds,
    set_session_cookie,
)
from backend.api.schemas import ErrorResponse
from backend.auth import oauth as oauthmod
from backend.auth.oauth import OAuthError
from backend.auth.sessions import create_session
from backend.core import projects as projmod
from backend.core.db import Database, DatabaseError, acquire_database, release_database
from backend.core.logring import record_event
from backend.core.rate_limit import check_and_record, get_client_ip

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/oauth", tags=["auth"])


def get_db() -> Database:
    db = acquire_database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    try:
        yield db
    finally:
        release_database(db)


# User-safe error copy. Upstream detail (token endpoint bodies, HTTP codes,
# provider stack traces) goes to the log only — it would otherwise be appended
# to a URL the browser displays and may leak through the referrer header.
_ERROR_MESSAGES = {
    "access_denied": "Sign-in was cancelled. Nothing was changed.",
    "invalid_state": "That sign-in link expired or was already used. Please try again.",
    "invalid_code": "The sign-in could not be completed. Please try again.",
    "provider_unavailable": "The sign-in provider could not be reached. Please try again.",
    "unverified_email": "Your provider account's email is not verified. Verify it, then try again.",
    "no_email": "Your provider account does not expose an email address. Add one and try again.",
    "disabled": "This account has been disabled.",
    "unknown_error": "Sign-in could not be completed. Please try again.",
}


def _frontend_base(request: Request) -> str:
    """Dashboard origin — where the browser should end up after the round trip."""
    raw = (os.environ.get("FRONTEND_ORIGIN") or "").strip()
    if raw:
        first = raw.split(",")[0].strip()
        if first:
            return first.rstrip("/")
    return str(request.base_url).rstrip("/")


def _redirect_base(request: Request) -> str:
    """Backend origin the provider sends the user back to."""
    raw = (os.environ.get("OAUTH_REDIRECT_BASE_URL") or "").strip()
    if raw:
        return raw.rstrip("/")
    return str(request.base_url).rstrip("/")


def _callback_url(request: Request, provider: str) -> str:
    return f"{_redirect_base(request)}/auth/oauth/{provider}/callback"


def _fail(request: Request, code: str) -> RedirectResponse:
    """Bounce back to the dashboard login page carrying a machine-readable code."""
    target = f"{_frontend_base(request)}/login"
    if code:
        target = f"{target}?{urllib.parse.urlencode({'oauth_error': code})}"
    return RedirectResponse(target, status_code=302)


def _http_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail=ErrorResponse(code=code, message=message).model_dump(),
    )


def _require_provider(provider_id: str) -> dict:
    provider = oauthmod.get_provider(provider_id)
    if provider is None:
        raise _http_error(
            404, "unknown_provider", f"Unknown sign-in provider '{provider_id}'."
        )
    return provider


def _require_configured(provider: dict) -> None:
    if not oauthmod.is_provider_configured(provider["id"]):
        raise _http_error(
            503,
            "provider_not_configured",
            f"{provider['name']} sign-in is not configured on this server. "
            "An administrator needs to set the provider's client id and secret.",
        )


def _limit(request: Request, db: Database, bucket: str) -> None:
    limit = get_oauth_rate_limit()
    allowed, remaining, reset_at = check_and_record(
        db, f"ip:{get_client_ip(request)}", bucket, limit, OAUTH_RATE_WINDOW
    )
    if not allowed:
        raise rate_limit_response(retry_after_seconds(reset_at), limit, remaining, reset_at)


@router.get("/providers")
async def list_providers():
    """Which providers this server can offer, and whether each is usable."""
    return {"providers": oauthmod.list_providers()}


@router.get("/{provider}/start")
async def start(provider: str, request: Request, db: Database = Depends(get_db)):
    """Mint a state token and redirect to the provider's consent screen."""
    provider = provider.lower()
    meta = _require_provider(provider)
    _require_configured(meta)
    _limit(request, db, "auth:oauth_start")

    redirect_uri = _callback_url(request, provider)
    try:
        state = oauthmod.create_oauth_state(db, provider, redirect_uri)
        url = oauthmod.build_authorize_url(provider, redirect_uri, state)
    except DatabaseError:
        logger.exception("Failed to start OAuth flow for %s", provider)
        raise _http_error(500, "internal_error", "Could not start sign-in.")

    return RedirectResponse(url, status_code=302)


@router.get("/{provider}/callback")
async def callback(
    provider: str,
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: Database = Depends(get_db),
):
    """Exchange the code, resolve the account, mint a session, redirect home."""
    provider = provider.lower()
    meta = _require_provider(provider)
    _require_configured(meta)

    if error:
        logger.info("OAuth callback for %s returned error=%s", provider, error)
        return _fail(request, "access_denied" if error == "access_denied" else "unknown_error")

    if not code or not state:
        return _fail(request, "invalid_code")

    _limit(request, db, "auth:oauth_callback")

    try:
        redirect_uri = oauthmod.consume_oauth_state(db, provider, state)
    except DatabaseError:
        logger.exception("OAuth state lookup failed for %s", provider)
        return _fail(request, "unknown_error")

    if not redirect_uri:
        logger.warning("Rejected OAuth callback for %s: bad, reused or expired state", provider)
        return _fail(request, "invalid_state")

    try:
        access_token = oauthmod.exchange_code_for_token(provider, code, redirect_uri)
        profile = oauthmod.fetch_profile(provider, access_token)
    except OAuthError:
        logger.exception("OAuth upstream call failed for %s", provider)
        return _fail(request, "provider_unavailable")

    try:
        resolution = oauthmod.resolve_oauth_user(db, provider, profile)
    except OAuthError as exc:
        logger.info("OAuth sign-in refused for %s: %s", provider, exc)
        message = str(exc)
        if "not verified" in message:
            return _fail(request, "unverified_email")
        if "does not expose an email" in message:
            return _fail(request, "no_email")
        if "disabled" in message:
            return _fail(request, "disabled")
        return _fail(request, "unknown_error")

    user = resolution.user

    if resolution.outcome == "created":
        try:
            default_project = projmod.ensure_default_project(db, user.id)
            projmod.set_last_project(db, user.id, default_project["id"])
        except Exception:
            logger.exception("Failed to ensure Default project on OAuth signup")

    session = create_session(db, user.id)
    response = RedirectResponse(f"{_frontend_base(request)}/", status_code=302)
    set_session_cookie(response, session.token, request)

    record_event(
        "success" if resolution.outcome == "created" else "info",
        f"OAuth sign-in ({provider}, {resolution.outcome}): {user.email}",
    )
    logger.info("OAuth sign-in ok provider=%s outcome=%s", provider, resolution.outcome)
    return response


@router.get("/errors")
async def error_messages():
    """User-safe copy for the login page, keyed by the code in ?oauth_error=."""
    return {"errors": _ERROR_MESSAGES}