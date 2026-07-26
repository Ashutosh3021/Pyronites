"""
Project registry API — multi-project support.

Routes (session / admin):
  GET    /api/projects              list current user's projects
  POST   /api/projects              create (max 10)
  GET    /api/projects/{id}         detail
  PATCH  /api/projects/{id}         rename / settings
  POST   /api/projects/{id}/archive soft-delete
  POST   /api/projects/{id}/restore restore archived
  DELETE /api/projects/{id}         hard-delete (body: confirm_name)

{id} may be the internal UUID or the slug (project_id).
"""

import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from backend.core.db import Database
from backend.auth.api_keys import create_api_key
from backend.auth.sessions import validate_session
from backend.api.schemas import ErrorResponse, to_utc_iso, MAX_ID_LEN
from backend.api.auth_deps import resolve_auth, require_scopes
from backend.core.logring import record_event
from backend.core import projects as projmod

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/projects", tags=["projects"])


def get_db() -> Database:
    db = Database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    db.connect()
    try:
        yield db
    finally:
        db.close()


def _resolve_project_id(db: Database) -> str:
    """
    Legacy helper used by /api/keys when no project is specified.

    Returns the slug (``project_id`` column) of the oldest active project,
    or ``"default"`` if none exist yet.
    """
    try:
        cur = db.execute(
            """
            SELECT project_id FROM projects
            WHERE status IS NULL OR status = 'active'
            ORDER BY created_at ASC
            LIMIT 1
            """
        )
        row = cur.fetchone()
        if row and row[0]:
            return row[0]
    except Exception:
        logger.warning("_resolve_project_id failed", exc_info=True)
    return "default"


def _current_user_id(request: Request, db: Database) -> str:
    """Require a dashboard session and return user id."""
    token = request.cookies.get("session_token")
    user = validate_session(db, token) if token else None
    if user is None:
        raise HTTPException(
            status_code=401,
            detail=ErrorResponse(
                code="unauthorized", message="Not authenticated"
            ).model_dump(),
        )
    return user.id


def _public(p: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": p["id"],
        "project_id": p["project_id"],
        "slug": p.get("slug") or p["project_id"],
        "name": p["name"],
        "status": p.get("status") or "active",
        "storage_location": p.get("storage_location") or "local",
        "backup_interval": p.get("backup_interval") or "1hour",
        "enable_public_api": bool(p.get("enable_public_api", True)),
        "created_at": p.get("created_at"),
        "updated_at": p.get("updated_at"),
    }


class CreateProjectBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    slug: Optional[str] = None
    storage_location: str = "local"
    backup_interval: str = "1hour"
    enable_public_api: bool = True
    project_id: Optional[str] = None
    project_name: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("name must not be empty")
        return v


class PatchProjectBody(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    backup_interval: Optional[str] = None
    enable_public_api: Optional[bool] = None


class HardDeleteBody(BaseModel):
    confirm_name: str = Field(..., min_length=1)


@router.get("")
async def list_projects(request: Request, db: Database = Depends(get_db)):
    require_scopes(resolve_auth(request, db), {"read"})
    user_id = _current_user_id(request, db)
    items = projmod.list_projects_for_owner(db, user_id)
    return {"projects": [_public(p) for p in items]}


@router.post("")
async def create_project(
    body: CreateProjectBody,
    request: Request,
    db: Database = Depends(get_db),
):
    require_scopes(resolve_auth(request, db), {"admin"})
    user_id = _current_user_id(request, db)

    name = body.name or body.project_name or ""
    slug = body.slug or body.project_id

    try:
        project = projmod.create_project(
            db,
            owner_id=user_id,
            name=name,
            slug=slug,
            use_meta_db=False,
            storage_location=body.storage_location,
            backup_interval=body.backup_interval,
            enable_public_api=body.enable_public_api,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message=str(e)).model_dump(),
        )
    except Exception:
        logger.error("Failed to create project", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Failed to create project"
            ).model_dump(),
        )

    key_meta = None
    try:
        raw_key, api_key = create_api_key(
            db, project["project_id"], "default", ["read", "write"]
        )
        key_meta = {
            "key": raw_key,
            "id": api_key.id,
            "name": api_key.name,
            "scopes": api_key.scopes,
            "created_at": to_utc_iso(api_key.created_at),
        }
    except ValueError as e:
        logger.warning("Project created but initial API key failed: %s", e)

    record_event("success", f"Project created: {project['name']}")
    out = _public(project)
    if key_meta:
        out["api_key"] = key_meta
    return out


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    request: Request,
    db: Database = Depends(get_db),
):
    require_scopes(resolve_auth(request, db), {"read"})
    user_id = _current_user_id(request, db)
    project = projmod.get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="Project not found").model_dump(),
        )
    if project.get("owner_id") and project["owner_id"] != user_id:
        raise HTTPException(
            status_code=403,
            detail=ErrorResponse(code="forbidden", message="Not project owner").model_dump(),
        )
    return _public(project)


@router.patch("/{project_id}")
async def patch_project(
    project_id: str,
    body: PatchProjectBody,
    request: Request,
    db: Database = Depends(get_db),
):
    require_scopes(resolve_auth(request, db), {"admin"})
    user_id = _current_user_id(request, db)
    project = projmod.get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="Project not found").model_dump(),
        )
    if project.get("owner_id") and project["owner_id"] != user_id:
        raise HTTPException(
            status_code=403,
            detail=ErrorResponse(code="forbidden", message="Not project owner").model_dump(),
        )
    try:
        updated = projmod.update_project(
            db,
            project["id"],
            name=body.name,
            slug=body.slug,
            backup_interval=body.backup_interval,
            enable_public_api=body.enable_public_api,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message=str(e)).model_dump(),
        )
    record_event("info", f"Project updated: {updated['name']}")
    return _public(updated)


@router.post("/{project_id}/archive")
async def archive_project(
    project_id: str,
    request: Request,
    db: Database = Depends(get_db),
):
    require_scopes(resolve_auth(request, db), {"admin"})
    user_id = _current_user_id(request, db)
    project = projmod.get_project(db, project_id)
    if not project:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="Project not found").model_dump(),
        )
    if project.get("owner_id") and project["owner_id"] != user_id:
        raise HTTPException(
            status_code=403,
            detail=ErrorResponse(code="forbidden", message="Not project owner").model_dump(),
        )
    updated = projmod.archive_project(db, project["id"])
    record_event("warning", f"Project archived: {updated['name']}")
    return _public(updated)


@router.post("/{project_id}/restore")
async def restore_project(
    project_id: str,
    request: Request,
    db: Database = Depends(get_db),
):
    require_scopes(resolve_auth(request, db), {"admin"})
    user_id = _current_user_id(request, db)
    try:
        cur = db.execute(
            "SELECT id, owner_id FROM projects WHERE (id = ? OR project_id = ?) AND status = 'archived'",
            (project_id, project_id),
        )
        row = cur.fetchone()
        if not row:
            raise KeyError("not found")
        if row[1] and row[1] != user_id:
            raise HTTPException(
                status_code=403,
                detail=ErrorResponse(code="forbidden", message="Not project owner").model_dump(),
            )
        updated = projmod.restore_project(db, row[0])
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="Archived project not found").model_dump(),
        )
    record_event("info", f"Project restored: {updated['name']}")
    return _public(updated)


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    body: HardDeleteBody,
    request: Request,
    db: Database = Depends(get_db),
):
    require_scopes(resolve_auth(request, db), {"admin"})
    user_id = _current_user_id(request, db)
    cur = db.execute(
        "SELECT id, owner_id, project_name FROM projects WHERE id = ? OR project_id = ? OR slug = ?",
        (project_id, project_id, project_id),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="Project not found").model_dump(),
        )
    if row[1] and row[1] != user_id:
        raise HTTPException(
            status_code=403,
            detail=ErrorResponse(code="forbidden", message="Not project owner").model_dump(),
        )
    try:
        projmod.hard_delete_project(db, row[0], confirm_name=body.confirm_name)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message=str(e)).model_dump(),
        )
    record_event("warning", f"Project hard-deleted: {row[2]}")
    return {"message": "Project deleted"}
