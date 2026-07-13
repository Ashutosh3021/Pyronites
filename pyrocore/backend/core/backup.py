
import asyncio
import logging
import os
import sqlite3
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List

# Configure logger
logger = logging.getLogger(__name__)


@dataclass
class BackupInfo:
    """Dataclass representing a database backup."""

    path: Path
    created_at: datetime
    size_bytes: int


def backup_now(db_path: str, backup_dir: str) -> Path:
    """
    Create a backup of the SQLite database using SQLite's native online backup API.

    This is safe to use while the database is actively being written to.

    Args:
        db_path: Path to the source database file
        backup_dir: Directory where backups will be stored

    Returns:
        Path to the created backup file

    Raises:
        DatabaseError: If there's an error during backup
        OSError: If there's a file system error (e.g., disk full, permission denied)
    """
    from .db import DatabaseError

    # Ensure backup directory exists
    backup_path = Path(backup_dir)
    backup_path.mkdir(parents=True, exist_ok=True)

    # Generate backup filename with UTC timestamp (including microseconds to avoid collisions)
    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y-%m-%dT%H-%M-%S-%f")
    db_name = Path(db_path).stem
    backup_filename = f"{db_name}_{timestamp}.db"
    backup_file = backup_path / backup_filename

    try:
        # Connect to source database in read-only mode
        source_conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        # Connect to backup database
        backup_conn = sqlite3.connect(str(backup_file))

        # Use SQLite's backup API
        with backup_conn:
            source_conn.backup(backup_conn)

        # Close connections
        source_conn.close()
        backup_conn.close()

        # Verify that backup file was created and is a valid SQLite database
        verify_conn = sqlite3.connect(str(backup_file))
        verify_conn.execute("SELECT 1")
        verify_conn.close()

        logger.info(f"Successfully created backup at {backup_file}")
        return backup_file

    except sqlite3.Error as e:
        # Clean up partial backup file if it exists
        if backup_file.exists():
            try:
                backup_file.unlink()
            except OSError:
                logger.warning(f"Failed to delete partial backup file {backup_file}")
        raise DatabaseError(f"Backup failed: {e}") from e
    except OSError as e:
        # Clean up partial backup file if it exists
        if backup_file.exists():
            try:
                backup_file.unlink()
            except OSError:
                logger.warning(f"Failed to delete partial backup file {backup_file}")
        raise


def list_backups(backup_dir: str) -> List[BackupInfo]:
    """
    List all database backups in a directory, sorted newest first.

    Args:
        backup_dir: Directory containing backup files

    Returns:
        List of BackupInfo objects, sorted from newest to oldest
    """
    backup_path = Path(backup_dir)
    if not backup_path.exists():
        return []

    backups = []
    for file in backup_path.iterdir():
        if file.is_file() and file.suffix == ".db":
            stat = file.stat()
            created_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
            backups.append(
                BackupInfo(
                    path=file,
                    created_at=created_at,
                    size_bytes=stat.st_size,
                )
            )

    # Sort by created_at descending (newest first)
    backups.sort(key=lambda x: x.created_at, reverse=True)
    return backups


def prune_backups(backup_dir: str, keep: int = 10) -> None:
    """
    Delete old backups beyond the specified retention count.

    Will never delete the most recent backup, even if keep=0 (clamped to 1).

    Args:
        backup_dir: Directory containing backup files
        keep: Number of backups to keep (minimum 1)
    """
    # Clamp keep to minimum of 1 and log warning if needed
    if keep < 1:
        logger.warning(f"Prune backups: keep count {keep} is invalid, clamping to 1")
        keep = 1

    backups = list_backups(backup_dir)
    if len(backups) <= keep:
        return

    # Keep newest 'keep' backups, delete the rest
    to_delete = backups[keep:]
    for backup in to_delete:
        try:
            backup.path.unlink()
            logger.info(f"Pruned old backup: {backup.path}")
        except OSError as e:
            logger.error(f"Failed to delete backup {backup.path}: {e}")


def restore_from_backup(backup_path: str, target_db_path: str) -> None:
    """
    Safely restore a database from a backup.

    Uses a temp file to ensure we don't leave the system in a broken state.

    Args:
        backup_path: Path to the backup file
        target_db_path: Path to the target (live) database file

    Raises:
        DatabaseError: If backup file is invalid or restore fails
        FileNotFoundError: If backup file doesn't exist
        OSError: If there's a file system error
    """
    from .db import DatabaseError

    backup_file = Path(backup_path)
    if not backup_file.exists():
        raise FileNotFoundError(f"Backup file not found: {backup_path}")

    target_file = Path(target_db_path)
    target_dir = target_file.parent

    try:
        # First, verify that the backup is a valid SQLite database
        verify_conn = sqlite3.connect(str(backup_file))
        verify_conn.execute("SELECT 1")
        verify_conn.close()

        # Create a temporary file in the same directory as the target
        temp_file = tempfile.NamedTemporaryFile(
            suffix=".db",
            dir=target_dir,
            delete=False,
        )
        temp_path = Path(temp_file.name)
        temp_file.close()

        try:
            # Copy the backup to the temporary file using SQLite's backup API
            # This ensures we get a valid copy
            source_conn = sqlite3.connect(str(backup_file))
            temp_conn = sqlite3.connect(str(temp_path))
            with temp_conn:
                source_conn.backup(temp_conn)
            source_conn.close()
            temp_conn.close()

            # Verify temporary file is valid
            verify_temp_conn = sqlite3.connect(str(temp_path))
            verify_temp_conn.execute("SELECT 1")
            verify_temp_conn.close()

            # Atomically replace target with temp file
            if target_file.exists():
                # On Windows, we need to rename existing file first
                if os.name == "nt":
                    old_file = target_file.with_suffix(".db.old")
                    if old_file.exists():
                        old_file.unlink()
                    target_file.rename(old_file)
                    temp_path.rename(target_file)
                else:
                    # On Unix-like systems, os.replace is atomic
                    os.replace(temp_path, target_file)
            else:
                temp_path.rename(target_file)

            logger.info(f"Successfully restored database from {backup_path} to {target_db_path}")

        finally:
            # Clean up temp file if it still exists
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass

    except sqlite3.Error as e:
        raise DatabaseError(f"Invalid backup file: {e}") from e


async def scheduled_backup_loop(
    db_path: str,
    backup_dir: str,
    interval_seconds: int,
) -> None:
    """
    Async background loop that creates backups on a schedule.

    Args:
        db_path: Path to the source database file
        backup_dir: Directory where backups will be stored
        interval_seconds: Number of seconds between backups
    """
    logger.info("Starting scheduled backup loop")

    while True:
        try:
            await asyncio.sleep(interval_seconds)
            logger.info("Performing scheduled backup")
            backup_now(db_path, backup_dir)
            # Prune old backups after creating a new one
            prune_backups(backup_dir)

        except Exception as e:
            # Catch any exception to ensure the loop keeps running
            logger.error(f"Scheduled backup failed: {e}", exc_info=True)

