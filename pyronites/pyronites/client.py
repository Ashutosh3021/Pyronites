"""Main façade for the pyronites client."""

from __future__ import annotations

from typing import Optional, Sequence

from pyronites.auth import AuthClient
from pyronites.config import ClientConfig, load_config
from pyronites.errors import ApiError
from pyronites.http import HttpTransport
from pyronites.local import LocalStore
from pyronites.storage import StorageClient
from pyronites.table import TableQuery


class PyronitesClient:
    """High-level client. Prefer ``create_client()`` over constructing this directly."""

    def __init__(self, config: ClientConfig) -> None:
        self._config = config
        self._http = HttpTransport(config)
        self.auth = AuthClient(self._http)
        self.storage = StorageClient(self._http)
        self._local: Optional[LocalStore] = None
        if config.local_db_path or config.local_tables or config.cache_tables:
            path = config.local_db_path or "./.pyronites_local.db"
            self._local = LocalStore(path)

    def table(self, name: str) -> TableQuery:
        if not name or not isinstance(name, str):
            raise ApiError("table name must be a non-empty string")
        policy = self._config.table_policy(name)
        return TableQuery(self._http, name, policy=policy, local=self._local)

    def sql(self, query: str) -> dict:
        return self._http.request(  # type: ignore[return-value]
            "POST", "/sql/execute", json={"sql": query},
        )

    def pull(self, table: str) -> int:
        """Fetch all remote rows and replace the local copy. Remote wins."""
        if self._local is None:
            raise ApiError(
                "Local store is not configured. Pass local_db_path=... "
                "or list local_tables/cache_tables on create_client()."
            )
        rows = self._http.request("GET", f"/tables/{table}", params={"limit": 200})
        if not isinstance(rows, list):
            rows = []
        return self._local.replace_all(table, rows)

    def push(self, table: str) -> int:
        """Push local rows to remote. Local-only tables cannot be pushed."""
        if self._local is None:
            raise ApiError("Local store is not configured.")
        if self._config.table_policy(table) == "local":
            raise ApiError(
                f"Table {table!r} is local-only and cannot be pushed to the backend."
            )
        rows = self._local.all_rows(table)
        count = 0
        for row in rows:
            row_id = row.get("id")
            if not row_id:
                self._http.request("POST", f"/tables/{table}", json=row)
                count += 1
                continue
            try:
                self._http.request(
                    "PATCH", f"/tables/{table}/{row_id}",
                    json={k: v for k, v in row.items() if k != "id"},
                )
                count += 1
            except ApiError as e:
                if e.status_code == 404 or e.code == "not_found":
                    self._http.request("POST", f"/tables/{table}", json=row)
                    count += 1
                else:
                    raise
        return count

    def sync(self, table: str) -> int:
        """v1 policy: remote wins → equivalent to pull."""
        return self.pull(table)

    def close(self) -> None:
        self._http.close()
        if self._local is not None:
            self._local.close()

    def __enter__(self) -> "PyronitesClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def create_client(
    url: Optional[str] = None,
    key: Optional[str] = None,
    timeout: float = 30.0,
    local_tables: Optional[Sequence[str]] = None,
    remote_tables: Optional[Sequence[str]] = None,
    cache_tables: Optional[Sequence[str]] = None,
    local_db_path: Optional[str] = None,
) -> PyronitesClient:
    config = load_config(
        url=url, key=key, timeout=timeout,
        local_tables=local_tables,
        remote_tables=remote_tables,
        cache_tables=cache_tables,
        local_db_path=local_db_path,
    )
    return PyronitesClient(config)
