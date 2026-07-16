"""
Shared request-authentication resolution used by every API router.

Both ``tables.py`` and ``storage.py`` previously contained near-identical
copies of this logic.  Duplicated auth code is a drift risk: a change to one
copy (e.g. adding a new auth mechanism) silently fails to apply to the other.
This module is the single place that decides "who is this request?".

Auth precedence
---------------
1. ``Authorization: Bearer <token>`` header — API key path.
2. ``session_token`` cookie — browser/dashboard session path.

If neither is present (or both fail validation) ``resolve_auth`` returns
``None`` and the caller must raise HTTP 401.

Logging
-------
Failed auth attempts are logged at WARNING level so deployment logs capture
them for intrusion-detection analysis.  We never log the token/key value
itself — only the fact that validation failed and from which IP (if available).
"""

import logging
from typing import Any, Dict, Optional, Set

from fastapi import Request, HTTPException

from backend.auth.api_keys import validate_api_key
from backend.auth.sessions import validate_session
from backend.core.db import Database
from backend.api.schemas import ErrorResponse

logger = logging.getLogger(__name__)


def require_scopes(
    auth_info: Optional[Dict[str, Any]],
    required_scopes: Set[str],
) -> Dict[str, Any]:
    """
    Raise HTTP 401/403 if ``auth_info`` is missing or lacks ``required_scopes``.

    This is the single scope-enforcement helper shared by every router, so the
    401/403 envelope can never drift between ``tables.py`` and ``storage.py``.

    Returns ``auth_info`` unchanged on success.
    """
    if not auth_info:
        raise HTTPException(
            status_code=401,
            detail=ErrorResponse(
                code="unauthorized",
                message="Missing or invalid authentication",
            ).model_dump(),
        )
    if not required_scopes.issubset(auth_info["scopes"]):
        raise HTTPException(
            status_code=403,
            detail=ErrorResponse(
                code="forbidden",
                message="Insufficient permissions",
            ).model_dump(),
        )
    return auth_info


def resolve_auth(request: Request, db: Database) -> Optional[Dict[str, Any]]:
    """
    Determine the identity and permissions of the incoming request.

    Checks the Bearer token first (API key path used by external clients),
    then the session cookie (browser dashboard path).  Returns a dict with
    ``type`` and ``scopes`` when a valid credential is found, otherwise
    ``None`` — the caller is then responsible for returning HTTP 401.

    This function intentionally does **not** raise on invalid credentials —
    it returns ``None`` so a route can choose to accept unauthenticated
    requests for public endpoints if it ever needs to.

    Args:
        request: The incoming FastAPI ``Request``.
        db: An active ``Database`` connection owned by the caller's route.
            This avoids opening a second connection purely for auth.

    Returns:
        ``{"type": "api_key"|"session", "scopes": set[str]}`` on success,
        or ``None`` if no valid credential was found.
    """
    client_ip = request.client.host if request.client else "unknown"

    # ── API key ────────────────────────────────────────────────────────────
    auth_header = request.headers.get("Authorization")
    if auth_header:
        if auth_header.startswith("Bearer "):
            api_key = validate_api_key(db, auth_header.split(" ", 1)[1])
            if api_key:
                return {"type": "api_key", "scopes": set(api_key.scopes)}
            # Present but invalid — log for intrusion detection
            logger.warning(
                "Invalid API key presented (ip=%s, path=%s)",
                client_ip,
                request.url.path,
            )
        else:
            logger.warning(
                "Malformed Authorization header (ip=%s, path=%s)",
                client_ip,
                request.url.path,
            )

    # ── Session cookie ─────────────────────────────────────────────────────
    session_token = request.cookies.get("session_token")
    if session_token:
        user = validate_session(db, session_token)
        if user:
            return {"type": "session", "scopes": {"read", "write", "admin"}}
        # Token present but expired/invalid
        logger.warning(
            "Invalid session token presented (ip=%s, path=%s)",
            client_ip,
            request.url.path,
        )

    return None
