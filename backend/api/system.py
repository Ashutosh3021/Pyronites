"""
System / dashboard-support endpoints.

Aggregates the read-only stats the Overview/Settings/Logs/Authentication pages
need, plus an operator backup trigger.  Most are session-authenticated; the
backup trigger requires the ``admin`` scope (it performs a filesystem copy).
"""

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.core.db import Database
from backend.api.schemas import ErrorResponse
from backend.api.auth_deps import resolve_auth, require_scopes
from backend.api.tables import get_allowed_tables
from backend.core.backup import backup_now, list_backups
from backend.core.logring import get_logs, record_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["system"])


def get_db() -> Database:
    db = Database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    db.connect()
    try:
        yield db
    finally:
        db.close()


def _backup_dir() -> str:
    db_path = os.environ.get("DATABASE_PATH", "pyrocore.db")
    return str(Path(db_path).parent / "backups")


@router.get("/stats")
async def stats(request: Request, db: Database = Depends(get_db)):
    """Aggregate counts/sizes for the Overview and Settings pages."""
    require_scopes(resolve_auth(request, db), {"read"})

    table_count = len(get_allowed_tables(db))

    def _count(sql: str) -> int:
        try:
            cur = db.execute(sql)
            row = cur.fetchone()
            return int(row[0]) if row else 0
        except Exception:
            return 0

    file_count = _count("SELECT COUNT(*) FROM storage_files")
    key_count = _count("SELECT COUNT(*) FROM api_keys WHERE is_revoked = 0")

    db_path = os.environ.get("DATABASE_PATH", "pyrocore.db")
    db_size = os.path.getsize(db_path) if os.path.exists(db_path) else 0

    last_backup = None
    try:
        backups = list_backups(_backup_dir())
        if backups:
            last_backup = backups[0].created_at.isoformat().replace("+00:00", "Z")
    except Exception:
        pass

    project = None
    try:
        cur = db.execute(
            "SELECT project_id, project_name, backup_interval, created_at "
            "FROM projects ORDER BY created_at DESC LIMIT 1"
        )
        row = cur.fetchone()
        if row:
            project = {
                "project_id": row[0],
                "project_name": row[1],
                "backup_interval": row[2],
                "created_at": row[3],
            }
    except Exception:
        pass

    return {
        "table_count": table_count,
        "file_count": file_count,
        "key_count": key_count,
        "db_size_bytes": db_size,
        "last_backup": last_backup,
        "project": project,
    }


@router.post("/backup")
async def trigger_backup(request: Request, db: Database = Depends(get_db)):
    """Take an immediate backup of the live database (admin only)."""
    require_scopes(resolve_auth(request, db), {"admin"})
    db_path = os.environ.get("DATABASE_PATH", "pyrocore.db")
    try:
        backup_file = await _run_backup(db_path, _backup_dir())
    except Exception as e:
        logger.error("Manual backup failed", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="backup_failed", message=f"Backup failed: {e}"
            ).model_dump(),
        )
    record_event("success", "Backup completed")
    return {"path": str(backup_file), "created_at": _now_iso()}


async def _run_backup(db_path: str, backup_dir: str):
    import asyncio

    return await asyncio.to_thread(backup_now, db_path, backup_dir)


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@router.get("/backups")
async def list_backups_endpoint(request: Request, db: Database = Depends(get_db)):
    """List recent backups (newest first)."""
    require_scopes(resolve_auth(request, db), {"read"})
    try:
        backups = list_backups(_backup_dir())
    except Exception:
        return []
    return [
        {
            "path": str(b.path),
            "name": b.path.name,
            "created_at": b.created_at.isoformat().replace("+00:00", "Z"),
            "size_bytes": b.size_bytes,
        }
        for b in backups
    ]


@router.get("/logs")
async def logs(request: Request, db: Database = Depends(get_db)):
    """Return recent system events (newest first) for the Logs page."""
    require_scopes(resolve_auth(request, db), {"read"})
    return get_logs()


@router.get("/users")
async def users(request: Request, db: Database = Depends(get_db)):
    """List dashboard users for the Authentication page."""
    require_scopes(resolve_auth(request, db), {"read"})
    try:
        cur = db.execute(
            "SELECT id, email, created_at, is_active FROM users ORDER BY created_at DESC"
        )
        return [
            {
                "id": r[0],
                "email": r[1],
                "created_at": r[2],
                "is_active": bool(r[3]),
            }
            for r in cur.fetchall()
        ]
    except Exception as e:
        logger.error("Failed to list users", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Failed to list users"
            ).model_dump(),
        )


@router.get("/sessions")
async def sessions(request: Request, db: Database = Depends(get_db)):
    """List active sessions for the Authentication page."""
    require_scopes(resolve_auth(request, db), {"read"})
    try:
        cur = db.execute(
            """
            SELECT s.id, u.email, s.created_at, s.expires_at
            FROM sessions s JOIN users u ON s.user_id = u.id
            ORDER BY s.created_at DESC
            """
        )
        return [
            {"id": r[0], "user_email": r[1], "created_at": r[2], "expires_at": r[3]}
            for r in cur.fetchall()
        ]
    except Exception as e:
        logger.error("Failed to list sessions", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Failed to list sessions"
            ).model_dump(),
        )
