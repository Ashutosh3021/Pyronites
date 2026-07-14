
import os
import tempfile
import shutil
from pathlib import Path
from io import BytesIO

import pytest

from backend.core.db import Database
from backend.core.storage import (
    LocalFileStorage,
    FileRecord,
    InvalidFilenameError,
    FileTooLargeError,
)
from backend.core.migrations import run_pending_migrations


@pytest.fixture
def temp_dir():
    """Fixture for a temporary directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def temp_db(temp_dir):
    """Fixture for a temporary database."""
    db_path = temp_dir / "test.db"
    db = Database(str(db_path))
    db.connect()
    
    # Copy migrations to temp dir and run them
    migrations_dir = temp_dir / "migrations"
    migrations_dir.mkdir()
    
    real_migrations = Path(__file__).parent.parent.parent / "migrations"
    for f in real_migrations.glob("*.sql"):
        shutil.copy(f, migrations_dir / f.name)
    
    run_pending_migrations(db, str(migrations_dir))
    
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def storage(temp_dir, temp_db):
    """Fixture for LocalFileStorage instance."""
    storage_root = temp_dir / "storage"
    return LocalFileStorage(temp_db, str(storage_root), max_file_size=1024)  # 1 KB max for tests


def test_save_and_get_file(storage):
    """Test saving and retrieving a file works correctly."""
    file_content = b"Hello, World!"
    record = storage.save(file_content, "test.txt", "text/plain")
    
    # Check record
    assert isinstance(record, FileRecord)
    assert record.original_filename == "test.txt"
    assert record.size_bytes == len(file_content)
    
    # Get the file back
    retrieved = storage.get(record.id)
    assert retrieved == file_content


def test_reject_path_traversal_filename(storage):
    """Test that filenames with path traversal are rejected."""
    with pytest.raises(InvalidFilenameError):
        storage.save(b"test", "../test.txt")
    
    with pytest.raises(InvalidFilenameError):
        storage.save(b"test", "/etc/passwd")


def test_reject_oversized_file(storage):
    """Test oversized files are rejected before loading into memory."""
    # Try with BytesIO that would exceed max size (1024 bytes)
    large_content = BytesIO(b"x" * 2048)
    with pytest.raises(FileTooLargeError):
        storage.save(large_content, "large.txt")


def test_delete_file_removes_from_disk(storage, temp_dir):
    """Test deleting a file removes it from both disk and metadata."""
    file_content = b"test data"
    record = storage.save(file_content, "test.txt")
    
    # Check file exists on disk
    file_path = temp_dir / "storage" / record.id
    assert file_path.exists()
    
    # Delete it
    storage.delete(record.id)
    
    # Check file should no longer exist
    assert not file_path.exists()
    
    # metadata should be gone
    with pytest.raises(FileNotFoundError):
        storage.get(record.id)


def test_list_files(storage):
    """Test listing files works correctly."""
    # Save two files
    storage.save(b"file1", "file1.txt")
    storage.save(b"file2", "file2.txt")
    
    # List them
    records = storage.list()
    assert len(records) == 2
    
    # List with prefix
    records = storage.list(prefix="file1")
    assert len(records) == 1
    assert records[0].original_filename == "file1.txt"
