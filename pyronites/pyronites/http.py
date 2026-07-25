"""HTTP transport layer for the pyronites client."""

from __future__ import annotations

from typing import Any, Dict, Optional

import httpx

from pyronites.config import ClientConfig
from pyronites.errors import ApiError, AuthError, NotFoundError


class HttpTransport:
    """Thin wrapper around ``httpx.Client`` with auth headers and error mapping."""

    def __init__(self, config: ClientConfig) -> None:
        self._config = config
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
        """Perform a request and return parsed JSON (or ``None`` for empty body).

        Raises typed exceptions for non-2xx responses.
        """
        if not path.startswith("/"):
            path = "/" + path

        try:
            response = self._client.request(
                method,
                path,
                json=json,
                params=params,
                files=files,
                data=data,
            )
        except httpx.TimeoutException as exc:
            raise ApiError(f"Request timed out after {self._config.timeout}s") from exc
        except httpx.RequestError as exc:
            raise ApiError(f"Network error: {exc}") from exc

        return self._handle_response(response)

    def _handle_response(self, response: httpx.Response) -> Any:
        if response.status_code >= 200 and response.status_code < 300:
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
