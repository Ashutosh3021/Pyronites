"""
Schema rules for user-created tables.

Both the legacy unscoped plane (``backend/api/tables.py``) and the project-scoped
plane (``backend/api/project_scoped.py``) expose ``POST /tables``. They used to
each carry their own copy of the identifier regex, the type whitelist and the
reserved-name set — which meant a framework table added by a migration only had
to be added to one of them to be silently shadowable from the other.

This module is the single definition. Table names, column names and column types
are all interpolated into DDL, so every one of them is validated here rather
than at the point of use.
"""

import re
from typing import List, Optional

from pydantic import BaseModel, field_validator

# Unquoted SQL identifier: no quotes, no semicolons, no whitespace, no comments.
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

ALLOWED_COLUMN_TYPES = {
    "TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC", "BOOLEAN", "DATETIME", "DATE", "JSON",
}

# Names owned by the framework. A user table with one of these names would
# shadow the real one — and because the Default project can share the meta
# database, that breaks the platform for everyone, not just this project.
#
# `rate_limit_hits` lives in the meta DB too; keep this in sync with
# backend/migrations/.
RESERVED_TABLES = {
    "users", "sessions", "api_keys", "migrations", "projects",
    "sqlite_sequence", "storage_files", "password_reset_tokens",
    "oauth_identities", "oauth_states", "rate_limit_hits",
}


class CreateTableBody(BaseModel):
    """Request body for creating a table. Validates everything it interpolates."""

    table: str
    columns: List[dict]
    primary_key: Optional[str] = None

    @field_validator("table")
    @classmethod
    def _table(cls, v: str) -> str:
        v = (v or "").strip()
        if not IDENT_RE.match(v):
            raise ValueError(
                "invalid table name — use letters, digits and underscores, "
                "starting with a letter or underscore"
            )
        if v.lower() in RESERVED_TABLES:
            raise ValueError("that table name is reserved")
        return v

    @field_validator("columns")
    @classmethod
    def _columns(cls, v: List[dict]) -> List[dict]:
        if not v:
            raise ValueError("at least one column is required")
        if len(v) > 100:
            raise ValueError("too many columns")
        for col in v:
            name = (col.get("name") or "").strip()
            ctype = (col.get("type") or "").strip().upper()
            if not IDENT_RE.match(name):
                raise ValueError(f"invalid column name: {name!r}")
            if ctype not in ALLOWED_COLUMN_TYPES:
                raise ValueError(
                    f"unsupported column type: {ctype!r} — use one of "
                    + ", ".join(sorted(ALLOWED_COLUMN_TYPES))
                )
        return v

    @field_validator("primary_key")
    @classmethod
    def _pk(cls, v: Optional[str]) -> Optional[str]:
        if v and not IDENT_RE.match(v):
            raise ValueError("invalid primary key column name")
        return v