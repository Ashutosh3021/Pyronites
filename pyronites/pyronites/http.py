"""HTTP transport layer for the pyronites client."""

from __future__ import annotations

import hashlib
import threading
import time
from typing import Any, Dict, Optional, Set, Tuple

import httpx

from pyronites.config import ClientConfig
from pyronites.errors import ApiError, AuthError, NotFoundError

_RETRYABLE_STATUS: Set[int] = {502, 503, 504}
_DEFAULT_MAX_RETRIES = 2
_DEFAULT_BACKOFF_BASE = 1.0
_MAX_RETRY_AFTER_SECONDS = 120.0

# Paths that belong to a project's data plane.  When a project id is
# configured, these are rewritten to ``/api/projects/{project_id}/...`` so the
# request is guaranteed to land in that project's own database.  Auth and the
# project registry are tenancy-blind and stay unscoped.
_SCOPED_PREFIXES: Tuple[str, ...] = ("/tables", "/storage", "/sql", "/api/keys")


def scope_path(path: str, project_id: Optional[str]) -> str:
    """Return the project-scoped form of ``path`` when a project id is set."""
    if not project_id:
        return path
    if not path.startswith("/"):
        path = "/" + path
    if path.startswith("/api/projects/"):
        return path
    if not path.startswith(_SCOPED_PREFIXES):
        return path
    return f"/api/projects/{project_id}{path}"


def _parse_retry_after(response: httpx.Response) -> Optional[float]:
    """Parse the Retry-After header from a 429 response.

    Returns the number of seconds to wait, or ``None`` if the header is
    missing or malformed.
    """
    value = response.headers.get("Retry-After")
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        pass
    return None


class _InFlight:
    """A request that is currently on the wire, shared with concurrent callers."""

    __slots__ = ("event", "result", "error")

    def __init__(self) -> None:
        self.event = threading.Event()
        self.result: Any = None
        self.error: Optional[BaseException] = None


class HttpTransport:
    """Thin wrapper around ``httpx.Client`` with auth headers, retries, and error mapping."""

    def __init__(
        self,
        config: ClientConfig,
        *,
        max_retries: int = _DEFAULT_MAX_RETRIES,
        backoff_base: float = _DEFAULT_BACKOFF_BASE,
    ) -> None:
        self._config = config
        self._max_retries = max(0, max_retries)
        self._backoff_base = backoff_base
        headers: Dict[str, str] = {}
        if config.key:
            headers["Authorization"] = f"Bearer {config.key}"
        self._client = httpx.Client(
            base_url=config.url,
            headers=headers,
            timeout=config.timeout,
            follow_redirects=True,
        )
        self._inflight: Dict[str, _InFlight] = {}
        self._inflight_lock = threading.Lock()
        self._pk_cache: Dict[str, Optional[str]] = {}

    @property
    def config(self) -> ClientConfig:
        return self._config

    def close(self) -> None:
        self._client.close()

    def _request_key(
        self, method: str, path: str, params: Optional[Dict[str, Any]]
    ) -> str:
        raw = f"{method.upper()}:{path}:{sorted((params or {}).items())}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def primary_key(self, table: str) -> Optional[str]:
        """
        Return the column that addresses a single row of ``table``.

        The backend resolves the row key from the table schema, so the client
        must use the same column. Results are cached per table — the schema of
        a table rarely changes during a process's lifetime.
        """
        if table in self._pk_cache:
            return self._pk_cache[table]
        path = scope_path(f"/tables/{table}/schema", self._config.project_id)
        result = self.request("GET", path)
        key: Optional[str] = None
        if isinstance(result, list):
            columns = [c for c in result if isinstance(c, dict)]
            primary = next((c for c in columns if c.get("pk")), None)
            if primary and primary.get("name"):
                key = str(primary["name"])
            elif any(str(c.get("name", "")).lower() == "id" for c in columns):
                key = "id"
        self._pk_cache[table] = key
        return key

    def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: Optional[Dict[str, Any]] = None,
        files: Any = None,
        data: Any = None,
    ) -> Any:
        """Perform a request with conservative retries on transient failures.

        Identical *concurrent* requests are coalesced so burst traffic does not
        double up on the same endpoint.  A completed request is never replayed
        from a cache: a ``select`` that ran before a write must not return the
        pre-write rows on the next call.
        """
        if not path.startswith("/"):
            path = "/" + path
        path = scope_path(path, self._config.project_id)

        key = self._request_key(method, path, params)
        with self._inflight_lock:
            entry = self._inflight.get(key)
            if entry is None:
                entry = _InFlight()
                self._inflight[key] = entry
                owner = True
            else:
                owner = False

        if not owner:
            # Somebody else is already making this exact call — wait for them.
            entry.event.wait(self._config.timeout)
            if entry.error is not None:
                raise entry.error
            return entry.result

        try:
            result = self._do_request(method, path, json=json, params=params, files=files, data=data)
            entry.result = result
            return result
        except BaseException as exc:  # noqa: BLE001 — re-raised below
            entry.error = exc
            raise
        finally:
            entry.event.set()
            with self._inflight_lock:
                if self._inflight.get(key) is entry:
                    del self._inflight[key]

    def _do_request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: Optional[Dict[str, Any]] = None,
        files: Any = None,
        data: Any = None,
    ) -> Any:
        last_exc: Optional[Exception] = None
        attempts = self._max_retries + 1

        for attempt in range(attempts):
            try:
                response = self._client.request(
                    method, path, json=json, params=params, files=files, data=data,
                )
            except httpx.TimeoutException as exc:
                last_exc = ApiError(f"Request timed out after {self._config.timeout}s")
                last_exc.__cause__ = exc
                if attempt < self._max_retries:
                    time.sleep(self._backoff_base * (2 ** attempt))
                    continue
                raise last_exc from exc
            except httpx.RequestError as exc:
                last_exc = ApiError(f"Network error: {exc}")
                last_exc.__cause__ = exc
                if attempt < self._max_retries:
                    time.sleep(self._backoff_base * (2 ** attempt))
                    continue
                raise last_exc from exc

            if response.status_code == 429 and attempt < self._max_retries:
                retry_after = _parse_retry_after(response)
                if retry_after is not None:
                    wait = min(retry_after, _MAX_RETRY_AFTER_SECONDS)
                else:
                    wait = self._backoff_base * (2 ** attempt)
                time.sleep(wait)
                continue

            if response.status_code in _RETRYABLE_STATUS and attempt < self._max_retries:
                time.sleep(self._backoff_base * (2 ** attempt))
                continue

            return self._handle_response(response)

        if last_exc is not None:
            raise last_exc
        raise ApiError("Request failed after retries")

    def _handle_response(self, response: httpx.Response) -> Any:
        if 200 <= response.status_code < 300:
            if not response.content:
                return None
            try:
                return response.json()
            except ValueError:
                return response.content

        code: Optional[str] = None
        message = response.text or f"HTTP {response.status_code}"
        body: Any = None
        try:
            body = response.json()
            detail = body.get("detail") if isinstance(body, dict) else None
            if isinstance(detail, dict):
                code = detail.get("code")
                message = detail.get("message") or message
            elif isinstance(body, dict):
                code = body.get("code")
                message = body.get("message") or message
        except ValueError:
            pass

        status = response.status_code
        if status in (401, 403):
            raise AuthError(message, status_code=status, code=code, body=body)
        if status == 404:
            raise NotFoundError(message, status_code=status, code=code, body=body)
        raise ApiError(message, status_code=status, code=code, body=body)
