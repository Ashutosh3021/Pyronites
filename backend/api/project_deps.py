"""
Project-scoped request helpers.

- Meta DB (DATABASE_PATH): users, sessions, projects, api_keys
- Project data DB: user tables + storage_files

Isolation rules
---------------
* Default project (slug ``default``) may keep using the meta DB when no
  dedicated file exists (legacy single-tenant data).
* Every other project ALWAYS uses ``data/projects/{uuid}.db``. If the file
  is missing it is created and migrated — we never fall back to the meta DB
  for non-default projects (that caused shared tables across projects).

Path ``/api/projects/{id}/...`` selects the project data DB.
Unscoped ``/tables`` etc. use the meta DB (Default / legacy client).
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, Generator, Optional

from fastapi import Depends, HTTPException, Request

from backend.core.db import Database
from backend.api.schemas import ErrorResponse
from backend.api.auth_deps import resolve_auth, require_scopes
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


def _is_legacy_default(project: Dict[str, Any]) -> bool:
    """True only for Default with no dedicated file yet (shared meta tables)."""
    slug = (project.get("slug") or project.get("project_id") or "").lower()
    if slug != "default":
        return False
    path = projmod.project_file_path(project["id"])
    return not path.exists()


def open_data_db_for_project(project: Dict[str, Any]) -> Database:
    """
    Open the SQLite file that holds this project's user tables / storage.

    Non-default projects never share the meta database.
    """
    if _is_legacy_default(project):
        path = meta_db_path()
        logger.debug("Project %s uses meta DB (legacy Default)", project.get("id"))
    else:
        file_path = projmod.project_file_path(project["id"])
        file_path.parent.mkdir(parents=True, exist_ok=True)
        path = str(file_path)
        if not file_path.exists():
            logger.info(
                "Creating dedicated project DB for %s (%s)",
                project.get("name") or project.get("project_id"),
                path,
            )

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


def get_meta_db() -> Generator[Database, None, None]:
    db = Database(meta_db_path())
    db.connect()
    try:
        yield db
    finally:
        db.close()


def get_project_context(
    project_id: str,
    request: Request,
    meta: Database = Depends(get_meta_db),
) -> Generator[Dict[str, Any], None, None]:
    auth = resolve_auth(request, meta)
    require_scopes(auth, {"read"})

    project = resolve_project_or_404(meta, project_id)
    enforce_api_key_project(auth, project)

    data_db = open_data_db_for_project(project)
    try:
        request.state.meta_db = meta
        request.state.project = project
        yield {
            "project": project,
            "meta": meta,
            "db": data_db,
            "auth": auth,
        }
    finally:
        data_db.close()


def get_db(request: Request) -> Generator[Database, None, None]:
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
    return getattr(request.state, "meta_db", None) or fallback


def current_project_slug(request: Request, fallback_db: Database) -> str:
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
