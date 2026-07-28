"""
In-memory ring buffer of recent system events for the dashboard Logs page.

Events may carry an optional ``project_id`` so the UI can filter per project.
"""

import logging
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional

_MAX_ENTRIES = 500

_buffer: Deque[Dict[str, Any]] = deque(maxlen=_MAX_ENTRIES)
_lock = threading.Lock()
_seq = 0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def record_event(
    level: str,
    action: str,
    status_code: Optional[int] = None,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Push a structured event into the ring buffer.

    Args:
        level: ``info`` | ``success`` | ``warning`` | ``error``
        action: Human-readable description
        status_code: Optional HTTP status
        project_id: Optional project UUID/slug for filtering
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
            "project_id": project_id,
        }
        _buffer.append(event)
    return event


def get_logs(
    limit: Optional[int] = None,
    project_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return recent events, newest-first. Optionally filter by project_id."""
    with _lock:
        items = list(_buffer)
    items.reverse()
    if project_id:
        items = [
            e
            for e in items
            if e.get("project_id") is None or e.get("project_id") == project_id
        ]
    if limit is not None:
        items = items[:limit]
    return items


class RingBufferHandler(logging.Handler):
    _LEVEL_MAP = {
        logging.DEBUG: "info",
        logging.INFO: "info",
        logging.WARNING: "warning",
        logging.ERROR: "error",
        logging.CRITICAL: "error",
    }

    def emit(self, record: logging.LogRecord) -> None:
        if not record.name.startswith("backend"):
            return
        if record.levelno < logging.WARNING:
            return
        level = self._LEVEL_MAP.get(record.levelno, "info")
        msg = record.getMessage()
        record_event(level, msg)


def install() -> RingBufferHandler:
    handler = RingBufferHandler()
    handler.setLevel(logging.WARNING)
    logging.getLogger().addHandler(handler)
    return handler
