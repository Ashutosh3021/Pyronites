"""Configuration resolution for the pyronites client."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from pyronites.errors import ApiError


@dataclass(frozen=True)
class ClientConfig:
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
