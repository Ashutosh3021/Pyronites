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

import logging
import math
import time
from typing import Optional, Tuple

from fastapi import Request

from backend.core.db import Database

logger = logging.getLogger(__name__)


def get_client_ip(request: Request) -> str:
    """Extract the client IP from the request, respecting X-Forwarded-For."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


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
        # Lazy cleanup: delete expired rows for this key+endpoint
        db.execute(
            "DELETE FROM rate_limit_hits WHERE key = ? AND endpoint = ? AND expires_at < ?",
            (key, endpoint, now),
        )

        # Count current hits in the window
        cur = db.execute(
            "SELECT COUNT(*) FROM rate_limit_hits WHERE key = ? AND endpoint = ? AND hit_at > ?",
            (key, endpoint, window_start),
        )
        count = cur.fetchone()[0]

        if count >= limit:
            # Blocked — find the oldest hit to compute Retry-After
            cur = db.execute(
                "SELECT MIN(hit_at) FROM rate_limit_hits WHERE key = ? AND endpoint = ? AND hit_at > ?",
                (key, endpoint, window_start),
            )
            oldest = cur.fetchone()[0]
            retry_after = max(1, int(oldest + window_sec - now)) if oldest else window_sec
            return False, 0, reset_at

        # Allowed — record this hit
        db.execute(
            "INSERT INTO rate_limit_hits (key, endpoint, hit_at, expires_at) VALUES (?, ?, ?, ?)",
            (key, endpoint, now, now + window_sec),
        )
        remaining = limit - count - 1
        return True, remaining, reset_at

    except Exception:
        # If rate limiting fails, allow the request rather than blocking
        logger.warning("Rate limit check failed for key=%s endpoint=%s", key, endpoint, exc_info=True)
        return True, limit, reset_at
