"""
Database migration runner.

Design
------
Migrations are plain ``.sql`` files stored in a ``migrations/`` directory.
Each file is named with a zero-padded numeric prefix (e.g. ``0001_init.sql``)
that determines execution order.  Once applied, the migration ID is recorded in
the ``migrations`` table so it is never re-executed.

All SQL in a single migration file is applied atomically: if any statement
fails the transaction rolls back and the migration ID is NOT recorded, leaving
the schema in a consistent pre-migration state.

Thread safety: the caller is responsible for not running two migration passes
concurrently against the same DB.  In practice this only runs once at startup,
so it is not a concern.
"""

import glob
import logging
import os
import re
from typing import List, Set

from .db import Database, DatabaseError

logger = logging.getLogger(__name__)


def get_migration_files(migrations_dir: str) -> List[str]:
    """
    Return all ``.sql`` migration files in ``migrations_dir``, sorted by their
    numeric prefix so they are always applied in the correct order.

    Files without a leading numeric prefix sort to position 0 (before any
    numbered file) and will trigger a ``ValueError`` in
    ``extract_migration_id`` — this is intentional to catch misnamed files
    early rather than silently skipping them.

    Args:
        migrations_dir: Filesystem path to the directory containing ``*.sql`` files.

    Returns:
        Sorted list of absolute file paths; empty list if the directory does
        not exist or contains no ``.sql`` files.
    """
    if not os.path.exists(migrations_dir):
        return []

    pattern = os.path.join(migrations_dir, "*.sql")
    files = glob.glob(pattern)

    def _sort_key(file_path: str) -> int:
        filename = os.path.basename(file_path)
        match = re.match(r"^(\d+)", filename)
        return int(match.group(1)) if match else 0

    return sorted(files, key=_sort_key)


def extract_migration_id(file_path: str) -> str:
    """
    Extract the migration ID from a filename.

    The ID is the leading digit sequence before the first underscore, e.g.
    ``"0001"`` from ``"0001_init.sql"``.  This string is what gets stored in
    the ``migrations`` table and compared during the pending-check.

    Args:
        file_path: Path to the migration file.

    Returns:
        The numeric prefix as a string (preserving leading zeros).

    Raises:
        ValueError: If the filename does not start with one or more digits.
    """
    filename = os.path.basename(file_path)
    match = re.match(r"^(\d+)", filename)
    if match:
        return match.group(1)
    raise ValueError(
        f"Invalid migration filename: {filename!r}. "
        "Expected a leading numeric prefix, e.g. '0001_description.sql'."
    )


def get_applied_migrations(db: Database) -> Set[str]:
    """
    Query the ``migrations`` table for IDs that have already been applied.

    Returns an empty set rather than raising if the ``migrations`` table does
    not yet exist — this is the expected state for a brand-new database before
    the first migration runs.

    Args:
        db: Active database connection.

    Returns:
        Set of applied migration ID strings (e.g. ``{"0001", "0002"}``).
    """
    try:
        cursor = db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
        )
        if not cursor.fetchone():
            return set()
        cursor = db.execute("SELECT id FROM migrations")
        return {row[0] for row in cursor.fetchall()}
    except DatabaseError:
        return set()


def apply_migration(db: Database, file_path: str) -> None:
    """
    Read and apply a single migration file inside an atomic transaction.

    The SQL file is split on semicolons (with comment lines stripped) and
    each statement is executed in order.  If any statement raises, the
    entire transaction is rolled back and the migration ID is NOT recorded,
    so the next startup will retry from scratch.

    Args:
        db: Active database connection.
        file_path: Absolute or relative path to the ``.sql`` file.

    Raises:
        DatabaseError: Wraps any SQL or I/O error, including the original
            exception as ``__cause__`` for full traceability.
    """
    migration_id = extract_migration_id(file_path)
    migration_name = os.path.basename(file_path)
    logger.info("Applying migration %s", migration_name)

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            sql_content = f.read()

        statements = _parse_statements(sql_content)

        with db.transaction() as conn:
            for statement in statements:
                conn.execute(statement)
            conn.execute(
                "INSERT INTO migrations (id, name) VALUES (?, ?)",
                (migration_id, migration_name),
            )

        logger.info("Migration %s applied successfully", migration_name)

    except Exception as e:
        logger.error("Migration %s failed: %s", migration_name, e, exc_info=True)
        raise DatabaseError(
            f"Failed to apply migration {migration_name}: {e}"
        ) from e


def run_pending_migrations(db: Database, migrations_dir: str) -> None:
    """
    Apply every migration in ``migrations_dir`` that has not yet been run.

    Migrations are applied in numeric-prefix order.  Already-applied
    migrations are skipped based on the IDs recorded in the ``migrations``
    table (see ``get_applied_migrations``).

    This function is called once at server startup (see ``backend/app.py``)
    and also via ``pyrocore db push``.  It is idempotent: calling it multiple
    times on an up-to-date database is safe and does nothing.

    Args:
        db: Active database connection.
        migrations_dir: Filesystem path to the directory containing the
            ``.sql`` migration files.
    """
    migration_files = get_migration_files(migrations_dir)
    applied = get_applied_migrations(db)
    pending = [f for f in migration_files if extract_migration_id(f) not in applied]

    if not pending:
        logger.debug("No pending migrations in %s", migrations_dir)
        return

    logger.info(
        "Running %d pending migration(s) from %s", len(pending), migrations_dir
    )
    for file_path in pending:
        apply_migration(db, file_path)

    logger.info("All migrations complete")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_statements(sql_content: str) -> List[str]:
    """
    Split a SQL file into individual executable statements.

    Rules:
    - Lines that are empty or start with ``--`` are skipped.
    - ``/* ... */`` block comments are stripped (single-line only for now).
    - A statement ends when a line ends with ``;``.

    Args:
        sql_content: Raw content of a ``.sql`` file.

    Returns:
        List of non-empty SQL statement strings, each ending with ``;``.
    """
    statements: List[str] = []
    current: List[str] = []
    in_block_comment = False

    for line in sql_content.splitlines():
        line = line.strip()

        if not line:
            continue
        if line.startswith("--"):
            continue
        if "/*" in line:
            in_block_comment = True
        if "*/" in line:
            in_block_comment = False
            line = line.split("*/", 1)[1].strip()
            if not line:
                continue
        if in_block_comment:
            continue

        current.append(line)
        if line.endswith(";"):
            stmt = " ".join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []

    return statements
