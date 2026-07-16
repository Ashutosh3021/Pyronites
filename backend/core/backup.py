
import asyncio
import logging
import os
import re
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

    source_conn = None
    backup_conn = None
    try:
        # Connect to source database in read-only mode
        source_conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        # Connect to backup database
        backup_conn = sqlite3.connect(str(backup_file))

        # Use SQLite's backup API — atomic, safe during concurrent writes
        with backup_conn:
            source_conn.backup(backup_conn)

    except sqlite3.Error as e:
        raise DatabaseError(f"Backup failed: {e}") from e
    finally:
        # Always close connections regardless of success or failure
        if source_conn is not None:
            try:
                source_conn.close()
            except sqlite3.Error:
                pass
        if backup_conn is not None:
            try:
                backup_conn.close()
            except sqlite3.Error:
                pass
        # Clean up partial backup file on any exception
        # (we re-raise below, so only clean up if we're in an exception path)

    # If we reach here the backup_conn context committed successfully.
    # Verify the backup is a readable SQLite database before declaring success.
    try:
        verify_conn = sqlite3.connect(str(backup_file))
        verify_conn.execute("SELECT 1")
        verify_conn.close()
    except sqlite3.Error as e:
        # Backup written but unreadable — remove it
        try:
            backup_file.unlink()
        except OSError:
            logger.warning("Failed to delete unreadable backup file %s", backup_file)
        raise DatabaseError(f"Backup verification failed: {e}") from e
    except OSError as e:
        try:
            backup_file.unlink()
        except OSError:
            pass
        raise

    logger.info("Successfully created backup at %s", backup_file)
    return backup_file


def list_backups(backup_dir: str) -> List[BackupInfo]:
    """
    List all database backups in a directory, sorted newest first.

    The creation timestamp is parsed from the backup filename
    (format: ``<stem>_<YYYY>-<MM>-<DD>T<HH>-<MM>-<SS>-<f>.db``).
    Falls back to ``st_mtime`` for files that don't match the pattern.

    Args:
        backup_dir: Directory containing backup files

    Returns:
        List of BackupInfo objects, sorted from newest to oldest
    """
    backup_path = Path(backup_dir)
    if not backup_path.exists():
        return []

    # Pattern: anything_YYYY-MM-DDTHH-MM-SS-ffffff.db
    _TS_RE = re.compile(
        r"_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+)\.db$"
    )

    backups = []
    for file in backup_path.iterdir():
        if not (file.is_file() and file.suffix == ".db"):
            continue
        stat = file.stat()
        # Try to parse creation time from the filename timestamp
        match = _TS_RE.search(file.name)
        if match:
            try:
                ts_str = match.group(1)  # e.g. 2025-07-14T10-30-00-123456
                # Convert dashes-in-time to colons so fromisoformat works
                parts = ts_str.split("T")
                time_part = parts[1].replace("-", ":", 2)  # first two only → HH:MM:SS-f
                time_part = time_part.rsplit("-", 1)  # split off microseconds
                iso_str = f"{parts[0]}T{time_part[0]}.{time_part[1]}+00:00"
                created_at = datetime.fromisoformat(iso_str)
            except (ValueError, IndexError):
                created_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        else:
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
            logger.info("Pruned old backup: %s", backup.path)
        except OSError as e:
            logger.error("Failed to delete backup %s: %s", backup.path, e)


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
        try:
            verify_conn.execute("SELECT 1")
        finally:
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
            try:
                with temp_conn:
                    source_conn.backup(temp_conn)
            finally:
                source_conn.close()
                temp_conn.close()

            # Verify temporary file is valid
            verify_temp_conn = sqlite3.connect(str(temp_path))
            try:
                verify_temp_conn.execute("SELECT 1")
            finally:
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
                    # Clean up the old file now that the rename succeeded
                    try:
                        old_file.unlink()
                    except OSError:
                        logger.warning("Failed to remove old DB file after restore: %s", old_file)
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

    Takes an immediate backup on startup, then repeats every ``interval_seconds``.

    Args:
        db_path: Path to the source database file
        backup_dir: Directory where backups will be stored
        interval_seconds: Number of seconds between backups
    """
    logger.info("Starting scheduled backup loop")

    while True:
        try:
            logger.info("Performing scheduled backup")
            backup_now(db_path, backup_dir)
            # Prune old backups after creating a new one
            prune_backups(backup_dir)
        except Exception as e:
            # Catch any exception to ensure the loop keeps running
            logger.error("Scheduled backup failed: %s", e, exc_info=True)

        await asyncio.sleep(interval_seconds)

