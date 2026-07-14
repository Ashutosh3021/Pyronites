
import os
import io
import uuid
import logging
from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, BinaryIO

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
            logger.error(f"Failed to create storage root directory {self.root_dir}", exc_info=True)
            raise
    
    def _validate_filename(self, filename: str) -> None:
        """Validate and sanitize filename, reject path traversal attempts."""
        # Check for path traversal patterns
        if ".." in filename or "/" in filename or "\\" in filename:
            raise InvalidFilenameError(f"Invalid filename: {filename} (contains path traversal characters)")
        
        # Check if it's an absolute path
        if Path(filename).is_absolute():
            raise InvalidFilenameError(f"Invalid filename: {filename} (absolute paths not allowed)")
        
        # Sanitize by taking just the basename (though we already checked for separators)
        # Keep the original name for metadata, but make sure it's safe
        pass
    
    def save(
        self,
        file_bytes_or_stream: bytes | BinaryIO,
        filename: str,
        content_type: str = "application/octet-stream",
    ) -> FileRecord:
        """Save a file to storage, tracking metadata in the database."""
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
            logger.error(f"Failed to write file to disk: {file_path}", exc_info=True)
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
            logger.error(f"Failed to write file metadata to database", exc_info=True)
            # Clean up the file we just wrote
            try:
                file_path.unlink(missing_ok=True)
            except OSError:
                logger.warning(f"Failed to clean up file after database error: {file_path}")
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
        """Retrieve file bytes by ID."""
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
            logger.error(f"Failed to read file from disk: {file_path}", exc_info=True)
            raise
    
    def get_record(self, file_id: str) -> FileRecord:
        """Retrieve file metadata record by ID."""
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
        """Delete a file from storage and remove metadata."""
        # First check if the file exists
        record = self.get_record(file_id)
        
        # Delete from disk
        file_path = self.root_dir / file_id
        try:
            file_path.unlink(missing_ok=True)
        except OSError as e:
            logger.error(f"Failed to delete file from disk: {file_path}", exc_info=True)
            raise
        
        # Delete from database
        try:
            self.db.execute(
                "DELETE FROM storage_files WHERE id = ? AND project_id = ?",
                (file_id, self.project_id),
            )
        except Exception as e:
            logger.error(f"Failed to delete file metadata from database", exc_info=True)
            raise
    
    def list(self, prefix: Optional[str] = None) -> List[FileRecord]:
        """List all files, optionally filtered by filename prefix."""
        query = """
            SELECT id, original_filename, content_type, size_bytes, uploaded_at, project_id
            FROM storage_files
            WHERE project_id = ?
        """
        params = [self.project_id]
        
        if prefix:
            query += " AND original_filename LIKE ?"
            params.append(f"{prefix}%")
        
        query += " ORDER BY uploaded_at DESC"
        
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
