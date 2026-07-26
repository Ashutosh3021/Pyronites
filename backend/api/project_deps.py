"""
Project-scoped request helpers (Phase 2).

Resolves ``/api/projects/{project_id}/...`` to a registry row + the correct
SQLite ``Database`` (meta DB for the primary/Default project, or
``data/projects/{uuid}.db`` for others).

API keys still validate against the **meta** DB; their ``project_id`` (slug)
must match the path project when present.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, Generator, Optional

from fastapi import Depends, HTTPException, Request

from backend.core.db import Database
from backend.api.schemas import ErrorResponse
from backend.api.auth_deps import resolve_auth, require_scopes
from backend.core import projects as projmod
from backend.core.migrations import run_pending_migrations

logger = logging.getLogger(__name__)


def get_meta_db() -> Generator[Database, None, None]:
    db = Database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    db.connect()
    try:
        yield db
    finally:
        db.close()


def _primary_uses_meta(project: Dict[str, Any]) -> bool:
    """Default/first project keeps data in the meta DB file."""
    path = projmod.project_file_path(project["id"])
    if not path.exists():
        return True
    return False


def open_data_db_for_project(project: Dict[str, Any]) -> Database:
    """
    Open the SQLite file that holds this project's tables/storage metadata.

    Primary projects without a dedicated file use the meta DATABASE_PATH.
    """
    if _primary_uses_meta(project):
        path = os.environ.get("DATABASE_PATH", "pyrocore.db")
    else:
        path = str(projmod.project_file_path(project["id"]))
    db = Database(path)
    db.connect()
    try:
        migrations = os.environ.get(
            "MIGRATIONS_DIR",
            str(Path(__file__).resolve().parent.parent / "migrations"),
        )
        run_pending_migrations(db, migrations)
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
            detail=ErrorResponse(
                code="archived", message="Project is archived"
            ).model_dump(),
        )
    return project


def get_project_context(
    project_id: str,
    request: Request,
    meta: Database = Depends(get_meta_db),
) -> Generator[Dict[str, Any], None, None]:
    """
    FastAPI dependency: auth + project membership + data DB.

    Yields::

        {
          "project": <registry dict>,
          "meta": <meta Database>,
          "db": <project data Database>,
          "auth": <resolve_auth dict>,
        }
    """
    auth = resolve_auth(request, meta)
    require_scopes(auth, {"read"})  # routes still apply tighter scopes

    project = resolve_project_or_404(meta, project_id)

    # API key must belong to this project (slug or uuid).
    if auth and auth.get("type") == "api_key":
        key_project = auth.get("project_id")
        if key_project and key_project not in (
            project["id"],
            project["project_id"],
            project.get("slug"),
        ):
            raise HTTPException(
                status_code=403,
                detail=ErrorResponse(
                    code="forbidden",
                    message="API key is not valid for this project",
                ).model_dump(),
            )

    data_db = open_data_db_for_project(project)
    try:
        yield {
            "project": project,
            "meta": meta,
            "db": data_db,
            "auth": auth,
        }
    finally:
        data_db.close()
