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
from backend.core import projects as projmod

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/keys", tags=["api-keys"])


def _auth(request: Request, db: Database):
    return resolve_auth(request, auth_db(request, db))


def _resolve_project_or_403(meta: Database, auth_info, ref: str):
    """
    Resolve a project reference (UUID / project_id / slug) and enforce
    ownership/binding (hardening):

    * session callers may only touch projects they own;
    * API-key callers may only touch the project their key is bound to.

    Returns the canonical project row (``project["id"]`` is the UUID used as
    the canonical key binding going forward).
    """
    project = projmod.get_project(meta, ref)
    if not project:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="Project not found").model_dump(),
        )
    if auth_info and auth_info.get("type") == "session":
        try:
            projmod.ensure_owner(project, auth_info.get("user_id"))
        except PermissionError:
            raise HTTPException(
                status_code=403,
                detail=ErrorResponse(
                    code="forbidden", message="Not project owner"
                ).model_dump(),
            )
    elif auth_info and auth_info.get("type") == "api_key":
        key_project = auth_info.get("project_id")
        if key_project and key_project not in {
            project["id"],
            project["project_id"],
            project.get("slug"),
        }:
            raise HTTPException(
                status_code=403,
                detail=ErrorResponse(
                    code="forbidden",
                    message="API key is not valid for this project",
                ).model_dump(),
            )
    return project


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


def _effective_project_ref(
    project_id: Optional[str], request: Request, meta: Database, auth_info
) -> Optional[str]:
    """Pick the project reference: explicit → session's last project → default."""
    if project_id:
        return project_id
    if auth_info and auth_info.get("type") == "session":
        last = projmod.get_last_project(meta, auth_info.get("user_id"))
        if last and projmod.get_project(meta, last):
            return last
    return current_project_slug(request, meta)


@router.get("")
async def list_keys(
    request: Request,
    db: Database = Depends(get_db),
    project_id: Optional[str] = None,
):
    auth_info = _auth(request, db)
    require_scopes(auth_info, {"read"})
    meta = auth_db(request, db)

    effective_project = _effective_project_ref(project_id, request, meta, auth_info)
    if not effective_project:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="bad_request",
                message="project_id is required for unscoped key listing",
            ).model_dump(),
        )

    project = _resolve_project_or_403(meta, auth_info, effective_project)
    keys = list_api_keys(
        meta,
        project_ids=[project["id"], project["project_id"], project["slug"]],
    )
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
    auth_info = _auth(request, db)
    require_scopes(auth_info, {"admin"})
    meta = auth_db(request, db)
    ref = _effective_project_ref(body.project_id, request, meta, auth_info)
    if not ref:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="bad_request",
                message="project_id is required to create an API key",
            ).model_dump(),
        )
    project = _resolve_project_or_403(meta, auth_info, ref)
    try:
        # Canonical binding: store the project UUID (read paths also accept
        # slug/project_id, so keys created by older clients keep working).
        raw_key, api_key = create_api_key(meta, project["id"], body.name, body.scopes)
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
    auth_info = _auth(request, db)
    require_scopes(auth_info, {"admin"})
    meta = auth_db(request, db)

    # Scope the revoke: a key may only be revoked by the owner of its project
    # (session) or by a key bound to the same project (api_key).
    cur = meta.execute("SELECT id, project_id FROM api_keys WHERE id = ?", (key_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="API key not found").model_dump(),
        )
    _resolve_project_or_403(meta, auth_info, row[1])

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
