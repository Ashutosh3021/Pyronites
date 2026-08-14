"""
API key management (create / list / revoke).

.. deprecated::
   Unscoped ``/api/keys`` endpoints are deprecated. They operate exclusively
   against the **meta** DB keys table and will be removed in a future release.
   Clients must migrate to the project-scoped plane::

       /api/projects/{project_id}/api/keys

Keys always live in the **meta** DB. When the path is project-scoped, list/create
are limited to that project's slug.
"""

import logging
from typing import List, Optional

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
from backend.api.project_deps import get_db, auth_db, current_project_slug

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/keys", tags=["api-keys"])


def _auth(request: Request, db: Database):
    return resolve_auth(request, auth_db(request, db))


def _mask(key_hash: str) -> str:
    return f"pyro_live_{'•' * 10}{key_hash[-4:]}"


class CreateKeyBody(BaseModel):
    name: str
    scopes: List[str]
    project_id: Optional[str] = None

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

    @field_validator("project_id")
    @classmethod
    def _project_id(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = (v or "").strip()
            if not v:
                raise ValueError("project_id must not be blank")
        return v


class ListKeysQuery(BaseModel):
    project_id: Optional[str] = None


@router.get("")
async def list_keys(
    request: Request,
    db: Database = Depends(get_db),
    project_id: Optional[str] = None,
):
    require_scopes(_auth(request, db), {"read"})
    meta = auth_db(request, db)

    effective_project = project_id or current_project_slug(request, meta)
    if not effective_project:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="bad_request",
                message="project_id is required for unscoped key listing",
            ).model_dump(),
        )

    keys = list_api_keys(meta, project_id=effective_project)
    return [
        {
            "id": k.id,
            "name": k.name,
            "project_id": k.project_id,
            "masked": _mask(k.key_hash),
            "scopes": k.scopes,
            "created_at": to_utc_iso(k.created_at),
            "last_used_at": to_utc_iso(k.last_used_at) if k.last_used_at else None,
        }
        for k in keys
    ]


@router.post("")
async def create_key(body: CreateKeyBody, request: Request, db: Database = Depends(get_db)):
    require_scopes(_auth(request, db), {"admin"})
    meta = auth_db(request, db)
    project_id = body.project_id or current_project_slug(request, meta)
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="bad_request",
                message="project_id is required to create an API key",
            ).model_dump(),
        )
    try:
        raw_key, api_key = create_api_key(meta, project_id, body.name, body.scopes)
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
        "project_id": api_key.project_id,
        "scopes": api_key.scopes,
        "created_at": to_utc_iso(api_key.created_at),
    }


@router.delete("/{key_id}")
async def revoke_key(key_id: str, request: Request, db: Database = Depends(get_db)):
    require_scopes(_auth(request, db), {"admin"})
    meta = auth_db(request, db)
    try:
        revoke_api_key(meta, key_id)
    except Exception:
        logger.error("Failed to revoke key %s", key_id, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(code="internal_error", message="Failed to revoke key").model_dump(),
        )
    from backend.core.logring import record_event

    record_event("warning", f"API key revoked: {key_id}")
    return {"message": "API key revoked"}
