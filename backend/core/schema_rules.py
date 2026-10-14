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
from typing import Any, Dict, List, Optional

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
    """Request body for creating a table. Validates everything it interpolates.

    A column is ``{"name", "type"}`` plus optional ``not_null``, ``unique`` and
    ``default``. Unknown keys are ignored rather than rejected so a newer client
    cannot break an older server.
    """

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

        seen = set()
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
            # Duplicate column names produce DDL that SQLite rejects with an
            # opaque error, so catch it here where we can name the column.
            lowered = name.lower()
            if lowered in seen:
                raise ValueError(f"duplicate column name: {name!r}")
            seen.add(lowered)

            if len(str(col.get("default") or "")) > 500:
                raise ValueError(f"default value for {name!r} is too long")
        return v

    @field_validator("primary_key")
    @classmethod
    def _pk(cls, v: Optional[str]) -> Optional[str]:
        if v and not IDENT_RE.match(v):
            raise ValueError("invalid primary key column name")
        return v


# ── DDL generation ──────────────────────────────────────────────────────────

_NUMERIC_LITERAL_RE = re.compile(r"^-?\d+(\.\d+)?([eE][+-]?\d+)?$")


def render_default_literal(raw: Any) -> Optional[str]:
    """
    Render a column default as a safe SQL literal.

    Never interpolates the caller's text as SQL. Anything that is not a number,
    a boolean or NULL becomes a single-quoted string with embedded quotes
    doubled, so ``x); DROP TABLE users;--`` is stored as text and not executed.
    """
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    if _NUMERIC_LITERAL_RE.match(value):
        return value
    upper = value.upper()
    if upper == "NULL":
        return "NULL"
    if upper in ("TRUE", "FALSE"):
        return upper
    escaped = value.replace("'", "''")
    return f"'{escaped}'"


def build_create_table_ddl(
    table: str,
    columns: List[dict],
    primary_key: Optional[str] = None,
) -> str:
    """
    Build the CREATE TABLE statement.

    Lives here rather than in a router so the dashboard's live SQL preview and
    the statement that actually runs cannot drift apart: both call this.
    Assumes the inputs already passed ``CreateTableBody`` validation.
    """
    defs: List[str] = []
    for col in columns:
        name = str(col.get("name") or "").strip()
        ctype = str(col.get("type") or "TEXT").strip().upper()
        parts = [name, ctype]
        if col.get("not_null"):
            parts.append("NOT NULL")
        if col.get("unique"):
            parts.append("UNIQUE")
        default = render_default_literal(col.get("default"))
        if default is not None:
            parts.append(f"DEFAULT {default}")
        defs.append(" ".join(parts))

    if primary_key:
        defs.append(f"PRIMARY KEY ({primary_key})")

    return f"CREATE TABLE IF NOT EXISTS {table} ({', '.join(defs)})"