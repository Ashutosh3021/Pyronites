"""Local SQLite store for local-only and cache tables (Phase P3)."""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from pyronites.errors import ApiError


class LocalStore:
    """Minimal JSON-row store backed by SQLite."""

    def __init__(self, path: str) -> None:
        self._path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path)
        self._conn.row_factory = sqlite3.Row

    def close(self) -> None:
        self._conn.close()

    def _ensure_table(self, name: str) -> None:
        if not name.replace("_", "").isalnum():
            raise ApiError(f"Invalid local table name: {name!r}")
        self._conn.execute(
            f'CREATE TABLE IF NOT EXISTS "{name}" ('
            "id TEXT PRIMARY KEY, "
            "data TEXT NOT NULL"
            ")"
        )
        self._conn.commit()

    def select(
        self,
        table: str,
        *,
        filter_column: Optional[str] = None,
        filter_value: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        self._ensure_table(table)
        cur = self._conn.execute(f'SELECT id, data FROM "{table}"')
        rows: List[Dict[str, Any]] = []
        for r in cur.fetchall():
            row = json.loads(r["data"])
            if "id" not in row:
                row["id"] = r["id"]
            if filter_column is not None and filter_value is not None:
                if str(row.get(filter_column)) != str(filter_value):
                    continue
            rows.append(row)
        if offset:
            rows = rows[offset:]
        if limit is not None:
            rows = rows[:limit]
        return rows

    def get(self, table: str, row_id: str) -> Optional[Dict[str, Any]]:
        self._ensure_table(table)
        cur = self._conn.execute(
            f'SELECT data FROM "{table}" WHERE id = ?', (row_id,)
        )
        r = cur.fetchone()
        if not r:
            return None
        row = json.loads(r["data"])
        if "id" not in row:
            row["id"] = row_id
        return row

    def insert(self, table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        self._ensure_table(table)
        data = dict(row)
        row_id = data.get("id")
        if not row_id:
            row_id = str(uuid.uuid4())
            data["id"] = row_id
        else:
            row_id = str(row_id)
            data["id"] = row_id
        self._conn.execute(
            f'INSERT OR REPLACE INTO "{table}" (id, data) VALUES (?, ?)',
            (row_id, json.dumps(data)),
        )
        self._conn.commit()
        return data

    def update(self, table: str, row_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        existing = self.get(table, row_id)
        if existing is None:
            raise ApiError("Row not found", status_code=404, code="not_found")
        merged = {**existing, **data, "id": row_id}
        self._conn.execute(
            f'UPDATE "{table}" SET data = ? WHERE id = ?',
            (json.dumps(merged), row_id),
        )
        self._conn.commit()
        return merged

    def delete(self, table: str, row_id: str) -> Dict[str, Any]:
        existing = self.get(table, row_id)
        if existing is None:
            raise ApiError("Row not found", status_code=404, code="not_found")
        self._conn.execute(f'DELETE FROM "{table}" WHERE id = ?', (row_id,))
        self._conn.commit()
        return {"message": "Row deleted"}

    def replace_all(self, table: str, rows: List[Dict[str, Any]]) -> int:
        self._ensure_table(table)
        self._conn.execute(f'DELETE FROM "{table}"')
        for row in rows:
            data = dict(row)
            row_id = str(data.get("id") or uuid.uuid4())
            data["id"] = row_id
            self._conn.execute(
                f'INSERT INTO "{table}" (id, data) VALUES (?, ?)',
                (row_id, json.dumps(data)),
            )
        self._conn.commit()
        return len(rows)

    def all_rows(self, table: str) -> List[Dict[str, Any]]:
        return self.select(table)
