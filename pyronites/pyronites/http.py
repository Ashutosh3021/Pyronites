"""HTTP transport layer for the pyronites client."""

from __future__ import annotations

import time
from typing import Any, Dict, Optional, Set

import httpx

from pyronites.config import ClientConfig
from pyronites.errors import ApiError, AuthError, NotFoundError

_RETRYABLE_STATUS: Set[int] = {502, 503, 504}
_DEFAULT_MAX_RETRIES = 2
_DEFAULT_BACKOFF_BASE = 0.3


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

    @property
    def config(self) -> ClientConfig:
        return self._config

    def close(self) -> None:
        self._client.close()

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
        """Perform a request with conservative retries on transient failures."""
        if not path.startswith("/"):
            path = "/" + path

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
