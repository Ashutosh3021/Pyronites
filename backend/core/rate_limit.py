"""
DB-backed rate limiting with sliding window counters.

State is stored in the ``rate_limit_hits`` table so it survives restarts and
is shared across workers.  Each hit is a row with an ``expires_at`` timestamp;
cleanup happens lazily on every check (DELETE WHERE expires_at < now).

Headers to return on 429 (or on every response for transparency):
- ``Retry-After``: seconds until the client should retry (only on 429)
- ``X-RateLimit-Limit``: max requests allowed in the window
- ``X-RateLimit-Remaining``: requests left in the current window
- ``X-RateLimit-Reset``: Unix timestamp when the window resets
"""

from __future__ import annotations

import ipaddress
import logging
import math
import os
import time
from typing import List, Optional, Tuple

from fastapi import Request

from backend.core.db import Database

logger = logging.getLogger(__name__)

# H2: X-Forwarded-For is client-controlled unless it arrives from a proxy WE
# trust.  Default trust list = loopback (typical reverse-proxy-on-same-host
# deployments, matching uvicorn's own default) + RFC1918 private ranges
# (docker gateways, cloud load balancers).  Only the LAST XFF entry from a
# trusted peer is honoured.  Set TRUSTED_PROXY_IPS to override
# (comma-separated IPs/CIDRs; empty string = trust nobody / ignore XFF —
# the harness and tests use this so locally-spoofed XFF cannot split buckets).
DEFAULT_TRUSTED_PROXIES = ("127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")

_trusted_cache: Optional[Tuple[str, List]] = None


def _trusted_proxies() -> List:
    """Parse TRUSTED_PROXY_IPS (env) into ip_network objects, cached."""
    global _trusted_cache
    raw = os.environ.get("TRUSTED_PROXY_IPS")
    cache_key = raw if raw is not None else "__default__"
    if _trusted_cache is not None and _trusted_cache[0] == cache_key:
        return _trusted_cache[1]

    if raw is None:
        entries = list(DEFAULT_TRUSTED_PROXIES)
    else:
        entries = [e.strip() for e in raw.split(",") if e.strip()]

    networks: List = []
    for entry in entries:
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            logger.warning("Ignoring invalid TRUSTED_PROXY_IPS entry: %r", entry)
    _trusted_cache = (cache_key, networks)
    return networks


def _is_trusted(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _trusted_proxies())


def get_client_ip(request: Request) -> str:
    """
    Extract the client IP for rate-limit keying.

    X-Forwarded-For is honoured ONLY when the direct peer is a trusted proxy
    (see TRUSTED_PROXY_IPS), and then only the LAST entry is used — the one
    appended by the nearest trusted proxy. Earlier entries are client-supplied
    and trivially spoofable. With no trusted proxy configured the peer address
    is used, so spoofed headers can never split a client across buckets.
    """
    peer = request.client.host if request.client else "unknown"
    if not _is_trusted(peer):
        return peer
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        last = forwarded.split(",")[-1].strip()
        if last:
            return last
    return peer


def check_and_record(
    db: Database,
    key: str,
    endpoint: str,
    limit: int,
    window_sec: int,
) -> Tuple[bool, int, float]:
    """
    Check whether ``key`` is within the rate limit for ``endpoint`` and
    record this hit if allowed.

    Args:
        db: Active database connection.
        key: Rate limit key (e.g. ``"ip:1.2.3.4"`` or ``"apikey:abc123"``).
        endpoint: Endpoint identifier (e.g. ``"auth:login"``).
        limit: Maximum hits allowed in the window.
        window_sec: Window duration in seconds.

    Returns:
        ``(allowed, remaining, reset_at)`` where:
        - ``allowed``: True if the request is within the limit.
        - ``remaining``: Number of requests left (0 if blocked).
        - ``reset_at``: Unix timestamp when the current window expires.
    """
    now = time.time()
    window_start = now - window_sec
    reset_at = math.ceil(now + window_sec)

    try:
        # H2: count + insert must be ONE transaction, otherwise N concurrent
        # requests can all read count < limit and all insert (TOCTOU bypass).
        # transaction() holds the Database RLock for the whole block, so the
        # read and the write are serialized in-process as well.
        with db.transaction() as conn:
            # Lazy cleanup: delete expired rows for this key+endpoint
            conn.execute(
                "DELETE FROM rate_limit_hits WHERE key = ? AND endpoint = ? AND expires_at < ?",
                (key, endpoint, now),
            )

            # Count current hits in the window
            cur = conn.execute(
                "SELECT COUNT(*) FROM rate_limit_hits WHERE key = ? AND endpoint = ? AND hit_at > ?",
                (key, endpoint, window_start),
            )
            count = cur.fetchone()[0]

            if count >= limit:
                # Blocked — find the oldest hit to compute Retry-After
                cur = conn.execute(
                    "SELECT MIN(hit_at) FROM rate_limit_hits WHERE key = ? AND endpoint = ? AND hit_at > ?",
                    (key, endpoint, window_start),
                )
                oldest = cur.fetchone()[0]
                retry_after = max(1, int(oldest + window_sec - now)) if oldest else window_sec
                return False, 0, reset_at

            # Allowed — record this hit (committed when the transaction exits)
            conn.execute(
                "INSERT INTO rate_limit_hits (key, endpoint, hit_at, expires_at) VALUES (?, ?, ?, ?)",
                (key, endpoint, now, now + window_sec),
            )
            remaining = limit - count - 1
            return True, remaining, reset_at

    except Exception:
        # If rate limiting fails, allow the request rather than blocking
        logger.warning("Rate limit check failed for key=%s endpoint=%s", key, endpoint, exc_info=True)
        return True, limit, reset_at
