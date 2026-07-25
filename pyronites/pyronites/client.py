"""Main façade for the pyronites client."""

from __future__ import annotations

from typing import Optional

from pyronites.auth import AuthClient
from pyronites.config import ClientConfig, load_config
from pyronites.http import HttpTransport
from pyronites.storage import StorageClient
from pyronites.table import TableQuery


class PyronitesClient:
    """High-level client. Prefer ``create_client()`` over constructing this directly."""

    def __init__(self, config: ClientConfig) -> None:
        self._config = config
        self._http = HttpTransport(config)
        self.auth = AuthClient(self._http)
        self.storage = StorageClient(self._http)

    def table(self, name: str) -> TableQuery:
        """Return a fluent table handle for the given table name."""
        if not name or not isinstance(name, str):
            from pyronites.errors import ApiError
            raise ApiError("table name must be a non-empty string")
        return TableQuery(self._http, name)

    def sql(self, query: str) -> dict:
        """Execute raw SQL (admin-scoped key required).

        Maps to ``POST /sql/execute``. Use with caution.
        """
        return self._http.request(  # type: ignore[return-value]
            "POST",
            "/sql/execute",
            json={"sql": query},
        )

    def close(self) -> None:
        """Close the underlying HTTP session."""
        self._http.close()

    def __enter__(self) -> "PyronitesClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def create_client(
    url: Optional[str] = None,
    key: Optional[str] = None,
    timeout: float = 30.0,
) -> PyronitesClient:
    """Create a configured Pyronites client.

    Parameters
    ----------
    url:
        Backend base URL. Falls back to ``PYRONITES_URL``.
    key:
        API key. Falls back to ``PYRONITES_KEY``.
    timeout:
        Request timeout in seconds (default 30).

    Returns
    -------
    PyronitesClient
    """
    config = load_config(url=url, key=key, timeout=timeout)
    return PyronitesClient(config)
