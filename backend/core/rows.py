"""
Row-level domain logic shared by every table router.

Historically the row endpoints hard-coded ``WHERE id = ?``.  That silently
broke any table whose primary key is named something else (``uuid``,
``ticket_id``, ...) — the statement raised ``no such column: id`` and surfaced
as an opaque ``500``.  The frontend had the matching bug: it refused to send
a delete at all unless the row literally had an ``id`` field.

This module resolves the row key from the table's own schema instead:

1. the declared PRIMARY KEY column (first one, in key order);
2. otherwise an ``id`` column if the table has one;
3. otherwise the table has no addressable row → the caller turns that into a
   400 that names the fix.

Routers must not reach into tables directly — they call the helpers here.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional, Tuple

from backend.core.db import Database

# Identifiers are validated before they are interpolated into SQL.  Table and
# column names come from the schema (PRAGMA / sqlite_master), never from the
# request body, but the guard keeps that invariant local and testable.
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class RowKeyError(Exception):
    """Raised when a table has no column that can address a single row."""


def _safe_ident(name: str) -> str:
    if not isinstance(name, str) or not _IDENT_RE.match(name):
        raise RowKeyError(f"Unsafe SQL identifier: {name!r}")
    return name


def table_columns(db: Database, table: str) -> list[Dict[str, Any]]:
    """Return the table's columns with their declared type and PK flag."""
    cursor = db.execute(f"PRAGMA table_info({_safe_ident(table)})")
    columns = []
    for row in cursor.fetchall():
        # PRAGMA table_info → (cid, name, type, notnull, dflt_value, pk)
        columns.append(
            {
                "name": row[1],
                "type": (row[2] or "").upper(),
                "pk": bool(row[5]),
                "pk_order": int(row[5]) if row[5] else 0,
            }
        )
    return columns


def resolve_row_key(db: Database, table: str) -> str:
    """
    Return the column that identifies one row in ``table``.

    Raises:
        RowKeyError: the table has neither a PRIMARY KEY nor an ``id`` column,
            so no single row can be addressed.
    """
    columns = table_columns(db, table)
    if not columns:
        raise RowKeyError(f"Table '{table}' has no columns")

    primary = sorted(
        (c for c in columns if c["pk"]),
        key=lambda c: c["pk_order"],
    )
    if primary:
        return primary[0]["name"]

    for col in columns:
        if col["name"].lower() == "id":
            return col["name"]

    raise RowKeyError(
        f"Table '{table}' has no primary key and no 'id' column, so a single "
        "row cannot be addressed. Add a primary key to the table."
    )


def fetch_row(
    db: Database, table: str, key_column: str, key_value: Any
) -> Optional[Dict[str, Any]]:
    """Return the row matching ``key_column = key_value`` as a dict, or None."""
    cursor = db.execute(
        f"SELECT * FROM {_safe_ident(table)} WHERE {_safe_ident(key_column)} = ?",
        (key_value,),
    )
    row = cursor.fetchone()
    if row is None:
        return None
    columns = [desc[0] for desc in cursor.description]
    return dict(zip(columns, row))


def update_row(
    db: Database,
    table: str,
    key_column: str,
    key_value: Any,
    assignments: Dict[str, Any],
) -> bool:
    """
    Apply ``assignments`` to the row identified by the key.

    Returns True when a row was updated, False when no row matched.
    """
    if not assignments:
        return False
    table = _safe_ident(table)
    key_column = _safe_ident(key_column)
    set_clauses = ", ".join(f"{_safe_ident(col)} = ?" for col in assignments)
    values = list(assignments.values()) + [key_value]
    cursor = db.execute(
        f"UPDATE {table} SET {set_clauses} WHERE {key_column} = ?",
        tuple(values),
    )
    return cursor.rowcount > 0


def delete_row(
    db: Database, table: str, key_column: str, key_value: Any
) -> bool:
    """
    Delete the row identified by the key.

    Returns True when a row was deleted, False when no row matched.
    """
    cursor = db.execute(
        f"DELETE FROM {_safe_ident(table)} WHERE {_safe_ident(key_column)} = ?",
        (key_value,),
    )
    return cursor.rowcount > 0


def row_key_for_request(db: Database, table: str) -> Tuple[str, str]:
    """
    Convenience wrapper used by the routers.

    Returns ``(key_column, key_label)`` where the label is what the user sees
    in an error message ("id", "uuid", ...).
    """
    key_column = resolve_row_key(db, table)
    return key_column, key_column


def optional_row_key(db: Database, table: str) -> Optional[str]:
    """
    Like :func:`resolve_row_key` but returns ``None`` instead of raising.

    Used where a missing key is not an error — e.g. INSERT wants to know
    whether it may auto-generate a key value.
    """
    try:
        return resolve_row_key(db, table)
    except RowKeyError:
        return None
