
import os
import shutil
import tempfile
import pytest
from pyrocore.backend.core.db import Database, DatabaseError
from pyrocore.backend.core.migrations import run_pending_migrations


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
        # Cleanup will happen when temp_dir is removed

    @pytest.fixture
    def migrations_test_dir(self, temp_dir):
        """Create a temporary migrations directory with test migrations."""
        migrations_dir = os.path.join(temp_dir, "migrations")
        os.makedirs(migrations_dir)
        return migrations_dir

    def test_migrations_do_not_rerun_once_applied(self, temp_db_path, migrations_test_dir):
        """Test that migrations don't re-run once they've been applied."""
        # Copy the real 0001_init.sql to the test migrations dir
        real_migrations_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "migrations"
        )
        shutil.copy(
            os.path.join(real_migrations_dir, "0001_init.sql"),
            os.path.join(migrations_test_dir, "0001_init.sql")
        )
        
        # First run
        db = Database(temp_db_path)
        db.connect()
        run_pending_migrations(db, migrations_test_dir)
        
        # Verify tables exist
        cursor = db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cursor.fetchall()}
        assert "migrations" in tables
        assert "users" in tables
        assert "sessions" in tables
        
        # Verify migration is recorded
        cursor = db.execute("SELECT id FROM migrations WHERE id = ?", ("0001",))
        assert cursor.fetchone() is not None
        
        # Second run should not do anything (and shouldn't fail)
        run_pending_migrations(db, migrations_test_dir)
        
        # Still only one migration applied
        cursor = db.execute("SELECT COUNT(*) FROM migrations")
        count = cursor.fetchone()[0]
        assert count == 1
        
        db.close()

    def test_migration_failure_rolls_back(self, temp_db_path, migrations_test_dir):
        """Test that a migration failure leaves the schema clean (partial changes rolled back)."""
        # First run with only 0001_good.sql
        with open(os.path.join(migrations_test_dir, "0001_good.sql"), "w") as f:
            f.write("""
CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, name TEXT, applied_at TIMESTAMP);
CREATE TABLE test1 (id INTEGER PRIMARY KEY);
            """)
        
        db = Database(temp_db_path)
        db.connect()
        run_pending_migrations(db, migrations_test_dir)
        
        # Verify test1 exists and 0001 is applied
        cursor = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='test1'")
        assert cursor.fetchone() is not None
        
        cursor = db.execute("SELECT id FROM migrations")
        assert len(cursor.fetchall()) == 1
        
        db.close()
        
        # Now add 0002_bad.sql and try to run
        with open(os.path.join(migrations_test_dir, "0002_bad.sql"), "w") as f:
            f.write("""
CREATE TABLE test2 (id INTEGER PRIMARY KEY);
-- This invalid SQL will cause the migration to fail
THIS IS INVALID SQL;
            """)
        
        db = Database(temp_db_path)
        db.connect()
        with pytest.raises(DatabaseError):
            run_pending_migrations(db, migrations_test_dir)
        
        # Verify test2 does NOT exist (migration rolled back)
        cursor = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='test2'")
        assert cursor.fetchone() is None
        
        # Still only 0001 applied
        cursor = db.execute("SELECT COUNT(*) FROM migrations")
        count = cursor.fetchone()[0]
        assert count == 1
        
        db.close()

