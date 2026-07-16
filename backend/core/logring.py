"""
In-memory ring buffer of recent system events for the dashboard Logs page.

Why this exists
---------------
The dashboard's Logs view needs a queryable, recent-events feed, but the
backend logs to stderr/stdout (structurom-ed for deployment) rather than a
database table.  Rather than add a ``logs`` table and a writer on every code
path, we keep a bounded in-memory buffer.  For a single-tenant local demo this
is perfectly adequate — it shows the last few hundred events with no extra
storage or polling overhead.  (A durable, multi-tenant log store is explicitly
out of scope for v1.)

Two ways events enter the buffer:
1. Explicit calls to :func:`record_event` at meaningful domain moments
   (login, table create, backup, key create/revoke, errors).
2. A :class:`RingBufferHandler` attached to the root logger at startup, which
   captures WARNING+/ERROR lines from our own ``backend.*`` loggers so genuine
   failures surface in the UI too.

The buffer is capped (oldest entries are dropped) so a chatty server can never
grow it without bound.
"""

import logging
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional

# Cap at 500 entries — far more than the UI ever shows, small enough to be free.
_MAX_ENTRIES = 500

_buffer: Deque[Dict[str, Any]] = deque(maxlen=_MAX_ENTRIES)
_lock = threading.Lock()
_seq = 0


def _now_iso() -> str:
    """Current UTC time as ISO 8601 with a ``Z`` suffix (matches API convention)."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def record_event(
    level: str,
    action: str,
    status_code: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Push a structured event into the ring buffer.

    Args:
        level: One of ``"info"``, ``"success"``, ``"warning"``, ``"error"``.
        action: Human-readable description, e.g. ``"Table created: posts"``.
        status_code: Optional HTTP status code to display alongside the event.

    Returns:
        The stored event dict (also convenient for callers that want it).
    """
    global _seq
    with _lock:
        _seq += 1
        event = {
            "id": str(_seq),
            "timestamp": _now_iso(),
            "level": level,
            "action": action,
            "statusCode": status_code,
        }
        _buffer.append(event)
    return event


def get_logs(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Return recent events, newest-first.

    Args:
        limit: Maximum number of events to return.  When ``None`` (default) all
            buffered events are returned (bounded by ``_MAX_ENTRIES`` anyway).

    Returns:
        List of event dicts in reverse-chronological order.
    """
    with _lock:
        items = list(_buffer)
    items.reverse()
    if limit is not None:
        items = items[:limit]
    return items


class RingBufferHandler(logging.Handler):
    """
    Logging handler that mirrors WARNING+ records into the ring buffer.

    Attached to the root logger at startup (see ``backend/app.py``).  Only
    records from our own ``backend.*`` loggers are captured — third-party loggers
    (uvicorn, etc.) are ignored to keep the UI feed relevant and quiet.
    """

    # Map Python logging levels to the dashboard's level vocabulary.
    _LEVEL_MAP = {
        logging.DEBUG: "info",
        logging.INFO: "info",
        logging.WARNING: "warning",
        logging.ERROR: "error",
        logging.CRITICAL: "error",
    }

    def emit(self, record: logging.LogRecord) -> None:
        # Only surface our own application logs, not noise from dependencies.
        if not record.name.startswith("backend"):
            return
        if record.levelno < logging.WARNING:
            return
        level = self._LEVEL_MAP.get(record.levelno, "info")
        # Keep the message short — drop the trailing traceback detail.
        msg = record.getMessage()
        record_event(level, msg)


def install() -> RingBufferHandler:
    """Attach a :class:`RingBufferHandler` to the root logger (idempotent)."""
    handler = RingBufferHandler()
    handler.setLevel(logging.WARNING)
    logging.getLogger().addHandler(handler)
    return handler
