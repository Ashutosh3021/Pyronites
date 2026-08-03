
import os
from pathlib import Path
import shutil
import tempfile
import pytest
from backend.core.db import Database, DatabaseError
from backend.core.migrations import run_pending_migrations


class TestMigrations:
    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory and clean it up after test."""
        temp_path = tempfile.mkdtemp()
        yield temp_path
        shutil.rmtree(temp_path)

    @pytest.fixture
    def temp_db_path(self, temp_dir):
        """Create a temporary database path and clean it up after test."""
        db_path = os.path.join(temp_dir, "test.db")
        yield db_path

    @pytest.fixture
    def migrations_test_dir(self, temp_dir):
        """Create a temporary migrations directory with test migrations."""
        migrations_dir = os.path.join(temp_dir, "migrations")
        os.makedirs(migrations_dir)
        return migrations_dir

    def test_migrations_do_not_rerun_once_applied(self, temp_db_path, migrations_test_dir):
        real_migrations_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "migrations"
        )
        shutil.copy(
            os.path.join(real_migrations_dir, "0001_init.sql"),
            os.path.join(migrations_test_dir, "0001_init.sql")
        )
        db = Database(temp_db_path)
        db.connect()
        run_pending_migrations(db, migrations_test_dir)
        cursor = db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cursor.fetchall()}
        assert "migrations" in tables
        assert "users" in tables
        assert "sessions" in tables
        cursor = db.execute("SELECT id FROM migrations WHERE id = ?", ("0001",))
        assert cursor.fetchone() is not None
        run_pending_migrations(db, migrations_test_dir)
        cursor = db.execute("SELECT COUNT(*) FROM migrations")
        assert cursor.fetchone()[0] == 1
        db.close()

    def test_migration_failure_rolls_back(self, temp_db_path, migrations_test_dir):
        with open(os.path.join(migrations_test_dir, "0001_good.sql"), "w") as f:
            f.write("""
CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, name TEXT, applied_at TIMESTAMP);
CREATE TABLE test1 (id INTEGER PRIMARY KEY);
            """)
        db = Database(temp_db_path)
        db.connect()
        run_pending_migrations(db, migrations_test_dir)
        cursor = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='test1'")
        assert cursor.fetchone() is not None
        db.close()
        with open(os.path.join(migrations_test_dir, "0002_bad.sql"), "w") as f:
            f.write("""
CREATE TABLE test2 (id INTEGER PRIMARY KEY);
THIS IS INVALID SQL;
            """)
        db = Database(temp_db_path)
        db.connect()
        with pytest.raises(DatabaseError):
            run_pending_migrations(db, migrations_test_dir)
        cursor = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='test2'")
        assert cursor.fetchone() is None
        cursor = db.execute("SELECT COUNT(*) FROM migrations")
        assert cursor.fetchone()[0] == 1
        db.close()


@pytest.fixture
def _empty_db_path(tmp_path):
    return str(tmp_path / "empty.db")


def test_all_real_migrations_on_empty_db(_empty_db_path):
    """Fresh DB: all numbered migrations apply; second pass is a no-op."""
    real_dir = str(Path(__file__).resolve().parent.parent.parent / "migrations")
    db = Database(_empty_db_path)
    db.connect()
    run_pending_migrations(db, real_dir)
    run_pending_migrations(db, real_dir)
    tables = {
        r[0]
        for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "users" in tables
    assert "projects" in tables
    assert "password_reset_tokens" in tables
    assert "api_keys" in tables
    assert "storage_files" in tables
    cols = {r[1] for r in db.execute("PRAGMA table_info(projects)").fetchall()}
    assert {"owner_id", "status", "slug", "updated_at"}.issubset(cols)
    applied = {
        r[0] for r in db.execute("SELECT id FROM migrations").fetchall()
    }
    assert applied >= {"0001", "0002", "0003", "0004", "0005", "0006", "0007"}
    db.close()


def test_0006_idempotent_when_columns_already_exist(tmp_path):
    """DB already has 0006 columns but migrations table only through 0005."""
    real_dir = str(Path(__file__).resolve().parent.parent.parent / "migrations")
    db_path = str(tmp_path / "prepatched.db")
    db = Database(db_path)
    db.connect()
    from backend.core.migrations import get_migration_files, extract_migration_id, apply_migration
    files = get_migration_files(real_dir)
    for f in files:
        mid = extract_migration_id(f)
        if mid in {"0006", "0007"}:
            continue
        apply_migration(db, f)
    for stmt in (
        "ALTER TABLE projects ADD COLUMN owner_id TEXT",
        "ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
        "ALTER TABLE projects ADD COLUMN slug TEXT",
        "ALTER TABLE projects ADD COLUMN updated_at TIMESTAMP",
    ):
        try:
            db.execute(stmt)
        except Exception:
            pass
    run_pending_migrations(db, real_dir)
    applied = {
        r[0] for r in db.execute("SELECT id FROM migrations").fetchall()
    }
    assert "0006" in applied
    assert "0007" in applied
    db.close()
