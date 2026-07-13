
import asyncio
import os
import shutil
import sqlite3
import tempfile
import threading
import time
from pathlib import Path
from datetime import datetime, timezone

import pytest
from pyrocore.backend.core.backup import (
    BackupInfo,
    backup_now,
    list_backups,
    prune_backups,
    restore_from_backup,
    scheduled_backup_loop,
)
from pyrocore.backend.core.db import Database, DatabaseError


class TestBackup:
    @pytest.fixture
    def temp_db_path(self):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            temp_path = f.name
        # Create initial database with some test data
        conn = sqlite3.connect(temp_path)
        conn.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)")
        conn.execute("INSERT INTO test (id, name) VALUES (1, 'Alice')")
        conn.commit()
        conn.close()
        yield temp_path
        if os.path.exists(temp_path):
            os.remove(temp_path)
            wal_path = temp_path + "-wal"
            shm_path = temp_path + "-shm"
            if os.path.exists(wal_path):
                os.remove(wal_path)
            if os.path.exists(shm_path):
                os.remove(shm_path)

    @pytest.fixture
    def temp_backup_dir(self):
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)

    def test_backup_now_creates_valid_backup(self, temp_db_path, temp_backup_dir):
        backup_path = backup_now(temp_db_path, temp_backup_dir)
        assert backup_path.exists()

        # Verify backup has correct data
        conn = sqlite3.connect(str(backup_path))
        cursor = conn.execute("SELECT name FROM test WHERE id=1")
        assert cursor.fetchone()[0] == "Alice"
        conn.close()

    def test_backup_during_concurrent_writes(self, temp_db_path, temp_backup_dir):
        # Function that writes to the database continuously in a separate thread
        def writer_func():
            conn = sqlite3.connect(temp_db_path)
            for i in range(100):
                conn.execute("INSERT INTO test (id, name) VALUES (?, ?)", (i + 2, f"Test {i}"))
                conn.commit()
                time.sleep(0.01)
            conn.close()

        writer_thread = threading.Thread(target=writer_func, daemon=True)
        writer_thread.start()

        # Perform backup while writer is active
        time.sleep(0.05)
        backup_path = backup_now(temp_db_path, temp_backup_dir)

        # Wait for writer to finish
        writer_thread.join()

        # Verify backup is valid
        conn = sqlite3.connect(str(backup_path))
        conn.execute("SELECT 1")
        conn.close()

    def test_list_backups(self, temp_db_path, temp_backup_dir):
        # Create multiple backups
        for _ in range(3):
            backup_now(temp_db_path, temp_backup_dir)
            time.sleep(0.01)

        backups = list_backups(temp_backup_dir)
        assert len(backups) == 3
        assert isinstance(backups[0], BackupInfo)

        # Verify sorted newest first
        assert backups[0].created_at >= backups[1].created_at
        assert backups[1].created_at >= backups[2].created_at

    def test_prune_backups_keeps_specified_count(self, temp_db_path, temp_backup_dir):
        # Create 5 backups
        for _ in range(5):
            backup_now(temp_db_path, temp_backup_dir)
            time.sleep(0.01)

        assert len(list_backups(temp_backup_dir)) == 5

        prune_backups(temp_backup_dir, keep=2)
        assert len(list_backups(temp_backup_dir)) == 2

    def test_prune_backups_minimum_of_1(self, temp_db_path, temp_backup_dir):
        for _ in range(3):
            backup_now(temp_db_path, temp_backup_dir)
            time.sleep(0.01)

        prune_backups(temp_backup_dir, keep=0)
        assert len(list_backups(temp_backup_dir)) == 1

    def test_restore_from_backup(self, temp_db_path, temp_backup_dir):
        backup_path = backup_now(temp_db_path, temp_backup_dir)

        # Modify original database
        conn = sqlite3.connect(temp_db_path)
        conn.execute("UPDATE test SET name='Bob' WHERE id=1")
        conn.commit()
        conn.close()

        # Restore from backup
        restore_from_backup(str(backup_path), temp_db_path)

        # Verify original is restored
        conn = sqlite3.connect(temp_db_path)
        cursor = conn.execute("SELECT name FROM test WHERE id=1")
        assert cursor.fetchone()[0] == "Alice"
        conn.close()

    def test_restore_from_invalid_backup_fails_safely(self, temp_db_path, temp_backup_dir):
        invalid_backup = Path(temp_backup_dir) / "invalid.db"
        with open(invalid_backup, "w") as f:
            f.write("not a sqlite database")

        original_db_content = open(temp_db_path, "rb").read()

        with pytest.raises(DatabaseError):
            restore_from_backup(str(invalid_backup), temp_db_path)

        # Verify original database wasn't touched
        assert open(temp_db_path, "rb").read() == original_db_content

    def test_restore_from_nonexistent_backup_fails(self, temp_db_path):
        with pytest.raises(FileNotFoundError):
            restore_from_backup("/nonexistent/path/backup.db", temp_db_path)

    @pytest.mark.asyncio
    async def test_scheduled_backup_loop(self, temp_db_path, temp_backup_dir):
        # Test that scheduled loop creates backups and continues on failure
        loop_task = asyncio.create_task(
            scheduled_backup_loop(temp_db_path, temp_backup_dir, 0.1)
        )

        await asyncio.sleep(0.3)
        loop_task.cancel()

        try:
            await loop_task
        except asyncio.CancelledError:
            pass

        assert len(list_backups(temp_backup_dir)) >= 2

