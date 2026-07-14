
import os
import tempfile
import pytest
from backend.core.db import Database, DatabaseIntegrityError


class TestDatabase:
    @pytest.fixture
    def temp_db_path(self):
        """Create a temporary database file and clean it up after test."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            temp_path = f.name
        yield temp_path
        if os.path.exists(temp_path):
            os.remove(temp_path)
            # Clean up WAL files
            wal_path = temp_path + "-wal"
            shm_path = temp_path + "-shm"
            if os.path.exists(wal_path):
                os.remove(wal_path)
            if os.path.exists(shm_path):
                os.remove(shm_path)

    def test_wal_mode_enabled(self, temp_db_path):
        """Test that WAL mode is actually enabled after connecting."""
        db = Database(temp_db_path)
        db.connect()
        assert db.get_journal_mode() == "wal"
        db.close()

    def test_transaction_rollback_on_error(self, temp_db_path):
        """Test that a transaction rolls back correctly when an error occurs."""
        db = Database(temp_db_path)
        db.connect()
        
        # Create a test table
        db.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)")
        
        # Attempt a transaction that should fail
        with pytest.raises(DatabaseIntegrityError):
            with db.transaction() as conn:
                conn.execute("INSERT INTO test (id, name) VALUES (?, ?)", (1, "Alice"))
                # This should violate primary key constraint
                conn.execute("INSERT INTO test (id, name) VALUES (?, ?)", (1, "Bob"))
        
        # Verify nothing was inserted
        cursor = db.execute("SELECT COUNT(*) FROM test")
        count = cursor.fetchone()[0]
        assert count == 0
        
        db.close()

    def test_parameterized_queries(self, temp_db_path):
        """Test that parameterized queries work correctly."""
        db = Database(temp_db_path)
        db.connect()
        
        db.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)")
        db.execute("INSERT INTO test (id, name) VALUES (?, ?)", (1, "Alice"))
        db.execute("INSERT INTO test (id, name) VALUES (?, ?)", (2, "Bob"))
        
        cursor = db.execute("SELECT name FROM test WHERE id = ?", (1,))
        result = cursor.fetchone()
        assert result[0] == "Alice"
        
        db.close()

    def test_execute_many(self, temp_db_path):
        """Test that execute_many works correctly for batch operations."""
        db = Database(temp_db_path)
        db.connect()
        
        db.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)")
        db.execute_many(
            "INSERT INTO test (id, name) VALUES (?, ?)",
            [(1, "Alice"), (2, "Bob"), (3, "Charlie")]
        )
        
        cursor = db.execute("SELECT COUNT(*) FROM test")
        count = cursor.fetchone()[0]
        assert count == 3
        
        db.close()

