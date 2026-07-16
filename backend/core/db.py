
import sqlite3
import threading
from contextlib import contextmanager
from typing import Any, Iterator, List, Tuple
import os


class DatabaseError(Exception):
    """Base exception for database operations"""
    pass


class DatabaseOperationalError(DatabaseError):
    """Exception for SQLite operational errors (disk full, locked file, etc.)"""
    pass


class DatabaseIntegrityError(DatabaseError):
    """Exception for SQLite integrity errors (constraint violations, etc.)"""
    pass


class Database:
    """
    Wrapper around a single SQLite database connection.

    Thread safety
    -------------
    A single ``Database`` instance may be shared across threads (e.g. the
    FastAPI request handler thread and the backup-loop asyncio task).
    ``check_same_thread=False`` disables SQLite's own thread check, but that
    only removes the *assertion* — it doesn't make the underlying connection
    safe.  We protect every public operation with ``self._lock`` so only one
    caller executes SQL at a time.  The lock is re-entrant so that the
    ``transaction()`` context manager can safely call helper methods internally
    without deadlocking.
    """

    def __init__(self, db_path: str):
        """
        Initialize the Database wrapper with a path to the SQLite file.

        Args:
            db_path: Path to the SQLite database file (will be created if it doesn't exist)
        """
        self.db_path = db_path
        self._connection: sqlite3.Connection | None = None
        # RLock (re-entrant) lets the same thread acquire the lock multiple times,
        # which is necessary when transaction() calls execute() internally.
        self._lock = threading.RLock()

    def connect(self) -> None:
        """
        Open the SQLite connection and configure pragmas required for safe operation.

        Pragmas applied
        ---------------
        - ``journal_mode=WAL`` — Write-Ahead Logging lets readers run
          concurrently with a single writer, which is critical for FastAPI
          where many async tasks share one connection.
        - ``synchronous=NORMAL`` — flushes WAL to disk before committing but
          does not wait for the WAL file header; a good balance of durability
          vs. throughput for a single-machine deployment.
        - ``foreign_keys=ON`` — enforces referential integrity on every write.
          SQLite disables this by default and the setting is per-connection, so
          it must be re-applied each time we connect.

        Creates the parent directory of ``db_path`` if it does not exist.

        Raises:
            DatabaseOperationalError: If the connection cannot be opened (wrong
                path permissions, disk full, path is a directory, etc.) or if
                any PRAGMA fails.
        """
        try:
            # Create directory if it doesn't exist
            db_dir = os.path.dirname(self.db_path)
            if db_dir and not os.path.exists(db_dir):
                os.makedirs(db_dir, exist_ok=True)

            self._connection = sqlite3.connect(
                self.db_path,
                check_same_thread=False,  # We'll manage thread safety carefully
                timeout=30.0  # Wait 30 seconds before giving up on a locked database
            )
            
            # Enable Write-Ahead Logging for better concurrency
            # WAL allows multiple readers to access the database while a write is in progress
            self._connection.execute("PRAGMA journal_mode=WAL")
            
            # Set synchronous mode to NORMAL for a good balance of safety and performance
            # NORMAL mode ensures WAL file content is synced to disk before committing
            self._connection.execute("PRAGMA synchronous=NORMAL")
            
            # Enable foreign key constraints for referential integrity
            self._connection.execute("PRAGMA foreign_keys=ON")
            
        except sqlite3.OperationalError as e:
            raise DatabaseOperationalError(
                f"Failed to connect to database at {self.db_path}: {e}"
            ) from e
        except OSError as e:
            raise DatabaseOperationalError(
                f"Failed to create directory for database: {e}"
            ) from e

    def close(self) -> None:
        """
        Close the database connection, suppressing any SQLite errors on close.

        Safe to call multiple times — a second call on an already-closed
        connection is a no-op.  After this returns, ``self._connection`` is
        ``None`` and any further ``execute`` call will raise ``DatabaseError``.
        """
        if self._connection is not None:
            try:
                self._connection.close()
            except sqlite3.Error:
                pass
            self._connection = None

    def _ensure_connected(self) -> None:
        """
        Internal method to ensure we have an active connection.
        """
        if self._connection is None:
            raise DatabaseError("Database not connected. Call connect() first.")

    def execute(self, sql: str, params: Tuple[Any, ...] = ()) -> sqlite3.Cursor:
        """
        Execute a single SQL query with parameterized inputs.

        NOTE: This method auto-commits.  For multi-statement atomicity use the
        transaction() context manager instead.

        Args:
            sql: SQL query string (use ? for placeholders)
            params: Tuple of parameters to substitute into placeholders

        Returns:
            SQLite cursor with query results

        Raises:
            DatabaseOperationalError: For operational issues (locked, disk full)
            DatabaseIntegrityError: For constraint violations
            DatabaseError: For other database issues
        """
        self._ensure_connected()
        with self._lock:
            try:
                cursor = self._connection.cursor()
                cursor.execute(sql, params)
                self._connection.commit()
                return cursor
            except sqlite3.OperationalError as e:
                # Include SQL in the message to aid debugging, but NOT params (may contain secrets)
                raise DatabaseOperationalError(
                    f"Operational error executing SQL: {e}\nSQL: {sql}"
                ) from e
            except sqlite3.IntegrityError as e:
                raise DatabaseIntegrityError(
                    f"Integrity error executing SQL: {e}\nSQL: {sql}"
                ) from e
            except sqlite3.Error as e:
                raise DatabaseError(
                    f"Database error executing SQL: {e}\nSQL: {sql}"
                ) from e

    def execute_many(self, sql: str, params_list: List[Tuple[Any, ...]]) -> None:
        """
        Execute the same SQL statement for every row in ``params_list`` in one
        batch operation, then auto-commit.

        Prefer this over calling ``execute`` in a loop — ``executemany`` is
        substantially faster for bulk inserts or updates because SQLite only
        parses and plans the statement once.

        Args:
            sql: Parameterised SQL string (use ``?`` placeholders).
            params_list: One tuple per row; each tuple must have the same
                arity as the number of ``?`` placeholders in ``sql``.

        Raises:
            DatabaseOperationalError: Disk full, locked file, etc.
            DatabaseIntegrityError: Constraint violation on any row.
            DatabaseError: Any other SQLite error.
        """
        self._ensure_connected()
        with self._lock:
            try:
                cursor = self._connection.cursor()
                cursor.executemany(sql, params_list)
                self._connection.commit()
            except sqlite3.OperationalError as e:
                raise DatabaseOperationalError(
                    f"Operational error in execute_many: {e}\nSQL: {sql}"
                ) from e
            except sqlite3.IntegrityError as e:
                raise DatabaseIntegrityError(
                    f"Integrity error in execute_many: {e}\nSQL: {sql}"
                ) from e
            except sqlite3.Error as e:
                raise DatabaseError(
                    f"Database error in execute_many: {e}\nSQL: {sql}"
                ) from e

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """
        Context manager for atomic transactions.

        The lock is held for the entire duration of the transaction so no
        other caller can interleave statements between BEGIN and COMMIT/ROLLBACK.
        
        Yields:
            SQLite connection for use in the transaction
            
        Raises:
            DatabaseOperationalError: For operational issues
            DatabaseIntegrityError: For constraint violations
            DatabaseError: For other database issues
        """
        self._ensure_connected()
        with self._lock:
            try:
                self._connection.execute("BEGIN TRANSACTION")
                yield self._connection
                self._connection.commit()
            except sqlite3.OperationalError as e:
                self._connection.rollback()
                raise DatabaseOperationalError(
                    f"Operational error in transaction: {e}"
                ) from e
            except sqlite3.IntegrityError as e:
                self._connection.rollback()
                raise DatabaseIntegrityError(
                    f"Integrity error in transaction: {e}"
                ) from e
            except sqlite3.Error as e:
                self._connection.rollback()
                raise DatabaseError(
                    f"Database error in transaction: {e}"
                ) from e
            except Exception:
                self._connection.rollback()
                raise

    def get_journal_mode(self) -> str:
        """
        Query the current WAL/journal mode directly from SQLite.

        Useful in tests to confirm that ``connect()`` actually enabled WAL.
        In production code, prefer trusting the ``connect()`` call rather than
        probing this after every operation.

        Returns:
            Lowercase journal mode string, e.g. ``"wal"``, ``"delete"``.
        """
        self._ensure_connected()
        with self._lock:
            cursor = self._connection.execute("PRAGMA journal_mode")
            return cursor.fetchone()[0]

