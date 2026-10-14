"""
Request metrics for the Analytics page: volume, latency and error rate over
time.

Design notes:

* **Buffered, not per-request writes.** Every request would otherwise cost an
  INSERT. Samples accumulate in memory and are flushed with a single
  ``execute_many`` when the buffer fills or the interval elapses.
* **Route templates, not paths.** Storing ``/tables/notes_42`` would make every
  table name its own time series and blow up the row count. The matched route
  pattern keeps it bounded.
* **Meta DB, keyed by project_id.** Metrics are per-project but the write path
  must not depend on resolving a project database, which would turn every
  request into two database acquisitions.
* **Retention is enforced on flush.** Otherwise the table grows without bound
  on a long-running instance.
"""

from __future__ import annotations

import logging
import math
import os
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from backend.core.db import Database, DatabaseError, acquire_database, release_database
from backend.core.projects import meta_db_path

logger = logging.getLogger(__name__)

# Flush when either trigger fires.
_FLUSH_MAX_SAMPLES = 100
_FLUSH_INTERVAL_SECONDS = 5.0

# 7 days. The dashboard's longest range is 24h, so this is generous.
DEFAULT_RETENTION_SECONDS = 7 * 24 * 3600

# Paths that would only add noise to the charts.
_SKIP_PREFIXES = ("/health", "/metrics", "/docs", "/redoc", "/openapi.json", "/_next")

_pending: List[Tuple[Any, ...]] = []
_pending_lock = threading.Lock()
_last_flush = time.monotonic()


def _retention_seconds() -> int:
    return int(os.environ.get("METRICS_RETENTION_SECONDS", str(DEFAULT_RETENTION_SECONDS)))


def _should_skip(path: str, method: str) -> bool:
    # CORS preflight is not application traffic.
    if method == "OPTIONS":
        return True
    return any(path.startswith(prefix) for prefix in _SKIP_PREFIXES)


def record(
    project_id: Optional[str],
    method: str,
    path: str,
    route_template: Optional[str],
    status_code: int,
    duration_ms: float,
) -> None:
    """Buffer one request sample. Never raises, never blocks on I/O."""
    global _last_flush

    if _should_skip(path, method):
        return
    if not project_id:
        # Unauthenticated traffic (login attempts, the providers' callbacks) is
        # not attributable to a project and cannot be charted per project.
        return

    sample = (
        project_id,
        time.time(),
        method.upper()[:10],
        (route_template or path)[:200],
        int(status_code),
        round(float(duration_ms), 3),
        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )

    flush = False
    with _pending_lock:
        _pending.append(sample)
        if len(_pending) >= _FLUSH_MAX_SAMPLES or (
            time.monotonic() - _last_flush >= _FLUSH_INTERVAL_SECONDS
        ):
            _last_flush = time.monotonic()
            flush = True

    if flush:
        flush_now()


def _take() -> List[Tuple[Any, ...]]:
    with _pending_lock:
        batch = list(_pending)
        _pending.clear()
    return batch


def flush_now() -> None:
    """Acquire the meta DB, drain the buffer, release. Never raises."""
    db = None
    try:
        db = acquire_database(meta_db_path())
        _flush_with(db)
    except Exception:
        logger.warning("Metric flush failed", exc_info=True)
    finally:
        if db is not None:
            try:
                release_database(db)
            except Exception:
                pass


def _flush_with(db: Database) -> None:
    with _pending_lock:
        batch = list(_pending)
        _pending.clear()
    return batch


def _flush_with(db: Database) -> None:
    batch = _take()
    if not batch:
        return
    try:
        db.execute_many(
            """
            INSERT INTO metrics_buckets
                (project_id, bucket_ts, method, route, status, duration_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            batch,
        )
        cutoff = time.time() - _retention_seconds()
        db.execute("DELETE FROM metrics_buckets WHERE bucket_ts < ?", (cutoff,))
    except Exception:
        # Deliberately broad. This runs inside the request path, and the
        # contract is that metrics can never take the API down — sqlite can
        # surface errors that are not DatabaseError subclasses.
        logger.warning("Failed to flush %d metric samples", len(batch), exc_info=True)


def flush() -> None:
    """Force a flush. Used by tests and on shutdown."""
    flush_now()


def _bucket_width(seconds: int) -> int:
    """Pick a bucket width that yields a readable number of points."""
    if seconds <= 3600:
        return 60
    if seconds <= 6 * 3600:
        return 300
    if seconds <= 24 * 3600:
        return 900
    return 3600


def query(
    db: Database,
    project_id: str,
    range_seconds: int,
    bucket_seconds: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Return a dense time series for one project.

    Gaps are filled with zero-count buckets so a chart shows a flat line rather
    than silently joining across a period with no traffic.
    """
    now = time.time()
    start = now - range_seconds
    width = bucket_seconds or _bucket_width(range_seconds)
    start_aligned = math.floor(start / width) * width

    try:
        cur = db.execute(
            """
            SELECT
                CAST((bucket_ts - ?) / ? AS INTEGER) AS bucket,
                COUNT(*),
                AVG(duration_ms),
                SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END),
                SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END)
            FROM metrics_buckets
            WHERE project_id = ? AND bucket_ts >= ?
            GROUP BY bucket
            ORDER BY bucket
            """,
            (start_aligned, width, project_id, start_aligned),
        )
        rows = cur.fetchall()
    except DatabaseError:
        logger.warning("Metrics query failed for project %s", project_id, exc_info=True)
        rows = []

    found = {int(r[0]): r for r in rows}
    point_count = int((now - start_aligned) // width) + 1

    points: List[Dict[str, Any]] = []
    total_requests = 0
    total_errors = 0
    total_server_errors = 0
    latency_sum = 0.0

    for index in range(point_count):
        bucket_ts = start_aligned + index * width
        row = found.get(index)
        if row is None:
            points.append(
                {
                    "t": int(bucket_ts * 1000),
                    "requests": 0,
                    "avg_ms": None,
                    "errors": 0,
                    "server_errors": 0,
                }
            )
            continue
        _, count, avg_ms, errors, server_errors = row
        count = int(count or 0)
        errors = int(errors or 0)
        server_errors = int(server_errors or 0)
        total_requests += count
        total_errors += errors
        total_server_errors += server_errors
        if avg_ms is not None:
            latency_sum += float(avg_ms) * count
        points.append(
            {
                "t": int(bucket_ts * 1000),
                "requests": count,
                "avg_ms": round(float(avg_ms), 2) if avg_ms is not None else None,
                "errors": errors,
                "server_errors": server_errors,
            }
        )

    # Latency percentiles need the raw values, not per-bucket averages.
    try:
        cur = db.execute(
            "SELECT duration_ms FROM metrics_buckets "
            "WHERE project_id = ? AND bucket_ts >= ? ORDER BY duration_ms",
            (project_id, start_aligned),
        )
        durations = [float(r[0]) for r in cur.fetchall()]
    except DatabaseError:
        durations = []

    def percentile(p: float) -> Optional[float]:
        if not durations:
            return None
        index = min(len(durations) - 1, int(round((p / 100) * (len(durations) - 1))))
        return round(durations[index], 2)

    return {
        "range_seconds": range_seconds,
        "bucket_seconds": width,
        "points": points,
        "totals": {
            "requests": total_requests,
            "errors": total_errors,
            "server_errors": total_server_errors,
            "error_rate": round(total_errors / total_requests * 100, 2) if total_requests else 0.0,
            "avg_ms": round(latency_sum / total_requests, 2) if total_requests else None,
            "p50_ms": percentile(50),
            "p95_ms": percentile(95),
            "p99_ms": percentile(99),
        },
    }