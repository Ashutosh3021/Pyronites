"""
Project-scoped data plane — tables, SQL, storage, API keys, stats.

Frontend ``apiUrl()`` rewrites selected routes to::

    /api/projects/{project_id}/tables...
    /api/projects/{project_id}/storage...
    /api/projects/{project_id}/sql...
    /api/projects/{project_id}/api/keys...
    /api/projects/{project_id}/stats

Legacy unscoped ``/tables``, ``/storage``, ``/sql``, ``/api/keys``, ``/api/stats``
remain for the Default project and the Python client package.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from backend.api.auth_deps import require_scopes
from backend.api.project_deps import get_project_context
from backend.api.schemas import ErrorResponse, MAX_NAME_LEN, to_utc_iso
from backend.auth.api_keys import (
    ALLOWED_SCOPES,
    create_api_key,
    list_api_keys,
    revoke_api_key,
)
from backend.core.backup import backup_now, list_backups
from backend.core.db import Database, DatabaseError, DatabaseIntegrityError
from backend.api.tables import (
    get_column_types,
    prepare_row_for_write,
    deserialize_row,
)
from backend.core.logring import record_event
from backend.core.storage import (
    FileTooLargeError,
    InvalidFilenameError,
    LocalFileStorage,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/projects/{project_id}",
    tags=["project-data"],
)

# ── shared helpers (mirrored from tables / sql / storage — reuse patterns) ──

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ALLOWED_COL_TYPES = {
    "TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC", "BOOLEAN",
    "DATETIME", "DATE", "JSON",
}
_RESERVED_TABLES = {
    "users", "sessions", "api_keys", "migrations", "projects",
    "sqlite_sequence", "storage_files",
}
_READONLY_KEYWORDS = {"SELECT", "WITH", "EXPLAIN", "VALUES", "PRAGMA"}
MAX_STATEMENTS = 50
_REDACT_COLS = {"password", "password_hash", "token", "session_token", "key_hash"}


def _ctx_db(ctx: Dict[str, Any]) -> Database:
    return ctx["db"]


def _ctx_meta(ctx: Dict[str, Any]) -> Database:
    return ctx["meta"]


def _ctx_auth(ctx: Dict[str, Any]) -> Dict[str, Any]:
    return ctx["auth"]


def _ctx_project(ctx: Dict[str, Any]) -> Dict[str, Any]:
    return ctx["project"]


def _slug(project: Dict[str, Any]) -> str:
    return project.get("slug") or project.get("project_id") or project["id"]


def get_allowed_tables(db: Database) -> Set[str]:
    cursor = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' "
        "AND name NOT IN ('users', 'sessions', 'api_keys', 'migrations', "
        "'projects', 'storage_files')"
    )
    return {row[0] for row in cursor.fetchall()}


def get_allowed_columns(db: Database, table: str) -> Set[str]:
    cursor = db.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cursor.fetchall()}


def validate_table(table: str, allowed: Set[str]) -> str:
    """Raise 404 with code table_not_found if table is not in allowed set."""
    if table not in allowed:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                code="table_not_found",
                message=f"Table '{table}' not found",
            ).model_dump(),
        )
    return table


def validate_column(column: str, allowed: Set[str]) -> str:
    """Raise 404 with code column_not_found if column is not in allowed set."""
    if column not in allowed:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                code="column_not_found",
                message=f"Column '{column}' not found",
            ).model_dump(),
        )
    return column


def validate_identifier(identifier: str, allowed: Set[str]) -> str:
    """Deprecated alias — prefer validate_table / validate_column."""
    return validate_table(identifier, allowed)


def _storage_for(ctx: Dict[str, Any]) -> LocalFileStorage:
    root = os.environ.get("STORAGE_ROOT", "storage_files")
    project = _ctx_project(ctx)
    # Per-project subdirectory under storage root (best practice isolation).
    project_root = str(Path(root) / _slug(project))
    return LocalFileStorage(
        _ctx_db(ctx),
        root_dir=project_root,
        project_id=_slug(project),
    )


def _record_to_dict(record) -> Dict[str, Any]:
    return {
        "id": record.id,
        "original_filename": record.original_filename,
        "content_type": record.content_type,
        "size_bytes": record.size_bytes,
        "uploaded_at": to_utc_iso(record.uploaded_at),
        "project_id": record.project_id,
    }


def _mask(key_hash: str) -> str:
    return f"pyro_live_{'•' * 10}{key_hash[-4:]}"


def _jsonable(value: Any) -> Any:
    if isinstance(value, bytes):
        return f"<blob {len(value)} bytes>"
    return value


def _redact_row(columns: List[str], row: List[Any]) -> List[Any]:
    out = []
    for col, val in zip(columns, row):
        if col.lower() in _REDACT_COLS:
            out.append("<redacted>")
        else:
            out.append(_jsonable(val))
    return out


def _split_statements(sql: str) -> List[str]:
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
                if nxt == "'":
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
    match = re.match(r"\s*([A-Za-z]+)", statement)
    if not match:
        return True
    return match.group(1).upper() in _READONLY_KEYWORDS


# ── tables ───────────────────────────────────────────────────────────────────

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


@router.get("/tables")
async def list_tables(ctx: Dict[str, Any] = Depends(get_project_context)):
    require_scopes(_ctx_auth(ctx), {"read"})
    db = _ctx_db(ctx)
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


@router.get("/tables/{table}/schema")
async def table_schema(
    table: str,
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"read"})
    db = _ctx_db(ctx)
    valid_table = validate_table(table, get_allowed_tables(db))
    cursor = db.execute(f"PRAGMA table_info({valid_table})")
    return [
        {"name": r[1], "type": r[2], "pk": bool(r[5])}
        for r in cursor.fetchall()
    ]


@router.get("/tables/{table}")
async def list_table_rows(
    table: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    filter_column: Optional[str] = None,
    filter_value: Optional[str] = None,
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"read"})
    db = _ctx_db(ctx)
    allowed_tables = get_allowed_tables(db)
    valid_table = validate_table(table, allowed_tables)
    allowed_columns = get_allowed_columns(db, valid_table)

    base_query = f"SELECT * FROM {valid_table}"
    params: List[Any] = []
    if filter_column and filter_value:
        valid_col = validate_column(filter_column, allowed_columns)
        base_query += f" WHERE {valid_col} = ?"
        params.append(filter_value)
    base_query += " LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    cursor = db.execute(base_query, tuple(params))
    columns = [desc[0] for desc in cursor.description]
    col_types = get_column_types(db, valid_table)
    rows = []
    for row in cursor.fetchall():
        d = deserialize_row(dict(zip(columns, row)), col_types)
        for c in list(d.keys()):
            if c.lower() in _REDACT_COLS:
                d[c] = "<redacted>"
        rows.append(d)
    return rows


@router.get("/tables/{table}/{id}")
async def get_table_row(
    table: str,
    id: str,
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"read"})
    db = _ctx_db(ctx)
    valid_table = validate_table(table, get_allowed_tables(db))
    cursor = db.execute(f"SELECT * FROM {valid_table} WHERE id = ?", (id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="Row not found").model_dump(),
        )
    columns = [desc[0] for desc in cursor.description]
    col_types = get_column_types(db, valid_table)
    d = deserialize_row(dict(zip(columns, row)), col_types)
    for c in list(d.keys()):
        if c.lower() in _REDACT_COLS:
            d[c] = "<redacted>"
    return d


@router.post("/tables")
async def create_table(
    body: CreateTableBody,
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"admin"})
    db = _ctx_db(ctx)
    col_defs = ", ".join(f"{c['name']} {c['type'].upper()}" for c in body.columns)
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


@router.post("/tables/{table}")
async def create_table_row(
    table: str,
    data: Dict[str, Any],
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"write"})
    if not data:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="bad_request", message="Request body must not be empty"
            ).model_dump(),
        )
    db = _ctx_db(ctx)
    valid_table = validate_table(table, get_allowed_tables(db))
    col_types = get_column_types(db, valid_table)
    allowed_columns = set(col_types.keys())
    for col in data.keys():
        validate_column(col, allowed_columns)

    if "id" in allowed_columns and "id" not in data:
        id_type = col_types.get("id", "")
        if id_type != "INTEGER":
            data = {**data, "id": str(uuid.uuid4())}

    prepared = prepare_row_for_write(data, col_types)
    columns = list(prepared.keys())
    placeholders = ", ".join(["?"] * len(columns))
    column_names = ", ".join(columns)
    values = list(prepared.values())
    try:
        db.execute(
            f"INSERT INTO {valid_table} ({column_names}) VALUES ({placeholders})",
            tuple(values),
        )
    except DatabaseIntegrityError as e:
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(code="constraint_violation", message=str(e)).model_dump(),
        )
    except DatabaseError as e:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message=f"Insert failed: {e}").model_dump(),
        )
    row_cursor = db.execute(
        f"SELECT * FROM {valid_table} WHERE rowid = last_insert_rowid()"
    )
    row = row_cursor.fetchone()
    if row:
        col_names = [desc[0] for desc in row_cursor.description]
        return deserialize_row(dict(zip(col_names, row)), col_types)
    return deserialize_row(dict(prepared), col_types)


@router.patch("/tables/{table}/{id}")
async def update_table_row(
    table: str,
    id: str,
    data: Dict[str, Any],
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"write"})
    if not data:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="bad_request", message="Request body must not be empty"
            ).model_dump(),
        )
    db = _ctx_db(ctx)
    valid_table = validate_table(table, get_allowed_tables(db))
    col_types = get_column_types(db, valid_table)
    allowed_columns = set(col_types.keys())
    for col in data.keys():
        validate_column(col, allowed_columns)
    prepared = prepare_row_for_write(data, col_types)
    set_clauses = ", ".join([f"{col} = ?" for col in prepared.keys()])
    values = list(prepared.values()) + [id]
    try:
        db.execute(
            f"UPDATE {valid_table} SET {set_clauses} WHERE id = ?",
            tuple(values),
        )
    except DatabaseIntegrityError as e:
        raise HTTPException(
            status_code=409,
            detail=ErrorResponse(code="constraint_violation", message=str(e)).model_dump(),
        )
    except DatabaseError as e:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message=f"Update failed: {e}").model_dump(),
        )
    cursor = db.execute(f"SELECT * FROM {valid_table} WHERE id = ?", (id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="Row not found").model_dump(),
        )
    columns = [desc[0] for desc in cursor.description]
    return deserialize_row(dict(zip(columns, row)), col_types)


@router.delete("/tables/{table}/{id}")
async def delete_table_row(
    table: str,
    id: str,
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"write"})
    db = _ctx_db(ctx)
    valid_table = validate_table(table, get_allowed_tables(db))
    cursor = db.execute(f"SELECT id FROM {valid_table} WHERE id = ?", (id,))
    if not cursor.fetchone():
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="Row not found").model_dump(),
        )
    db.execute(f"DELETE FROM {valid_table} WHERE id = ?", (id,))
    return {"message": "Row deleted"}


# ── storage ──────────────────────────────────────────────────────────────────

@router.post("/storage/upload")
async def upload_file(
    file: UploadFile = File(...),
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"write"})
    try:
        filename = file.filename or "unknown"
        content_type = file.content_type or "application/octet-stream"
        record = _storage_for(ctx).save(file.file, filename, content_type)
        return _record_to_dict(record)
    except InvalidFilenameError as e:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="invalid_filename", message=str(e)).model_dump(),
        )
    except FileTooLargeError as e:
        raise HTTPException(
            status_code=413,
            detail=ErrorResponse(code="file_too_large", message=str(e)).model_dump(),
        )
    except Exception as e:
        logger.error("Failed to upload file: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Failed to upload file"
            ).model_dump(),
        )


@router.get("/storage")
async def list_files(
    prefix: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"read"})
    try:
        records = _storage_for(ctx).list(prefix, limit=limit, offset=offset)
        return [_record_to_dict(r) for r in records]
    except Exception as e:
        logger.error("Failed to list files: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Failed to list files"
            ).model_dump(),
        )


@router.get("/storage/{file_id}/download")
async def download_file(
    file_id: str,
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"read"})
    store = _storage_for(ctx)
    try:
        record = store.get_record(file_id)
        file_bytes = store.get(file_id)
        return StreamingResponse(
            iter([file_bytes]),
            media_type=record.content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{record.original_filename}"'
            },
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="File not found").model_dump(),
        )
    except Exception as e:
        logger.error("Failed to download file: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Failed to download file"
            ).model_dump(),
        )


@router.get("/storage/{file_id}")
async def get_file_metadata(
    file_id: str,
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"read"})
    try:
        return _record_to_dict(_storage_for(ctx).get_record(file_id))
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="File not found").model_dump(),
        )
    except Exception as e:
        logger.error("Failed to get file metadata: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Failed to get file metadata"
            ).model_dump(),
        )


@router.delete("/storage/{file_id}")
async def delete_file(
    file_id: str,
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"write"})
    try:
        _storage_for(ctx).delete(file_id)
        return {"message": "File deleted successfully"}
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="File not found").model_dump(),
        )
    except Exception as e:
        logger.error("Failed to delete file: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Failed to delete file"
            ).model_dump(),
        )


# ── SQL editor ───────────────────────────────────────────────────────────────

class SqlExecuteRequest(BaseModel):
    sql: str = Field(..., max_length=200_000)


@router.post("/sql/execute")
async def execute_sql(
    payload: SqlExecuteRequest,
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"admin"})
    db = _ctx_db(ctx)
    project = _ctx_project(ctx)

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
    backup_taken = False
    backup_path: Optional[str] = None
    if has_write:
        # Backup the project data file (or meta DB for Default).
        from backend.api.project_deps import open_data_db_for_project

        # Path: reuse env or dedicated file
        from backend.core import projects as projmod

        path = projmod.project_file_path(project["id"])
        if not path.exists():
            db_path = os.environ.get("DATABASE_PATH", "pyrocore.db")
        else:
            db_path = str(path)
        backup_dir = str(Path(db_path).parent / "backups")
        try:
            backup_file = await asyncio.to_thread(backup_now, db_path, backup_dir)
            backup_taken = True
            backup_path = str(backup_file)
        except Exception as e:
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
                detail=ErrorResponse(code="sql_error", message=str(e)).model_dump(),
            )
        if cursor.description is not None:
            columns = [d[0] for d in cursor.description]
            rows = [
                _redact_row(columns, list(row)) for row in cursor.fetchall()
            ]
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


# ── API keys (meta DB; filtered by project slug) ─────────────────────────────

class CreateKeyBody(BaseModel):
    name: str
    scopes: List[str]

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


@router.get("/api/keys")
async def list_keys(ctx: Dict[str, Any] = Depends(get_project_context)):
    require_scopes(_ctx_auth(ctx), {"read"})
    meta = _ctx_meta(ctx)
    slug = _slug(_ctx_project(ctx))
    keys = [k for k in list_api_keys(meta) if k.project_id == slug]
    return [
        {
            "id": k.id,
            "name": k.name,
            "masked": _mask(k.key_hash),
            "scopes": k.scopes,
            "created_at": to_utc_iso(k.created_at),
            "last_used_at": to_utc_iso(k.last_used_at) if k.last_used_at else None,
            "project_id": k.project_id,
        }
        for k in keys
    ]


@router.post("/api/keys")
async def create_key(
    body: CreateKeyBody,
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"admin"})
    meta = _ctx_meta(ctx)
    slug = _slug(_ctx_project(ctx))
    try:
        raw_key, api_key = create_api_key(meta, slug, body.name, body.scopes)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message=str(e)).model_dump(),
        )
    record_event("success", f"API key created: {body.name} ({slug})")
    return {
        "key": raw_key,
        "id": api_key.id,
        "name": api_key.name,
        "scopes": api_key.scopes,
        "created_at": to_utc_iso(api_key.created_at),
        "project_id": api_key.project_id,
    }


@router.delete("/api/keys/{key_id}")
async def revoke_key(
    key_id: str,
    ctx: Dict[str, Any] = Depends(get_project_context),
):
    require_scopes(_ctx_auth(ctx), {"admin"})
    meta = _ctx_meta(ctx)
    slug = _slug(_ctx_project(ctx))
    # Only revoke if key belongs to this project
    matching = [k for k in list_api_keys(meta) if k.id == key_id and k.project_id == slug]
    if not matching:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="API key not found").model_dump(),
        )
    try:
        revoke_api_key(meta, key_id)
    except Exception:
        logger.error("Failed to revoke key %s", key_id, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                code="internal_error", message="Failed to revoke key"
            ).model_dump(),
        )
    record_event("warning", f"API key revoked: {key_id}")
    return {"message": "API key revoked"}


# ── stats ────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def project_stats(ctx: Dict[str, Any] = Depends(get_project_context)):
    require_scopes(_ctx_auth(ctx), {"read"})
    db = _ctx_db(ctx)
    meta = _ctx_meta(ctx)
    project = _ctx_project(ctx)
    slug = _slug(project)

    table_count = len(get_allowed_tables(db))

    def _count(database: Database, sql: str, params=()) -> int:
        try:
            cur = database.execute(sql, params)
            row = cur.fetchone()
            return int(row[0]) if row else 0
        except Exception:
            return 0

    file_count = _count(db, "SELECT COUNT(*) FROM storage_files WHERE project_id = ?", (slug,))
    # storage_files may live in project DB without project_id filter on primary
    if file_count == 0:
        file_count = _count(db, "SELECT COUNT(*) FROM storage_files")

    key_count = _count(
        meta,
        "SELECT COUNT(*) FROM api_keys WHERE is_revoked = 0 AND project_id = ?",
        (slug,),
    )

    from backend.core import projects as projmod

    path = projmod.project_file_path(project["id"])
    if path.exists():
        db_path = str(path)
    else:
        db_path = os.environ.get("DATABASE_PATH", "pyrocore.db")
    db_size = os.path.getsize(db_path) if os.path.exists(db_path) else 0

    last_backup = None
    try:
        backup_dir = str(Path(db_path).parent / "backups")
        backups = list_backups(backup_dir)
        if backups:
            last_backup = backups[0].created_at.isoformat().replace("+00:00", "Z")
    except Exception:
        pass

    return {
        "table_count": table_count,
        "file_count": file_count,
        "key_count": key_count,
        "db_size_bytes": db_size,
        "last_backup": last_backup,
        "project": {
            "project_id": slug,
            "project_name": project.get("name") or project.get("project_name"),
            "backup_interval": project.get("backup_interval") or "1hour",
            "storage_location": project.get("storage_location") or "local",
            "id": project["id"],
        },
    }
