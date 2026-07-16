
"""
Local filesystem file storage backed by a SQLite metadata table.

Design
------
Files are stored on disk using their UUID as the filename, completely
decoupled from the original upload name.  The ``storage_files`` table tracks
the mapping from UUID → (original_filename, content_type, size, timestamps).

This means:
- Two uploads of a file with the same name never collide on disk.
- Renaming a file only requires a DB update, not a filesystem move.
- The on-disk layout reveals nothing about the content being stored.

The ``project_id`` column isolates files between projects sharing the same
storage root, so a key from project A cannot be used to read files from B.

Timestamp format
----------------
All ``uploaded_at`` values are stored in SQLite as ISO 8601 strings with an
explicit UTC offset (``+00:00``).  They are always read back via
``datetime.fromisoformat`` and serialised for the API via ``to_utc_iso`` from
``backend.api.schemas``.
"""

import io
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, List, Optional

from backend.core.db import Database

logger = logging.getLogger(__name__)


@dataclass
class FileRecord:
    id: str
    original_filename: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime
    project_id: str


class InvalidFilenameError(ValueError):
    pass


class FileTooLargeError(ValueError):
    pass


class LocalFileStorage:
    """
    File storage backed by the local filesystem and a SQLite metadata table.

    Each instance is scoped to a single ``project_id`` so that operations
    on one project cannot touch files belonging to another, even if they share
    the same ``root_dir``.

    Args:
        db: Active ``Database`` connection — the same one used by the caller's
            route, so no second connection is opened.
        root_dir: Filesystem path under which files are stored.  Created
            automatically on first use if it does not exist.
        max_file_size: Maximum accepted upload size in bytes (default 10 MiB).
            Streams are checked incrementally so memory usage is bounded
            regardless of upload size.
        project_id: Scopes all DB queries and disk lookups to this project.
            Defaults to ``"default"`` for single-project deployments.
    """

    def __init__(
        self,
        db: Database,
        root_dir: str,
        max_file_size: int = 10 * 1024 * 1024,  # 10 MB default
        project_id: str = "default",
    ):
        self.db = db
        self.root_dir = Path(root_dir)
        self.max_file_size = max_file_size
        self.project_id = project_id
        
        # Ensure root directory exists
        try:
            self.root_dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            logger.error("Failed to create storage root directory %s", self.root_dir, exc_info=True)
            raise
    
    def _validate_filename(self, filename: str) -> None:
        """Validate filename — reject empty strings and path traversal attempts."""
        if not filename or not filename.strip():
            raise InvalidFilenameError("Filename must not be empty")

        # Check for path traversal patterns
        if ".." in filename or "/" in filename or "\\" in filename:
            raise InvalidFilenameError(
                f"Invalid filename: {filename!r} (contains path traversal characters)"
            )

        # Check if it's an absolute path
        if Path(filename).is_absolute():
            raise InvalidFilenameError(
                f"Invalid filename: {filename!r} (absolute paths not allowed)"
            )
    
    def save(
        self,
        file_bytes_or_stream: bytes | BinaryIO,
        filename: str,
        content_type: str = "application/octet-stream",
    ) -> FileRecord:
        """
        Persist a file to disk and record its metadata in the database.

        The file is stored under a freshly generated UUID filename (not the
        original name) so two uploads with the same name never collide.  The
        original name is preserved in the ``storage_files`` table and returned
        in every metadata response.

        If writing to disk succeeds but the DB INSERT fails, the disk file is
        cleaned up before re-raising so there are no orphaned files.

        Args:
            file_bytes_or_stream: Either raw ``bytes`` or any file-like object
                with a ``read(n)`` method (e.g. ``UploadFile.file``).  Streams
                are read in 8 KB chunks so large uploads never load fully into
                memory before the size limit is checked.
            filename: Original upload filename used for the metadata record and
                ``Content-Disposition`` headers on download.  Must not be empty
                or contain path-traversal sequences (``..``, ``/``, ``\\``).
            content_type: MIME type of the file.

        Returns:
            ``FileRecord`` with the assigned ``id``, original filename, size,
            and UTC upload timestamp.

        Raises:
            InvalidFilenameError: If ``filename`` is empty or contains path
                traversal characters.
            FileTooLargeError: If the content exceeds ``max_file_size``.
            OSError: If the disk write fails (permissions, disk full, etc.).
            DatabaseError: If the metadata INSERT fails.
        """
        self._validate_filename(filename)
        
        file_id = str(uuid.uuid4())
        uploaded_at = datetime.now(timezone.utc)
        
        # Determine if we have bytes or a stream
        if isinstance(file_bytes_or_stream, bytes):
            file_bytes = file_bytes_or_stream
            size_bytes = len(file_bytes)
        else:
            # Stream handling - read incrementally to check size
            buffer = io.BytesIO()
            size_bytes = 0
            chunk_size = 8192  # 8 KB chunks
            
            while True:
                chunk = file_bytes_or_stream.read(chunk_size)
                if not chunk:
                    break
                size_bytes += len(chunk)
                
                if size_bytes > self.max_file_size:
                    raise FileTooLargeError(f"File too large: max size is {self.max_file_size} bytes")
                
                buffer.write(chunk)
            
            file_bytes = buffer.getvalue()
        
        # Final size check in case we got bytes directly
        if size_bytes > self.max_file_size:
            raise FileTooLargeError(f"File too large: max size is {self.max_file_size} bytes")
        
        # Save to disk using file_id as the on-disk name to avoid conflicts
        file_path = self.root_dir / file_id
        
        try:
            file_path.write_bytes(file_bytes)
        except OSError as e:
            logger.error("Failed to write file to disk: %s", file_path, exc_info=True)
            raise
        
        # Save metadata to database
        try:
            self.db.execute(
                """
                INSERT INTO storage_files (id, original_filename, content_type, size_bytes, uploaded_at, project_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    file_id,
                    filename,
                    content_type,
                    size_bytes,
                    uploaded_at.isoformat(),
                    self.project_id,
                ),
            )
        except Exception as e:
            logger.error("Failed to write file metadata to database", exc_info=True)
            # Clean up the file we just wrote
            try:
                file_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Failed to clean up file after database error: %s", file_path)
            raise
        
        return FileRecord(
            id=file_id,
            original_filename=filename,
            content_type=content_type,
            size_bytes=size_bytes,
            uploaded_at=uploaded_at,
            project_id=self.project_id,
        )
    
    def get(self, file_id: str) -> bytes:
        """
        Read the raw bytes of a stored file.

        Verifies that ``file_id`` exists in the metadata table (and belongs to
        this project) before touching the filesystem, so an attacker cannot
        read arbitrary files by guessing UUIDs from other projects.

        Args:
            file_id: UUID assigned at upload time.

        Returns:
            Raw file bytes.

        Raises:
            FileNotFoundError: If no record exists for ``file_id`` in this
                project, or if the on-disk file is missing (orphaned metadata).
            OSError: If the read fails for any other reason.
        """
        # First get metadata to ensure it exists and belongs to our project
        cursor = self.db.execute(
            """
            SELECT id, original_filename, content_type, size_bytes, uploaded_at, project_id
            FROM storage_files
            WHERE id = ? AND project_id = ?
            """,
            (file_id, self.project_id),
        )
        row = cursor.fetchone()
        if not row:
            raise FileNotFoundError(f"File not found: {file_id}")
        
        file_path = self.root_dir / file_id
        try:
            return file_path.read_bytes()
        except OSError as e:
            logger.error("Failed to read file from disk: %s", file_path, exc_info=True)
            raise
    
    def get_record(self, file_id: str) -> FileRecord:
        """
        Fetch the metadata record for a file without reading its bytes.

        Used by the metadata endpoint and the download endpoint (to get the
        ``Content-Type`` and ``Content-Disposition`` values before streaming).

        Args:
            file_id: UUID assigned at upload time.

        Returns:
            ``FileRecord`` with original filename, content type, size, and
            UTC upload timestamp.

        Raises:
            FileNotFoundError: If no record exists for ``file_id`` in this project.
        """
        cursor = self.db.execute(
            """
            SELECT id, original_filename, content_type, size_bytes, uploaded_at, project_id
            FROM storage_files
            WHERE id = ? AND project_id = ?
            """,
            (file_id, self.project_id),
        )
        row = cursor.fetchone()
        if not row:
            raise FileNotFoundError(f"File not found: {file_id}")
        
        (
            id_,
            original_filename,
            content_type,
            size_bytes,
            uploaded_at_str,
            project_id,
        ) = row
        
        return FileRecord(
            id=id_,
            original_filename=original_filename,
            content_type=content_type,
            size_bytes=size_bytes,
            uploaded_at=datetime.fromisoformat(uploaded_at_str),
            project_id=project_id,
        )
    
    def delete(self, file_id: str) -> None:
        """
        Delete a file from disk and remove its metadata record.

        The disk file is removed first.  If the subsequent DB DELETE fails the
        file is already gone from disk — the caller gets an exception and the
        metadata row becomes an orphan.  This is a deliberate trade-off: leaking
        a dead metadata row is recoverable; leaking an unreferenced disk file
        full of user data is not.

        Args:
            file_id: UUID assigned at upload time.

        Raises:
            FileNotFoundError: If no record exists for ``file_id`` in this project.
            OSError: If the disk deletion fails.
            DatabaseError: If the DB DELETE fails.
        """
        # First check if the file exists
        record = self.get_record(file_id)
        
        # Delete from disk
        file_path = self.root_dir / file_id
        try:
            file_path.unlink(missing_ok=True)
        except OSError as e:
            logger.error("Failed to delete file from disk: %s", file_path, exc_info=True)
            raise
        
        # Delete from database
        try:
            self.db.execute(
                "DELETE FROM storage_files WHERE id = ? AND project_id = ?",
                (file_id, self.project_id),
            )
        except Exception as e:
            logger.error("Failed to delete file metadata from database", exc_info=True)
            raise
    
    def list(
        self,
        prefix: Optional[str] = None,
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[FileRecord]:
        """
        Return metadata records for this project, newest-first.

        Args:
            prefix: Optional filename prefix filter.  When provided, only files
                whose ``original_filename`` starts with this string are returned.
                The filter is applied with a SQL ``LIKE`` clause; special SQL
                wildcard characters in ``prefix`` are not escaped, so callers
                should avoid user-supplied values containing ``%`` or ``_``.
            limit: Optional maximum number of records to return.  When ``None``
                (the default for non-API callers) all matches are returned.
            offset: Number of records to skip; only applied when ``limit`` is set.

        Returns:
            List of ``FileRecord`` objects; empty list when no files match.
        """
        query = """
            SELECT id, original_filename, content_type, size_bytes, uploaded_at, project_id
            FROM storage_files
            WHERE project_id = ?
        """
        params: List[Any] = [self.project_id]

        if prefix:
            query += " AND original_filename LIKE ?"
            params.append(f"{prefix}%")

        query += " ORDER BY uploaded_at DESC"

        if limit is not None:
            query += " LIMIT ? OFFSET ?"
            params.extend([limit, offset])

        cursor = self.db.execute(query, tuple(params))
        rows = cursor.fetchall()
        
        records = []
        for row in rows:
            (
                id_,
                original_filename,
                content_type,
                size_bytes,
                uploaded_at_str,
                project_id,
            ) = row
            records.append(
                FileRecord(
                    id=id_,
                    original_filename=original_filename,
                    content_type=content_type,
                    size_bytes=size_bytes,
                    uploaded_at=datetime.fromisoformat(uploaded_at_str),
                    project_id=project_id,
                )
            )
        
        return records
