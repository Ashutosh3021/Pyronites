"""Configuration resolution for the pyronites client."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from pyronites.errors import ApiError


@dataclass(frozen=True)
class ClientConfig:
    """Resolved client configuration.

    Attributes
    ----------
    url:
        Backend base URL with no trailing slash.
    key:
        API key, or ``None`` when only session/cookie auth will be used.
    timeout:
        Request timeout in seconds.
    """

    url: str
    key: Optional[str]
    timeout: float = 30.0


def _normalize_url(url: str) -> str:
    return url.rstrip("/")


def load_config(
    url: Optional[str] = None,
    key: Optional[str] = None,
    timeout: float = 30.0,
) -> ClientConfig:
    """Resolve URL and key from arguments then environment.

    Resolution order
    ----------------
    1. Explicit argument
    2. Environment variable (``PYRONITES_URL`` / ``PYRONITES_KEY``)
    3. Built-in default only for ``timeout``

    Raises
    ------
    ApiError
        If no URL can be resolved.
    """
    resolved_url = url if url is not None else os.environ.get("PYRONITES_URL")
    resolved_key = key if key is not None else os.environ.get("PYRONITES_KEY")

    if not resolved_url:
        raise ApiError(
            "Missing backend URL. Pass url=... to create_client() "
            "or set the PYRONITES_URL environment variable."
        )

    return ClientConfig(
        url=_normalize_url(resolved_url),
        key=resolved_key or None,
        timeout=timeout,
    )
