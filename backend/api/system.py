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
from pydantic import BaseModel

from backend.core.db import Database
from backend.api.schemas import ErrorResponse
from backend.api.auth_deps import resolve_auth, require_scopes
from backend.api.tables import get_allowed_tables
from backend.core.backup import backup_now, list_backups
from backend.core.logring import get_logs, record_event
from backend.auth.users import set_user_active, delete_user
from backend.auth.sessions import revoke_session

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
            logger.warning("Stats count query failed: %r", sql, exc_info=True)
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
        logger.warning("Could not list backups for stats", exc_info=True)

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
        logger.warning("Could not fetch project info for stats", exp_info=True)

    return {
        "table_count": table_count,
        "file_count": file_count,
        "key_count": key_count,
        "db_size_bytes": db_size,
        "last_backup": last_backup,
        "project": project,
    }
