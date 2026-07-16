
"""
Dynamic REST API for user-created tables.
IMPORTANT: All user input is untrusted and must be validated before use.
"""
import logging
import os
import uuid
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from backend.auth.api_keys import ApiKey, validate_api_key
from backend.auth.sessions import validate_session
from backend.core.db import Database

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tables", tags=["tables"])

DB_PATH = os.environ.get("DATABASE_PATH", "pyrocore.db")


def get_db() -> Database:
    """Dependency to get a database connection."""
    db = Database(DB_PATH)
    db.connect()
    try:
        yield db
    finally:
        db.close()


class ErrorResponse(BaseModel):
    code: str
    message: str


def validate_identifier(identifier: str, allowed: Set[str]) -> str:
    """
    Validate an identifier (table/column name) against an allowlist.

    Why this is safe:
    - We only accept identifiers that are present in the pre-fetched,
      trusted allowlist from sqlite_master (for tables) or PRAGMA table_info
      (for columns).
    - No raw user input is ever interpolated into SQL without this check.

    Args:
        identifier: The identifier to validate.
        allowed: The set of allowed identifiers.

    Returns:
        The validated identifier.

    Raises:
        HTTPException: 404 if identifier not allowed.
    """
    if identifier not in allowed:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                code="not_found",
                message=f"Identifier '{identifier}' not found"
            ).model_dump()
        )
    return identifier


def get_allowed_tables(db: Database) -> Set[str]:
    """Get a set of allowed table names from the database schema."""
    cursor = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('users', 'sessions', 'api_keys', 'migrations')"
    )
    return {row[0] for row in cursor.fetchall()}


def get_allowed_columns(db: Database, table: str) -> Set[str]:
    """Get a set of allowed column names for a table from the schema."""
    cursor = db.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cursor.fetchall()}


def get_auth_info(
    request: Request,
    db: Database = Depends(get_db),
) -> Optional[Dict[str, Any]]:
    """
    Dependency to get authentication info from either API key or session.

    Returns:
        Dict with "scopes" and "type" if authenticated, None otherwise.
    """
    # Check for API key in Authorization header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        api_key_str = auth_header.split(" ", 1)[1]
        api_key = validate_api_key(db, api_key_str)
        if api_key:
            return {"type": "api_key", "scopes": set(api_key.scopes)}

    # Check for session cookie
    session_token = request.cookies.get("session_token")
    if session_token:
        user = validate_session(db, session_token)
        if user:
            # Sessions get all scopes
            return {"type": "session", "scopes": {"read", "write", "admin"}}

    return None


def require_auth(required_scopes: Set[str]):
    """Dependency factory to require authentication and specific scopes."""
    def dependency(
        auth_info: Optional[Dict[str, Any]] = Depends(get_auth_info),
    ) -> Dict[str, Any]:
        if not auth_info:
            raise HTTPException(
                status_code=401,
                detail=ErrorResponse(
                    code="unauthorized",
                    message="Missing or invalid authentication"
                ).model_dump()
            )

        if not required_scopes.issubset(auth_info["scopes"]):
            raise HTTPException(
                status_code=403,
                detail=ErrorResponse(
                    code="forbidden",
                    message="Insufficient permissions"
                ).model_dump()
            )

        return auth_info
    return dependency


@router.get("/{table}")
async def list_table_rows(
    table: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    filter_column: Optional[str] = None,
    filter_value: Optional[str] = None,
    db: Database = Depends(get_db),
    auth: Dict[str, Any] = Depends(require_auth({"read"})),
):
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
    db: Database = Depends(get_db),
    auth: Dict[str, Any] = Depends(require_auth({"read"})),
):
    """Fetch a single row by its ``id`` column."""
    allowed_tables = get_allowed_tables(db)
    valid_table = validate_identifier(table, allowed_tables)

    # Assuming 'id' is the primary key
    cursor = db.execute(f"SELECT * FROM {valid_table} WHERE id = ?", (id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                code="not_found",
                message="Row not found"
            ).model_dump()
        )
    columns = [desc[0] for desc in cursor.description]
    return dict(zip(columns, row))


@router.post("/{table}")
async def create_table_row(
    table: str,
    data: Dict[str, Any],
    db: Database = Depends(get_db),
    auth: Dict[str, Any] = Depends(require_auth({"write"})),
):
    """Insert a new row into the table. Returns the inserted row fetched from DB."""
    if not data:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message="Request body must not be empty").model_dump(),
        )

    allowed_tables = get_allowed_tables(db)
    valid_table = validate_identifier(table, allowed_tables)
    allowed_columns = get_allowed_columns(db, valid_table)

    # Validate all provided columns are allowed
    for col in data.keys():
        validate_identifier(col, allowed_columns)

    # Auto-generate an id if the table has an 'id' column and none was provided
    if "id" in allowed_columns and "id" not in data:
        data = {**data, "id": str(uuid.uuid4())}

    columns = list(data.keys())
    placeholders = ", ".join(["?"] * len(columns))
    column_names = ", ".join(columns)
    values = list(data.values())

    cursor = db.execute(
        f"INSERT INTO {valid_table} ({column_names}) VALUES ({placeholders})",
        tuple(values),
    )
    # Fetch the actual inserted row using last_insert_rowid() for reliability
    row_cursor = db.execute(
        f"SELECT * FROM {valid_table} WHERE rowid = last_insert_rowid()"
    )
    row = row_cursor.fetchone()
    if row:
        col_names = [desc[0] for desc in row_cursor.description]
        return dict(zip(col_names, row))
    # Fallback: return the data we submitted (should not normally happen)
    return data


@router.patch("/{table}/{id}")
async def update_table_row(
    table: str,
    id: str,
    data: Dict[str, Any],
    db: Database = Depends(get_db),
    auth: Dict[str, Any] = Depends(require_auth({"write"})),
):
    """Update columns of an existing row. At least one field must be provided."""
    if not data:
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(code="bad_request", message="Request body must not be empty").model_dump(),
        )

    allowed_tables = get_allowed_tables(db)
    valid_table = validate_identifier(table, allowed_tables)
    allowed_columns = get_allowed_columns(db, valid_table)

    # Validate all provided columns are allowed
    for col in data.keys():
        validate_identifier(col, allowed_columns)

    set_clauses = ", ".join([f"{col} = ?" for col in data.keys()])
    values = list(data.values()) + [id]

    db.execute(
        f"UPDATE {valid_table} SET {set_clauses} WHERE id = ?",
        tuple(values),
    )

    # Fetch and return the updated row
    cursor = db.execute(f"SELECT * FROM {valid_table} WHERE id = ?", (id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                code="not_found",
                message="Row not found"
            ).model_dump()
        )
    columns = [desc[0] for desc in cursor.description]
    return dict(zip(columns, row))


@router.delete("/{table}/{id}")
async def delete_table_row(
    table: str,
    id: str,
    db: Database = Depends(get_db),
    auth: Dict[str, Any] = Depends(require_auth({"write"})),
):
    allowed_tables = get_allowed_tables(db)
    valid_table = validate_identifier(table, allowed_tables)

    # Check if row exists first
    cursor = db.execute(f"SELECT id FROM {valid_table} WHERE id = ?", (id,))
    if not cursor.fetchone():
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                code="not_found",
                message="Row not found"
            ).model_dump()
        )

    db.execute(f"DELETE FROM {valid_table} WHERE id = ?", (id,))
    return {"message": "Row deleted"}

