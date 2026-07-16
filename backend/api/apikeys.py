"""
API key management endpoints (create / list / revoke).

Mirrors the CLI ``keys`` commands but over HTTP for the dashboard.  The single
``projects`` row determines which ``project_id`` new keys belong to (single
tenant).  The raw key is returned exactly once at creation; the list endpoint
returns a ``masked`` display string derived from the stored hash so the UI never
sees the secret and it is never logged.
"""

import logging
import os
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator

from backend.core.db import Database
from backend.auth.api_keys import (
    ALLOWED_SCOPES,
    create_api_key,
    list_api_keys,
    revoke_api_key,
)
from backend.api.schemas import ErrorResponse, to_utc_iso, MAX_NAME_LEN
from backend.api.auth_deps import resolve_auth, require_scopes
from backend.api.projects import _resolve_project_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/keys", tags=["api-keys"])


def get_db() -> Database:
    db = Database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    db.connect()
    try:
        yield db
    finally:
        db.close()


def _mask(key_hash: str) -> str:
    """Display-only mask derived from the stored hash (no secret revealed)."""
    return f"pyro_live_{'•' * 10}{key_hash[-4:]}"


class CreateKeyBody(BaseModel):
    name: str
    scopes: List[str]

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("name must not be blank")
        if len(v) > MAX_NAME_LEN:
            raise ValueError(f"name must be {MAX_NAME_LEN} characters or fewer")
        return v

    @field_validator("scopes")
    @classmethod
    def _scopes(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("at least one scope is required")
        invalid = set(v) - ALLOWED_SCOPES
        if invalid:
            raise ValueError(
                f"unknown scope(s): {', '.join(sorted(invalid))}. "
                f"Allowed: {', '.join(sorted(ALLOWED_SCOPES))}"
            )
        return v


@router.get("")
async def list_keys(request: Request, db: Database = Depends(get_db)):
    """List all non-revoked API keys (masked) for the project."""
    require_scopes(resolve_auth(request, db), {"read"})
    keys = list_api_keys(db)
    return [
        {
            "id": k.id,
            "name": k.name,
            "masked": _mask(k.key_hash),
            "scopes": k.scopes,
            "created_at": to_utc_iso(k.created_at),
            "last_used_at": to_utc_iso(k.last_used_at) if k.last_used_at else None,
        }
        for k in keys
    ]


@router.post("")
async def create_key(body: CreateKeyBody, request: Request, db: Database = Depends(get_db)):
    """Create a new API key and return the raw value exactly once."""
    require_scopes(resolve_auth(request, db), {"admin"})
    project_id = _resolve_project_id(db)
    try:
        raw_key, api_key = create_api_key(db, project_id, body.name, body.scopes)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message=str(e)).model_dump(),
        )
    from backend.core.logring import record_event

    record_event("success", f"API key created: {body.name}")
    return {
        "key": raw_key,
        "id": api_key.id,
        "name": api_key.name,
        "scopes": api_key.scopes,
        "created_at": to_utc_iso(api_key.created_at),
    }


@router.delete("/{key_id}")
async def revoke_key(key_id: str, request: Request, db: Database = Depends(get_db)):
    """Revoke (soft-delete) an API key by id."""
    require_scopes(resolve_auth(request, db), {"admin"})
    try:
        revoke_api_key(db, key_id)
    except Exception as e:
        logger.error("Failed to revoke key %s", key_id, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Failed to revoke key"
            ).model_dump(),
        )
    from backend.core.logring import record_event

    record_event("warning", f"API key revoked: {key_id}")
    return {"message": "API key revoked"}
