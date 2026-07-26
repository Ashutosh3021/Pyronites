"""
Shared request-authentication resolution used by every API router.

Auth precedence
---------------
1. ``Authorization: Bearer <token>`` header — API key path.
2. ``session_token`` cookie — browser/dashboard session path.
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
    Returns identity dict or None.

    API keys include ``project_id`` (the bound project slug) for isolation.
    Prefer passing the **meta** DB so sessions/keys resolve correctly when the
    route's data connection is a per-project file.
    """
    client_ip = request.client.host if request.client else "unknown"

    auth_header = request.headers.get("Authorization")
    if auth_header:
        if auth_header.startswith("Bearer "):
            api_key = validate_api_key(db, auth_header.split(" ", 1)[1])
            if api_key:
                return {
                    "type": "api_key",
                    "scopes": set(api_key.scopes),
                    "project_id": api_key.project_id,
                }
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

    session_token = request.cookies.get("session_token")
    if session_token:
        user = validate_session(db, session_token)
        if user:
            return {
                "type": "session",
                "scopes": {"read", "write", "admin"},
                "user_id": user.id,
            }
        logger.warning(
            "Invalid session token presented (ip=%s, path=%s)",
            client_ip,
            request.url.path,
        )

    return None
