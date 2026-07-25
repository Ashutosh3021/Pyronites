"""Table (database) methods for the pyronites client."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from pyronites.config import POLICY_CACHE, POLICY_LOCAL, POLICY_REMOTE
from pyronites.errors import ApiError, NotFoundError
from pyronites.http import HttpTransport
from pyronites.local import LocalStore


class TableQuery:
    """Fluent builder for table operations on a single table."""

    def __init__(
        self,
        transport: HttpTransport,
        name: str,
        *,
        policy: str = POLICY_REMOTE,
        local: Optional[LocalStore] = None,
    ) -> None:
        self._http = transport
        self._name = name
        self._policy = policy
        self._local = local
        self._filter_column: Optional[str] = None
        self._filter_value: Optional[str] = None
        self._limit: Optional[int] = None
        self._offset: Optional[int] = None
        self._update_data: Optional[Dict[str, Any]] = None
        self._op: Optional[str] = None

    def eq(self, column: str, value: Any) -> Any:
        self._filter_column = column
        self._filter_value = str(value) if value is not None else None
        if self._op in ("update", "delete"):
            return self._dispatch()
        return self

    def limit(self, n: int) -> "TableQuery":
        self._limit = n
        return self

    def offset(self, n: int) -> "TableQuery":
        self._offset = n
        return self

    def select(self) -> "TableQuery":
        self._op = "select"
        return self

    def insert(
        self, row: Union[Dict[str, Any], List[Dict[str, Any]]]
    ) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
        if isinstance(row, list):
            return [self._insert_one(r) for r in row]
        return self._insert_one(row)

    def update(self, data: Dict[str, Any]) -> "TableQuery":
        if not data:
            raise ApiError("update() requires a non-empty data dict")
        self._op = "update"
        self._update_data = data
        return self

    def delete(self) -> "TableQuery":
        self._op = "delete"
        return self

    def single(self) -> Dict[str, Any]:
        rows = self._execute_select()
        if not rows:
            raise ApiError("No rows returned for .single()", code="not_found")
        if len(rows) > 1:
            raise ApiError("Multiple rows returned for .single()")
        return rows[0]

    def get(self, row_id: str) -> Dict[str, Any]:
        if self._policy == POLICY_LOCAL:
            assert self._local is not None
            row = self._local.get(self._name, row_id)
            if row is None:
                raise NotFoundError("Row not found", status_code=404, code="not_found")
            return row

        if self._policy == POLICY_CACHE and self._local is not None:
            row = self._local.get(self._name, row_id)
            if row is not None:
                return row

        result = self._http.request("GET", f"/tables/{self._name}/{row_id}")
        if self._policy == POLICY_CACHE and self._local is not None and isinstance(result, dict):
            self._local.insert(self._name, result)
        return result  # type: ignore[return-value]

    def execute(self) -> Any:
        return self._dispatch()

    def __iter__(self):
        return iter(self._execute_select())

    def __call__(self) -> Any:
        return self._dispatch()

    def _require_local(self) -> LocalStore:
        if self._local is None:
            raise ApiError(
                "Local store is not configured. Pass local_db_path=... to create_client()."
            )
        return self._local

    def _insert_one(self, row: Dict[str, Any]) -> Dict[str, Any]:
        if self._policy == POLICY_LOCAL:
            return self._require_local().insert(self._name, row)

        result = self._http.request(
            "POST", f"/tables/{self._name}", json=row,
        )  # type: ignore[return-value]
        if self._policy == POLICY_CACHE and self._local is not None and isinstance(result, dict):
            self._local.insert(self._name, result)
        return result

    def _execute_select(self) -> List[Dict[str, Any]]:
        if self._policy == POLICY_LOCAL:
            return self._require_local().select(
                self._name,
                filter_column=self._filter_column,
                filter_value=self._filter_value,
                limit=self._limit,
                offset=self._offset,
            )

        if self._policy == POLICY_CACHE and self._local is not None:
            local_rows = self._local.select(
                self._name,
                filter_column=self._filter_column,
                filter_value=self._filter_value,
                limit=self._limit,
                offset=self._offset,
            )
            if local_rows:
                return local_rows
            remote_rows = self._select_remote()
            if remote_rows:
                self._local.replace_all(self._name, remote_rows)
            return remote_rows

        return self._select_remote()

    def _select_remote(self) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {}
        if self._limit is not None:
            params["limit"] = self._limit
        if self._offset is not None:
            params["offset"] = self._offset
        if self._filter_column is not None and self._filter_value is not None:
            params["filter_column"] = self._filter_column
            params["filter_value"] = self._filter_value
        result = self._http.request(
            "GET", f"/tables/{self._name}", params=params or None,
        )
        return result if isinstance(result, list) else []

    def _execute_update(self) -> Dict[str, Any]:
        if self._filter_column != "id" or self._filter_value is None:
            raise ApiError(
                'update() currently requires .eq("id", value) '
                "because the backend only supports update-by-id."
            )
        assert self._update_data is not None
        row_id = self._filter_value

        if self._policy == POLICY_LOCAL:
            return self._require_local().update(self._name, row_id, self._update_data)

        result = self._http.request(
            "PATCH", f"/tables/{self._name}/{row_id}", json=self._update_data,
        )  # type: ignore[return-value]
        if self._policy == POLICY_CACHE and self._local is not None and isinstance(result, dict):
            self._local.insert(self._name, result)
        return result

    def _execute_delete(self) -> Any:
        if self._filter_column != "id" or self._filter_value is None:
            raise ApiError(
                'delete() currently requires .eq("id", value) '
                "because the backend only supports delete-by-id."
            )
        row_id = self._filter_value

        if self._policy == POLICY_LOCAL:
            return self._require_local().delete(self._name, row_id)

        result = self._http.request("DELETE", f"/tables/{self._name}/{row_id}")
        if self._policy == POLICY_CACHE and self._local is not None:
            try:
                self._local.delete(self._name, row_id)
            except ApiError:
                pass
        return result

    def _dispatch(self) -> Any:
        if self._op == "select":
            return self._execute_select()
        if self._op == "update":
            return self._execute_update()
        if self._op == "delete":
            return self._execute_delete()
        raise ApiError("No operation specified. Call select(), update(), or delete() first.")
