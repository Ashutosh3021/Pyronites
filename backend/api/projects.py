"""
Project provisioning endpoint.

Single-tenant reality: the running database *is* the project.  This endpoint
records the one ``projects`` row the dashboard reads/writes, and mints the
initial ``default`` API key (read + write) the wizard promises.  It is invoked
exactly once during onboarding; later key management happens via /api/keys.
"""

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator

from backend.core.db import Database
from backend.auth.api_keys import create_api_key
from backend.api.schemas import ErrorResponse, to_utc_iso, MAX_ID_LEN
from backend.api.auth_deps import resolve_auth, require_scopes
from backend.core.logring import record_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/projects", tags=["projects"])


def get_db() -> Database:
    db = Database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    db.connect()
    try:
        yield db
    finally:
        db.close()


# A project id is a URL/identifier slug: letters, digits, dashes; <= 64 chars.
_PROJECT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class CreateProjectBody(BaseModel):
    project_id: str
    project_name: str
    storage_location: str = "local"
    backup_interval: str = "1hour"
    admin_password: Optional[str] = None
    enable_public_api: bool = True

    @field_validator("project_id")
    @classmethod
    def _slug(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if not v or not _PROJECT_ID_RE.match(v) or len(v) > MAX_ID_LEN:
            raise ValueError("project_id must be a slug like 'my-project' (letters, digits, dashes)")
        return v

    @field_validator("project_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("project_name must not be empty")
        return v


def _resolve_project_id(db: Database) -> str:
    """Return the project_id of the (single) projects row, else 'default'."""
    try:
        cur = db.execute("SELECT project_id FROM projects ORDER BY created_at DESC LIMIT 1")
        row = cur.fetchone()
        if row:
            return row[0]
    except Exception:
        pass
    return "default"


@router.post("")
async def create_project(
    body: CreateProjectBody,
    request: Request,
    db: Database = Depends(get_db),
):
    """
    Provision the project: upsert its metadata row and mint an initial API key.

    Requires an authenticated dashboard session.  Returns the project summary
    plus the raw initial key (shown exactly once, like any other key).
    """
    require_scopes(resolve_auth(request, db), {"admin"})
    project_id = _resolve_project_id(db)
    # If a project row already exists (re-running the wizard), upsert by id.
    internal_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)

    try:
        db.execute(
            """
            INSERT INTO projects (id, project_id, project_name, storage_location,
                                  backup_interval, enable_public_api, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
                project_name=excluded.project_name,
                storage_location=excluded.storage_location,
                backup_interval=excluded.backup_interval,
                enable_public_api=excluded.enable_public_api
            """,
            (
                internal_id,
                body.project_id,
                body.project_name,
                body.storage_location,
                body.backup_interval,
                1 if body.enable_public_api else 0,
                created_at.isoformat(),
            ),
        )
    except Exception as e:
        logger.error("Failed to upsert project row", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Failed to create project"
            ).model_dump(),
        )

    # Mint the initial API key (read + write) the wizard advertises.
    try:
        raw_key, api_key = create_api_key(
            db, body.project_id, "default", ["read", "write"]
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message=str(e)).model_dump(),
        )

    record_event("success", f"Project created: {body.project_name}")
    record_event("success", "API key created: default")

    return {
        "project_id": body.project_id,
        "project_name": body.project_name,
        "api_key": {
            "key": raw_key,
            "id": api_key.id,
            "name": api_key.name,
            "scopes": api_key.scopes,
            "created_at": to_utc_iso(api_key.created_at),
        },
    }
