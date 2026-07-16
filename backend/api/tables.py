"""
Dynamic REST API for user-created tables.
IMPORTANT: All user input is untrusted and must be validated before use.

Routes
------
- ``GET  /tables``               list user tables with row counts
- ``GET  /tables/{table}``       list rows (filter + pagination)
- ``GET  /tables/{table}/schema`` column definitions for a table
- ``GET  /tables/{table}/{id}``   fetch one row
- ``POST /tables``               create a table (DDL) — admin scope
- ``POST /tables/{table}``        insert a row
- ``PATCH /tables/{table}/{id}``  update a row
- ``DELETE /tables/{table}/{id}`` delete a row
"""

import logging
import os
import re
import uuid
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, field_validator

from backend.core.db import Database
from backend.api.schemas import ErrorResponse, MAX_ID_LEN
from backend.api.auth_deps import resolve_auth, require_scopes
from backend.core.logring import record_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tables", tags=["tables"])


def get_db() -> Database:
    """Dependency to get a database connection."""
    db = Database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    db.connect()
    try:
        yield db
    finally:
        db.close()


def validate_identifier(identifier: str, allowed: Set[str]) -> str:
    """Validate an identifier against an allowlist (see module docstring)."""
    if identifier not in allowed:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                code="not_found",
                message=f"Identifier '{identifier}' not found",
            ).model_dump(),
        )
    return identifier


def get_allowed_tables(db: Database) -> Set[str]:
    """Get a set of allowed table names from the database schema."""
    cursor = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('users', 'sessions', 'api_keys', 'migrations', 'projects', 'storage_files')"
    )
    return {row[0] for row in cursor.fetchall()}


def get_allowed_columns(db: Database, table: str) -> Set[str]:
    """Get a set of allowed column names for a table from the schema."""
    cursor = db.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cursor.fetchall()}


# ── Identifier rules for DDL (no raw interpolation without this check) ────────
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ALLOWED_COL_TYPES = {
    "TEXT",
    "INTEGER",
    "REAL",
    "BLOB",
    "NUMERIC",
    "BOOLEAN",
    "DATETIME",
    "DATE",
    "JSON",
}
_RESERVED_TABLES = {"users", "sessions", "api_keys", "migrations", "projects", "sqlite_sequence"}


class CreateTableBody(BaseModel):
    table: str
    columns: List[Dict[str, str]]
    primary_key: Optional[str] = None

    @field_validator("table")
    @classmethod
    def _table(cls, v: str) -> str:
        v = (v or "").strip()
        if not _IDENT_RE.match(v):
            raise ValueError("invalid table name")
        if v.lower() in _RESERVED_TABLES:
            raise ValueError("that table name is reserved")
        return v

    @field_validator("columns")
    @classmethod
    def _columns(cls, v: List[Dict[str, str]]) -> List[Dict[str, str]]:
        if not v:
            raise ValueError("at least one column is required")
        if len(v) > 100:
            raise ValueError("too many columns")
        for col in v:
            name = (col.get("name") or "").strip()
            ctype = (col.get("type") or "").strip().upper()
            if not _IDENT_RE.match(name):
                raise ValueError(f"invalid column name: {name!r}")
            if ctype not in _ALLOWED_COL_TYPES:
                raise ValueError(f"unsupported column type: {ctype!r}")
        return v

    @field_validator("primary_key")
    @classmethod
    def _pk(cls, v: Optional[str]) -> Optional[str]:
        if v and not _IDENT_RE.match(v):
            raise ValueError("invalid primary key column name")
        return v


@router.get("")
async def list_tables(request: Request, db: Database = Depends(get_db)):
    """List all user tables with their row counts (newest/existing order)."""
    require_scopes(resolve_auth(request, db), {"read"})
    tables = get_allowed_tables(db)
    result = []
    for name in sorted(tables):
        try:
            cur = db.execute(f"SELECT COUNT(*) FROM {name}")
            row = cur.fetchone()
            count = int(row[0]) if row else 0
        except Exception:
            logger.warning("Could not count rows in table %r", name, exc_info=True)
            count = 0
        result.append({"name": name, "rows": count})
    return result


@router.get("/{table}/schema")
async def table_schema(
    table: str,
    request: Request,
    db: Database = Depends(get_db),
):
    """Return column definitions (name, type, pk) for a table."""
    require_scopes(resolve_auth(request, db), {"read"})
    valid_table = validate_identifier(table, get_allowed_tables(db))
    cursor = db.execute(f"PRAGMA table_info({valid_table})")
    return [
        {"name": r[1], "type": r[2], "pk": bool(r[5])}
        for r in cursor.fetchall()
    ]


@router.get("/{table}")
async def list_table_rows(
    table: str,
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    filter_column: Optional[str] = None,
    filter_value: Optional[str] = None,
    db: Database = Depends(get_db),
):
    require_scopes(resolve_auth(request, db), {"read"})
    allowed_tables = get_allowed_tables(db)
    valid_table = validate_identifier(table, allowed_tables)
    allowed_columns = get_allowed_columns(db, valid_table)

    base_query = f"SELECT * FROM {valid_table}"
    params: List[Any] = []
    where_clauses: List[str] = []

    if filter_column and filter_value:
        valid_col = validate_identifier(filter_column, allowed_columns)
        where_clauses.append(f"{valid_col} = ?")
        params.append(filter_value)

    if where_clauses:
        base_query += " WHERE " + " AND ".join(where_clauses)

    base_query += " LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    cursor = db.execute(base_query, tuple(params))
    columns = [desc[0] for desc in cursor.description]
    rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    return rows


@router.get("/{table}/{id}")
async def get_table_row(
    table: str,
    id: str,
    request: Request,
    db: Database = Depends(get_db),
):
    """Fetch a single row by its ``id`` column."""
    require_scopes(resolve_auth(request, db), {"read"})
    allowed_tables = get_allowed_tables(db)
    valid_table = validate_identifier(table, allowed_tables)

    cursor = db.execute(f"SELECT * FROM {valid_table} WHERE id = ?", (id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                code="not_found",
                message="Row not found",
            ).model_dump(),
        )
    columns = [desc[0] for desc in cursor.description]
    return dict(zip(columns, row))


@router.post("")
async def create_table(
    body: CreateTableBody,
    request: Request,
    db: Database = Depends(get_db),
):
    """Create a new table from a column spec (DDL). Admin scope."""
    require_scopes(resolve_auth(request, db), {"admin"})

    col_defs = ", ".join(
        f"{c['name']} {c['type'].upper()}" for c in body.columns
    )
    pk_clause = ""
    if body.primary_key:
        if not any(c["name"] == body.primary_key for c in body.columns):
            raise HTTPException(
                status_code=400,
                detail=ErrorResponse(
                    code="bad_request",
                    message="primary_key must name an existing column",
                ).model_dump(),
            )
        pk_clause = f", PRIMARY KEY ({body.primary_key})"

    ddl = f"CREATE TABLE IF NOT EXISTS {body.table} ({col_defs}{pk_clause})"
    try:
        db.execute(ddl)
    except Exception as e:
        logger.error("Failed to create table %s: %s", body.table, e, exc_info=True)
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="bad_request", message=f"Failed to create table: {e}"
            ).model_dump(),
        )
    record_event("success", f"Table created: {body.table}")
    return {"table": body.table, "columns": body.columns}


@router.post("/{table}")
async def create_table_row(
    table: str,
    data: Dict[str, Any],
    request: Request,
    db: Database = Depends(get_db),
):
    """Insert a new row into the table. Returns the inserted row fetched from DB."""
    require_scopes(resolve_auth(request, db), {"write"})
    if not data:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message="Request body must not be empty").model_dump(),
        )

    allowed_tables = get_allowed_tables(db)
    valid_table = validate_identifier(table, allowed_tables)
    allowed_columns = get_allowed_columns(db, valid_table)

    for col in data.keys():
        validate_identifier(col, allowed_columns)

    if "id" in allowed_columns and "id" not in data:
        # Only mint a UUID for text-typed id columns.  For an INTEGER
        # (auto-increment) primary key, let SQLite assign the rowid itself —
        # inserting a string UUID would raise "datatype mismatch".
        id_type = None
        try:
            cur = db.execute(f"PRAGMA table_info({valid_table})")
            for row in cur.fetchall():
                if row[1] == "id":
                    id_type = (row[2] or "").upper()
                    break
        except Exception:
            id_type = None
        if id_type != "INTEGER":
            data = {**data, "id": str(uuid.uuid4())}

    columns = list(data.keys())
    placeholders = ", ".join(["?"] * len(columns))
    column_names = ", ".join(columns)
    values = list(data.values())

    cursor = db.execute(
        f"INSERT INTO {valid_table} ({column_names}) VALUES ({placeholders})",
        tuple(values),
    )
    row_cursor = db.execute(
        f"SELECT * FROM {valid_table} WHERE rowid = last_insert_rowid()"
    )
    row = row_cursor.fetchone()
    if row:
        col_names = [desc[0] for desc in row_cursor.description]
        return dict(zip(col_names, row))
    return data


@router.patch("/{table}/{id}")
async def update_table_row(
    table: str,
    id: str,
    data: Dict[str, Any],
    request: Request,
    db: Database = Depends(get_db),
):
    """Update columns of an existing row. At least one field must be provided."""
    require_scopes(resolve_auth(request, db), {"write"})
    if not data:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message="Request body must not be empty").model_dump(),
        )

    allowed_tables = get_allowed_tables(db)
    valid_table = validate_identifier(table, allowed_tables)
    allowed_columns = get_allowed_columns(db, valid_table)

    for col in data.keys():
        validate_identifier(col, allowed_columns)

    set_clauses = ", ".join([f"{col} = ?" for col in data.keys()])
    values = list(data.values()) + [id]

    db.execute(
        f"UPDATE {valid_table} SET {set_clauses} WHERE id = ?",
        tuple(values),
    )

    cursor = db.execute(f"SELECT * FROM {valid_table} WHERE id = ?", (id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                code="not_found",
                message="Row not found",
            ).model_dump(),
        )
    columns = [desc[0] for desc in cursor.description]
    return dict(zip(columns, row))


@router.delete("/{table}/{id}")
async def delete_table_row(
    table: str,
    id: str,
    request: Request,
    db: Database = Depends(get_db),
):
    require_scopes(resolve_auth(request, db), {"write"})
    allowed_tables = get_allowed_tables(db)
    valid_table = validate_identifier(table, allowed_tables)

    cursor = db.execute(f"SELECT id FROM {valid_table} WHERE id = ?", (id,))
    if not cursor.fetchone():
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                code="not_found",
                message="Row not found",
            ).model_dump(),
        )

    db.execute(f"DELETE FROM {valid_table} WHERE id = ?", (id,))
    return {"message": "Row deleted"}
