"""
Tests for request metrics: buffering, flushing, and the aggregation the
Analytics charts read.

The important properties are that a sample is never lost, that failures never
propagate into request handling, and that the series is dense — a gap must
render as zero traffic rather than a straight line across missing data.
"""

import time

import pytest

from backend.core import metrics
from backend.core.db import Database
from backend.core.migrations import run_pending_migrations


@pytest.fixture
def db(temp_dir):
    migrations_dir = temp_dir / "migrations"
    migrations_dir.mkdir()
    real = __import__("pathlib").Path(__file__).parent.parent.parent / "migrations"
    import shutil

    for f in real.glob("*.sql"):
        shutil.copy(f, migrations_dir / f.name)

    database = Database(str(temp_dir / "metrics.db"))
    database.connect()
    run_pending_migrations(database, str(migrations_dir))
    yield database
    database.close()


@pytest.fixture
def temp_dir():
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture(autouse=True)
def clean_buffer():
    """Reset module state between tests.

    ``_last_flush`` is a module global compared against wall-clock time, so
    without resetting it a test's sample could be flushed immediately depending
    on how long the previous test took — a timing-dependent assertion.
    """
    metrics._pending.clear()
    metrics._last_flush = time.monotonic()
    yield
    metrics._pending.clear()
    metrics._last_flush = time.monotonic()


class TestFiltering:
    def test_health_and_docs_are_skipped(self, db):
        for path in ("/health", "/docs", "/openapi.json", "/metrics"):
            metrics.record("p1", "GET", path, path, 200, 1.0)
        assert metrics._pending == []

    def test_preflight_is_skipped(self, db):
        metrics.record("p1", "OPTIONS", "/tables", "/tables", 200, 1.0)
        assert metrics._pending == []

    def test_unattributable_traffic_is_skipped(self, db):
        metrics.record(None, "GET", "/tables", "/tables", 200, 1.0)
        assert metrics._pending == []

    def test_real_traffic_is_buffered(self, db):
        metrics.record("p1", "get", "/tables", "/tables", 200, 12.0)
        assert len(metrics._pending) == 1


class TestFlush:
    def test_flush_writes_rows(self, db, monkeypatch):
        monkeypatch.setattr(metrics, "flush_now", lambda: metrics._flush_with(db))
        metrics.record("p1", "GET", "/tables", "/tables", 200, 12.0)
        metrics.record("p1", "GET", "/tables", "/tables", 200, 30.0)
        metrics.flush()

        cur = db.execute("SELECT COUNT(*) FROM metrics_buckets")
        assert cur.fetchone()[0] == 2

    def test_flush_is_idempotent(self, db):
        metrics.record("p1", "GET", "/tables", "/tables", 200, 12.0)
        metrics._flush_with(db)
        metrics._flush_with(db)
        cur = db.execute("SELECT COUNT(*) FROM metrics_buckets")
        assert cur.fetchone()[0] == 1

    def test_db_failure_does_not_raise(self, db, monkeypatch):
        class Broken(Database):
            def execute_many(self, sql, params_list):
                raise RuntimeError("disk on fire")

            def execute(self, sql, params=()):
                raise RuntimeError("disk on fire")

        broken = Broken(str(db.db_path) if hasattr(db, "db_path") else ":memory:")
        metrics.record("p1", "GET", "/tables", "/tables", 200, 1.0)
        metrics._flush_with(broken)  # must not raise

    def test_old_rows_are_pruned(self, db):
        old = time.time() - (30 * 24 * 3600)
        db.execute(
            "INSERT INTO metrics_buckets "
            "(project_id, bucket_ts, method, route, status, duration_ms, created_at) "
            "VALUES (?, ?, 'GET', '/tables', 200, 1.0, 'x')",
            ("p1", old),
        )
        metrics.record("p1", "GET", "/tables", "/tables", 200, 1.0)
        metrics._flush_with(db)

        cur = db.execute("SELECT COUNT(*) FROM metrics_buckets")
        assert cur.fetchone()[0] == 1


class TestQuery:
    def _seed(self, db, project_id, rows):
        now = time.time()
        db.execute_many(
            "INSERT INTO metrics_buckets "
            "(project_id, bucket_ts, method, route, status, duration_ms, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 'x')",
            [(project_id, now - offset, m, r, s, d) for offset, m, r, s, d in rows],
        )

    def test_returns_dense_series(self, db):
        # One sample a minute ago only. The window must still be filled.
        self._seed(db, "p1", [(60, "GET", "/tables", 200, 10.0)])
        result = metrics.query(db, "p1", 3600, bucket_seconds=60)

        assert len(result["points"]) > 1
        assert all("t" in p for p in result["points"])
        assert sum(p["requests"] for p in result["points"]) == 1

    def test_empty_project_returns_zeros_not_none(self, db):
        result = metrics.query(db, "nobody", 3600, bucket_seconds=60)
        assert result["totals"]["requests"] == 0
        assert result["totals"]["avg_ms"] is None
        assert result["totals"]["error_rate"] == 0.0
        assert all(p["requests"] == 0 for p in result["points"])

    def test_totals_count_requests_errors_and_server_errors(self, db):
        self._seed(
            db,
            "p1",
            [
                (10, "GET", "/tables", 200, 10.0),
                (20, "GET", "/tables", 404, 12.0),
                (30, "GET", "/tables", 500, 30.0),
                (40, "GET", "/tables", 200, 14.0),
            ],
        )
        totals = metrics.query(db, "p1", 3600, bucket_seconds=60)["totals"]

        assert totals["requests"] == 4
        assert totals["errors"] == 2
        assert totals["server_errors"] == 1
        assert totals["error_rate"] == 50.0

    def test_percentiles_are_ordered(self, db):
        self._seed(db, "p1", [(i, "GET", "/t", 200, float(i)) for i in range(1, 101)])
        totals = metrics.query(db, "p1", 3600, bucket_seconds=60)["totals"]

        assert totals["p50_ms"] <= totals["p95_ms"] <= totals["p99_ms"]

    def test_projects_are_isolated(self, db):
        self._seed(db, "p1", [(10, "GET", "/t", 200, 1.0)])
        self._seed(db, "p2", [(10, "GET", "/t", 200, 1.0)] * 5)

        assert metrics.query(db, "p1", 3600)["totals"]["requests"] == 1
        assert metrics.query(db, "p2", 3600)["totals"]["requests"] == 5

    def test_bucket_width_scales_with_range(self):
        assert metrics._bucket_width(3600) == 60
        assert metrics._bucket_width(6 * 3600) == 300
        assert metrics._bucket_width(24 * 3600) == 900
        assert metrics._bucket_width(7 * 24 * 3600) == 3600

    def test_range_length_does_not_explode_point_count(self, db):
        # 7 days at 1-hour buckets is ~169 points, not 10080.
        result = metrics.query(db, "p1", 7 * 24 * 3600)
        assert len(result["points"]) < 200