"""
SQL Editor API — raw SQL execution against the live project database.

This is the backend half of the dashboard's SQL editor (ARCHITECTURE.md §5).
It is intentionally powerful: it runs arbitrary SQL, so it is gated behind the
``admin`` scope and is only reachable by dashboard sessions or admin-scoped API
keys.

Safety guard (ARCHITECTURE.md §2)
---------------------------------
Before any statement that could *modify* data (``DROP``/``DELETE``/``TRUNCATE``
and friends) is executed, an automatic backup of the live database is taken via
the same ``backup_now()`` used by the scheduled backup loop.  The backup opens
its own read-only connection to the file, so it never contends on the route's
``Database`` connection — there is no deadlock risk.

Connection design: every route opens exactly ONE ``Database`` connection via
``get_db``; auth and execution share that same connection, matching the pattern
used by ``storage.py`` and ``tables.py``.
"""
import asyncio
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.core.db import Database, DatabaseError
from backend.core.backup import backup_now
from backend.api.schemas import ErrorResponse
from backend.api.auth_deps import resolve_auth, require_scopes

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sql", tags=["sql"])

# Statements that only read (never trigger the auto-backup guard).
_READONLY_KEYWORDS = {"SELECT", "WITH", "EXPLAIN", "VALUES", "PRAGMA"}

# Hard cap on the number of statements accepted in a single request, to bound
# the cost of statement splitting / execution.
MAX_STATEMENTS = 50


class SqlExecuteRequest(BaseModel):
    """Request body for ``POST /sql/execute``."""

    sql: str = Field(
        ...,
        # Upper bound guards against absurd payloads (a multi-MB body would be a
        # denial-of-service vector and is never a legitimate SQL editor query).
        # Empty strings are still rejected by the route with a clear 400.
        max_length=200_000,
        description="Raw SQL to execute. Destructive statements trigger an auto-backup.",
    )


def get_db() -> Database:
    """Yield a single Database connection for the lifetime of the request."""
    db = Database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    db.connect()
    try:
        yield db
    finally:
        db.close()


def _split_statements(sql: str) -> List[str]:
    """
    Split a SQL string into individual statements, respecting quotes/comments.

    A naive ``str.split(';')`` breaks on semicolons inside string literals
    (e.g. ``INSERT ... VALUES ('a;b')``).  This walker tracks single-quoted,
    double-quoted (identifier), line (``--``) and block (``/* */``) contexts so
    a top-level ``;`` is the only split point.
    """
    statements: List[str] = []
    current: List[str] = []
    in_single = in_double = in_line = in_block = False
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if in_line:
            if ch == "\n":
                in_line = False
                current.append(ch)
        elif in_block:
            if ch == "*" and nxt == "/":
                in_block = False
                i += 2
                continue
        elif in_single:
            current.append(ch)
            if ch == "'":
                if nxt == "'":  # escaped quote
                    current.append(nxt)
                    i += 2
                    continue
                in_single = False
        elif in_double:
            current.append(ch)
            if ch == '"':
                if nxt == '"':
                    current.append(nxt)
                    i += 2
                    continue
                in_double = False
        elif ch == "-" and nxt == "-":
            in_line = True
            i += 2
            continue
        elif ch == "/" and nxt == "*":
            in_block = True
            i += 2
            continue
        elif ch == "'":
            in_single = True
            current.append(ch)
        elif ch == '"':
            in_double = True
            current.append(ch)
        elif ch == ";":
            stmt = "".join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
        else:
            current.append(ch)
        i += 1
    last = "".join(current).strip()
    if last:
        statements.append(last)
    return statements


def _is_readonly(statement: str) -> bool:
    """Return True if the statement only reads (no auto-backup needed)."""
    match = re.match(r"\s*([A-Za-z]+)", statement)
    if not match:
        return True  # empty / comment-only — nothing to run
    return match.group(1).upper() in _READONLY_KEYWORDS


def _jsonable(value: Any) -> Any:
    """Make a SQLite value JSON-serialisable (BLOBs would otherwise 500)."""
    if isinstance(value, bytes):
        return f"<blob {len(value)} bytes>"
    return value


@router.post("/execute")
async def execute_sql(
    request: Request,
    payload: SqlExecuteRequest,
    db: Database = Depends(get_db),
):
    """
    Execute raw SQL against the project database.

    Destructive statements (anything that isn't a pure read) trigger an automatic
    backup first.  Requires the ``admin`` scope.
    """
    # Admin-only: this endpoint runs arbitrary SQL.
    require_scopes(resolve_auth(request, db), {"admin"})

    statements = _split_statements(payload.sql)
    if not statements:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="bad_request", message="No SQL statements provided"
            ).model_dump(),
        )
    if len(statements) > MAX_STATEMENTS:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="bad_request",
                message=f"Too many statements (max {MAX_STATEMENTS})",
            ).model_dump(),
        )

    has_write = any(not _is_readonly(s) for s in statements)

    # Auto-backup guard before any destructive statement (ARCHITECTURE.md §2).
    backup_taken = False
    backup_path: Optional[str] = None
    if has_write:
        db_path = os.environ.get("DATABASE_PATH", "pyrocore.db")
        # Mirror the directory layout used by the CLI ``start`` command:
        # backups live in a ``backups/`` sibling of the database file.
        backup_dir = str(Path(db_path).parent / "backups")
        try:
            backup_file = await asyncio.to_thread(backup_now, db_path, backup_dir)
            backup_taken = True
            backup_path = str(backup_file)
        except Exception as e:  # noqa: BLE001 — surface a clean 500 either way
            logger.error("Auto-backup before destructive SQL failed: %s", e, exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=ErrorResponse(
                    code="backup_failed",
                    message=f"Auto-backup before destructive SQL failed: {e}",
                ).model_dump(),
            )

    results: List[Dict[str, Any]] = []
    for stmt in statements:
        try:
            cursor = db.execute(stmt)
        except DatabaseError as e:
            raise HTTPException(
                status_code=400,
                detail=ErrorResponse(
                    code="sql_error", message=str(e)
                ).model_dump(),
            )

        if cursor.description is not None:
            columns = [d[0] for d in cursor.description]
            rows = [[_jsonable(v) for v in row] for row in cursor.fetchall()]
            results.append(
                {
                    "statement": stmt,
                    "kind": "select",
                    "columns": columns,
                    "rows": rows,
                    "row_count": len(rows),
                    "changes": cursor.rowcount,
                }
            )
        else:
            results.append(
                {
                    "statement": stmt,
                    "kind": "write",
                    "columns": [],
                    "rows": [],
                    "row_count": 0,
                    "changes": cursor.rowcount,
                }
            )

    return {
        "results": results,
        "backup": (
            {"taken": backup_taken, "path": backup_path}
            if backup_taken
            else {"taken": False}
        ),
    }
