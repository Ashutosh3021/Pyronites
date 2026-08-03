"""
Dynamic REST API for user-created tables.

Works at:
  /tables/...
  /api/projects/{project_id}/tables/...

Auth uses the meta DB; data ops use the project data DB (see project_deps).
"""

import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, field_validator

from backend.core.db import Database, DatabaseError, DatabaseIntegrityError
from backend.api.schemas import ErrorResponse, MAX_ID_LEN
from backend.api.auth_deps import resolve_auth, require_scopes
from backend.api.project_deps import get_db, auth_db
from backend.core.logring import record_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tables", tags=["tables"])


def _auth(request: Request, db: Database):
    return resolve_auth(request, auth_db(request, db))


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


def get_allowed_tables(db: Database) -> Set[str]:
    cursor = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
        "AND name NOT IN ('users', 'sessions', 'api_keys', 'migrations', 'projects', 'storage_files')"
    )
    return {row[0] for row in cursor.fetchall()}


def get_allowed_columns(db: Database, table: str) -> Set[str]:
    cursor = db.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cursor.fetchall()}



def get_column_types(db: Database, table: str) -> Dict[str, str]:
    """Return {column_name: declared_type_upper} from PRAGMA table_info."""
    cursor = db.execute(f"PRAGMA table_info({table})")
    return {row[1]: (row[2] or "").upper() for row in cursor.fetchall()}


def _coerce_write_value(column: str, value: Any, col_type: str) -> Any:
    """
    Coerce a single field value for SQLite binding.

    JSON columns: dict/list/bool/number are json.dumps'd; strings must be valid JSON.
    Non-JSON columns: dict/list are rejected with 400 (avoids bare sqlite binding 500).
    """
    if value is None:
        return None
    if col_type == "JSON":
        if isinstance(value, (dict, list, bool, int, float)):
            try:
                return json.dumps(value, ensure_ascii=False)
            except (TypeError, ValueError) as e:
                raise HTTPException(
                    status_code=400,
                    detail=ErrorResponse(
                        code="invalid_json",
                        message=f"Column '{column}': value is not JSON-serializable ({e})",
                    ).model_dump(),
                )
        if isinstance(value, str):
            try:
                json.loads(value)
            except json.JSONDecodeError as e:
                raise HTTPException(
                    status_code=400,
                    detail=ErrorResponse(
                        code="invalid_json",
                        message=f"Column '{column}': invalid JSON string ({e.msg})",
                    ).model_dump(),
                )
            return value
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="invalid_json",
                message=f"Column '{column}': expected object, array, or JSON string",
            ).model_dump(),
        )
    # Non-JSON: nested structures cannot bind to SQLite parameters
    if isinstance(value, (dict, list)):
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                code="invalid_value",
                message=(
                    f"Column '{column}' (type {col_type or 'TEXT'}) does not accept "
                    "object/array values; use a JSON column or send a scalar"
                ),
            ).model_dump(),
        )
    return value


def prepare_row_for_write(data: Dict[str, Any], col_types: Dict[str, str]) -> Dict[str, Any]:
    """
    Validate and coerce every field in ``data`` for INSERT/UPDATE binding.

    Atomic: the first invalid field aborts the whole request with a field-identifying
    4xx — no partial row is written.
    """
    prepared: Dict[str, Any] = {}
    for key, value in data.items():
        prepared[key] = _coerce_write_value(key, value, col_types.get(key, "TEXT"))
    return prepared


def deserialize_row(row: Dict[str, Any], col_types: Dict[str, str]) -> Dict[str, Any]:
    """Parse JSON-column string values back to objects/arrays for API responses."""
    out: Dict[str, Any] = {}
    for key, value in row.items():
        if col_types.get(key) == "JSON" and isinstance(value, str):
            try:
                out[key] = json.loads(value)
            except json.JSONDecodeError:
                out[key] = value
        else:
            out[key] = value
    return out


_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ALLOWED_COL_TYPES = {
    "TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC", "BOOLEAN", "DATETIME", "DATE", "JSON",
}
_RESERVED_TABLES = {"users", "sessions", "api_keys", "migrations", "projects", "sqlite_sequence", "storage_files"}


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
    require_scopes(_auth(request, db), {"read"})
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
async def table_schema(table: str, request: Request, db: Database = Depends(get_db)):
    require_scopes(_auth(request, db), {"read"})
    valid_table = validate_table(table, get_allowed_tables(db))
    cursor = db.execute(f"PRAGMA table_info({valid_table})")
    return [{"name": r[1], "type": r[2], "pk": bool(r[5])} for r in cursor.fetchall()]


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
    require_scopes(_auth(request, db), {"read"})
    allowed_tables = get_allowed_tables(db)
    valid_table = validate_table(table, allowed_tables)
    allowed_columns = get_allowed_columns(db, valid_table)

    base_query = f"SELECT * FROM {valid_table}"
    params: List[Any] = []
    where_clauses: List[str] = []

    if filter_column and filter_value:
        valid_col = validate_column(filter_column, allowed_columns)
        where_clauses.append(f"{valid_col} = ?")
        params.append(filter_value)

    if where_clauses:
        base_query += " WHERE " + " AND ".join(where_clauses)

    base_query += " LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    cursor = db.execute(base_query, tuple(params))
    columns = [desc[0] for desc in cursor.description]
    col_types = get_column_types(db, valid_table)
    return [deserialize_row(dict(zip(columns, row)), col_types) for row in cursor.fetchall()]


@router.get("/{table}/{id}")
async def get_table_row(table: str, id: str, request: Request, db: Database = Depends(get_db)):
    require_scopes(_auth(request, db), {"read"})
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
    return deserialize_row(dict(zip(columns, row)), col_types)


@router.post("")
async def create_table(body: CreateTableBody, request: Request, db: Database = Depends(get_db)):
    require_scopes(_auth(request, db), {"admin"})
    col_defs = ", ".join(f"{c['name']} {c['type'].upper()}" for c in body.columns)
    pk_clause = ""
    if body.primary_key:
        if not any(c["name"] == body.primary_key for c in body.columns):
            raise HTTPException(
                status_code=400,
                detail=ErrorResponse(
                    code="bad_request", message="primary_key must name an existing column"
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
            detail=ErrorResponse(code="bad_request", message=f"Failed to create table: {e}").model_dump(),
        )
    record_event("success", f"Table created: {body.table}")
    return {"table": body.table, "columns": body.columns}


@router.post("/{table}")
async def create_table_row(
    table: str, data: Dict[str, Any], request: Request, db: Database = Depends(get_db)
):
    require_scopes(_auth(request, db), {"write"})
    if not data:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message="Request body must not be empty").model_dump(),
        )
    valid_table = validate_table(table, get_allowed_tables(db))
    col_types = get_column_types(db, valid_table)
    allowed_columns = set(col_types.keys())
    for col in data.keys():
        validate_column(col, allowed_columns)

    if "id" in allowed_columns and "id" not in data:
        id_type = col_types.get("id", "")
        if id_type != "INTEGER":
            data = {**data, "id": str(uuid.uuid4())}

    # Atomic: coerce all fields first; any invalid field rejects the whole row
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
    row_cursor = db.execute(f"SELECT * FROM {valid_table} WHERE rowid = last_insert_rowid()")
    row = row_cursor.fetchone()
    if row:
        col_names = [desc[0] for desc in row_cursor.description]
        return deserialize_row(dict(zip(col_names, row)), col_types)
    return deserialize_row(dict(prepared), col_types)


@router.patch("/{table}/{id}")
async def update_table_row(
    table: str, id: str, data: Dict[str, Any], request: Request, db: Database = Depends(get_db)
):
    require_scopes(_auth(request, db), {"write"})
    if not data:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message="Request body must not be empty").model_dump(),
        )
    valid_table = validate_table(table, get_allowed_tables(db))
    col_types = get_column_types(db, valid_table)
    allowed_columns = set(col_types.keys())
    for col in data.keys():
        validate_column(col, allowed_columns)
    # Atomic: coerce all fields first; any invalid field rejects the whole patch
    prepared = prepare_row_for_write(data, col_types)
    set_clauses = ", ".join([f"{col} = ?" for col in prepared.keys()])
    values = list(prepared.values()) + [id]
    try:
        db.execute(f"UPDATE {valid_table} SET {set_clauses} WHERE id = ?", tuple(values))
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


@router.delete("/{table}/{id}")
async def delete_table_row(table: str, id: str, request: Request, db: Database = Depends(get_db)):
    require_scopes(_auth(request, db), {"write"})
    valid_table = validate_table(table, get_allowed_tables(db))
    cursor = db.execute(f"SELECT id FROM {valid_table} WHERE id = ?", (id,))
    if not cursor.fetchone():
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(code="not_found", message="Row not found").model_dump(),
        )
    db.execute(f"DELETE FROM {valid_table} WHERE id = ?", (id,))
    return {"message": "Row deleted"}
