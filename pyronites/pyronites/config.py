"""Configuration resolution for the pyronites client."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import FrozenSet, Optional, Sequence

from pyronites.errors import ApiError

POLICY_REMOTE = "remote"
POLICY_LOCAL = "local"
POLICY_CACHE = "cache"


@dataclass(frozen=True)
class ClientConfig:
    """Resolved client configuration."""

    url: str
    key: Optional[str]
    timeout: float = 30.0
    local_tables: FrozenSet[str] = field(default_factory=frozenset)
    remote_tables: FrozenSet[str] = field(default_factory=frozenset)
    cache_tables: FrozenSet[str] = field(default_factory=frozenset)
    local_db_path: Optional[str] = None

    def table_policy(self, name: str) -> str:
        """Return policy for a table: local, cache, or remote (default).

        Priority: local_tables > cache_tables > remote (default).
        """
        if name in self.local_tables:
            return POLICY_LOCAL
        if name in self.cache_tables:
            return POLICY_CACHE
        return POLICY_REMOTE


def _normalize_url(url: str) -> str:
    return url.rstrip("/")


def _to_frozenset(names: Optional[Sequence[str]]) -> FrozenSet[str]:
    if not names:
        return frozenset()
    return frozenset(str(n) for n in names)


def load_config(
    url: Optional[str] = None,
    key: Optional[str] = None,
    timeout: float = 30.0,
    local_tables: Optional[Sequence[str]] = None,
    remote_tables: Optional[Sequence[str]] = None,
    cache_tables: Optional[Sequence[str]] = None,
    local_db_path: Optional[str] = None,
) -> ClientConfig:
    resolved_url = url if url is not None else os.environ.get("PYRONITES_URL")
    resolved_key = key if key is not None else os.environ.get("PYRONITES_KEY")

    if not resolved_url:
        raise ApiError(
            "Missing backend URL. Pass url=... to create_client() "
            "or set the PYRONITES_URL environment variable."
        )

    path = local_db_path
    if path is None:
        path = os.environ.get("PYRONITES_LOCAL_DB")

    return ClientConfig(
        url=_normalize_url(resolved_url),
        key=resolved_key or None,
        timeout=timeout,
        local_tables=_to_frozenset(local_tables),
        remote_tables=_to_frozenset(remote_tables),
        cache_tables=_to_frozenset(cache_tables),
        local_db_path=path,
    )
