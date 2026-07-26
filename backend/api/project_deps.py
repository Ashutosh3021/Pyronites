"""
Project-scoped request helpers (Phase 2).

- Meta DB (DATABASE_PATH): users, sessions, projects, api_keys
- Project data DB: user tables + storage_files (meta for Default; file for others)

Path ``/api/projects/{id}/...`` selects the project data DB.
Unscoped ``/tables`` etc. use the meta DB (Default / legacy).

Auth always runs against the **meta** DB so sessions and keys stay valid
even when the data connection is a separate project file.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, Generator, Optional

from fastapi import HTTPException, Request

from backend.core.db import Database
from backend.api.schemas import ErrorResponse
from backend.api.auth_deps import resolve_auth
from backend.core import projects as projmod
from backend.core.migrations import run_pending_migrations

logger = logging.getLogger(__name__)

_PROJECT_PATH_RE = re.compile(r"^/api/projects/([^/]+)/")


def meta_db_path() -> str:
    return os.environ.get("DATABASE_PATH", "pyrocore.db")


def migrations_dir() -> str:
    return os.environ.get(
        "MIGRATIONS_DIR",
        str(Path(__file__).resolve().parent.parent / "migrations"),
    )


def extract_project_ref(request: Request) -> Optional[str]:
    m = _PROJECT_PATH_RE.match(request.url.path)
    return m.group(1) if m else None


def _primary_uses_meta(project: Dict[str, Any]) -> bool:
    path = projmod.project_file_path(project["id"])
    return not path.exists()


def open_data_db_for_project(project: Dict[str, Any]) -> Database:
    if _primary_uses_meta(project):
        path = meta_db_path()
    else:
        path = str(projmod.project_file_path(project["id"]))
    db = Database(path)
    db.connect()
    try:
        run_pending_migrations(db, migrations_dir())
    except Exception:
        logger.error("project db migrations failed for %s", path, exc_info=True)
        db.close()
        raise
    return db


def resolve_project_or_404(meta: Database, project_id: str) -> Dict[str, Any]:
    project = projmod.get_project(meta, project_id)
    if not project:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="Project not found").model_dump(),
        )
    if project.get("status") == "archived":
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(code="archived", message="Project is archived").model_dump(),
        )
    return project


def enforce_api_key_project(auth: Optional[Dict[str, Any]], project: Dict[str, Any]) -> None:
    if not auth or auth.get("type") != "api_key":
        return
    key_project = auth.get("project_id")
    if not key_project:
        return
    allowed = {project["id"], project["project_id"], project.get("slug")}
    if key_project not in allowed:
        raise HTTPException(
            status_code=403,
            detail=ErrorResponse(
                code="forbidden",
                message="API key is not valid for this project",
            ).model_dump(),
        )


def get_db(request: Request) -> Generator[Database, None, None]:
    """
    Yield the correct **data** Database for this request.

    Always attaches ``request.state.meta_db`` (and optional ``request.state.project``)
    so callers can run auth against the meta connection:

        resolve_auth(request, getattr(request.state, "meta_db", db))
    """
    meta = Database(meta_db_path())
    meta.connect()
    data: Optional[Database] = None
    project_ref = extract_project_ref(request)

    try:
        request.state.meta_db = meta
        request.state.project = None

        if project_ref:
            project = resolve_project_or_404(meta, project_ref)
            request.state.project = project
            # Key isolation (session users may access any owned project)
            auth = resolve_auth(request, meta)
            enforce_api_key_project(auth, project)
            data = open_data_db_for_project(project)
            yield data
        else:
            yield meta
    finally:
        if data is not None and data is not meta:
            data.close()
        meta.close()


def auth_db(request: Request, fallback: Database) -> Database:
    """Meta DB for auth, falling back to ``fallback`` on legacy unscoped routes."""
    return getattr(request.state, "meta_db", None) or fallback


def current_project_slug(request: Request, fallback_db: Database) -> str:
    """Slug to bind new API keys to (path project or oldest active)."""
    project = getattr(request.state, "project", None)
    if project:
        return project["project_id"]
    try:
        cur = fallback_db.execute(
            """
            SELECT project_id FROM projects
            WHERE status IS NULL OR status = 'active'
            ORDER BY created_at ASC LIMIT 1
            """
        )
        row = cur.fetchone()
        if row and row[0]:
            return row[0]
    except Exception:
        pass
    return "default"
