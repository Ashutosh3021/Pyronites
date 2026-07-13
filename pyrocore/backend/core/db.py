
import sqlite3
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
    Provides safe query execution, transactions, and proper configuration.
    """

    def __init__(self, db_path: str):
        """
        Initialize the Database wrapper with a path to the SQLite file.
        
        Args:
            db_path: Path to the SQLite database file (will be created if it doesn't exist)
        """
        self.db_path = db_path
        self._connection: sqlite3.Connection | None = None

    def connect(self) -> None:
        """
        Connect to the SQLite database and configure essential pragmas.
        
        Raises:
            DatabaseOperationalError: If connection fails (disk full, permission denied, etc.)
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
        Close the database connection safely.
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
        try:
            cursor = self._connection.cursor()
            cursor.execute(sql, params)
            self._connection.commit()
            return cursor
        except sqlite3.OperationalError as e:
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
        Execute a SQL query multiple times with different parameters (batch operation).
        
        Args:
            sql: SQL query string (use ? for placeholders)
            params_list: List of parameter tuples, one for each execution
            
        Raises:
            DatabaseOperationalError: For operational issues (locked, disk full)
            DatabaseIntegrityError: For constraint violations
            DatabaseError: For other database issues
        """
        self._ensure_connected()
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
        
        Yields:
            SQLite connection for use in the transaction
            
        Raises:
            DatabaseOperationalError: For operational issues
            DatabaseIntegrityError: For constraint violations
            DatabaseError: For other database issues
        """
        self._ensure_connected()
        try:
            # Begin explicit transaction
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
        Get the current journal mode of the database.
        
        Returns:
            Current journal mode string (should be 'wal')
        """
        self._ensure_connected()
        cursor = self._connection.execute("PRAGMA journal_mode")
        return cursor.fetchone()[0]

