
import os
import logging
from pathlib import Path
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, Header
from fastapi.responses import StreamingResponse

from backend.core.db import Database
from backend.core.storage import (
    LocalFileStorage,
    FileRecord,
    InvalidFilenameError,
    FileTooLargeError,
)
from backend.auth.api_keys import validate_api_key
from backend.auth.sessions import validate_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/storage", tags=["storage"])

DB_PATH = os.environ.get("DATABASE_PATH", "pyrocore.db")
STORAGE_ROOT = os.environ.get("STORAGE_ROOT", "storage_files")


def get_db() -> Database:
    """Dependency to get a database connection."""
    db = Database(DB_PATH)
    db.connect()
    try:
        yield db
    finally:
        db.close()


def get_auth_info(
    request: Request,
    db: Database = Depends(get_db),
) -> Optional[Dict[str, Any]]:
    """Dependency to get authentication info from either API key or session."""
    # Check for API key in Authorization header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        api_key_str = auth_header.split(" ", 1)[1]
        api_key = validate_api_key(db, api_key_str)
        if api_key:
            return {"type": "api_key", "scopes": set(api_key.scopes)}
    
    # Check for session cookie
    session_token = request.cookies.get("session_token")
    if session_token:
        user = validate_session(db, session_token)
        if user:
            return {"type": "session", "scopes": {"read", "write", "admin"}}
    
    return None


def require_auth(required_scopes: set):
    """Dependency factory to require authentication and specific scopes."""
    def dependency(
        auth_info: Optional[Dict[str, Any]] = Depends(get_auth_info),
    ) -> Dict[str, Any]:
        if not auth_info:
            raise HTTPException(
                status_code=401,
                detail={
                    "code": "unauthorized",
                    "message": "Missing or invalid authentication",
                },
            )
        
        if not required_scopes.issubset(auth_info["scopes"]):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "forbidden",
                    "message": "Insufficient permissions",
                },
            )
        
        return auth_info
    return dependency


def get_storage(db: Database = Depends(get_db)) -> LocalFileStorage:
    """Dependency to get a LocalFileStorage instance."""
    return LocalFileStorage(db, root_dir=STORAGE_ROOT)


def file_record_to_dict(record: FileRecord) -> Dict[str, Any]:
    """Convert a FileRecord to a dictionary for API response."""
    return {
        "id": record.id,
        "original_filename": record.original_filename,
        "content_type": record.content_type,
        "size_bytes": record.size_bytes,
        "uploaded_at": record.uploaded_at.isoformat(),
        "project_id": record.project_id,
    }


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    db: Database = Depends(get_db),
    storage: LocalFileStorage = Depends(get_storage),
    auth: Dict[str, Any] = Depends(require_auth({"write"})),
):
    """Upload a file to storage."""
    try:
        # Get filename and content type from upload
        filename = file.filename or "unknown"
        content_type = file.content_type or "application/octet-stream"
        
        # Upload the file - use file.file which is a file-like object
        record = storage.save(file.file, filename, content_type)
        
        return file_record_to_dict(record)
    except InvalidFilenameError as e:
        raise HTTPException(status_code=400, detail={"code": "invalid_filename", "message": str(e)})
    except FileTooLargeError as e:
        raise HTTPException(status_code=413, detail={"code": "file_too_large", "message": str(e)})
    except Exception as e:
        logger.error(f"Failed to upload file: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"code": "internal_error", "message": "Failed to upload file"},
        )


@router.get("/{file_id}")
async def get_file_metadata(
    file_id: str,
    db: Database = Depends(get_db),
    storage: LocalFileStorage = Depends(get_storage),
    auth: Dict[str, Any] = Depends(require_auth({"read"})),
):
    """Get metadata for a file."""
    try:
        record = storage.get_record(file_id)
        return file_record_to_dict(record)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "File not found"},
        )
    except Exception as e:
        logger.error(f"Failed to get file metadata: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"code": "internal_error", "message": "Failed to get file metadata"},
        )


@router.get("/{file_id}/download")
async def download_file(
    file_id: str,
    db: Database = Depends(get_db),
    storage: LocalFileStorage = Depends(get_storage),
    auth: Dict[str, Any] = Depends(require_auth({"read"})),
):
    """Download a file."""
    try:
        record = storage.get_record(file_id)
        file_bytes = storage.get(file_id)
        
        # Stream the file back
        return StreamingResponse(
            iter([file_bytes]),
            media_type=record.content_type,
            headers={
                "Content-Disposition": f"attachment; filename={record.original_filename}",
            },
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "File not found"},
        )
    except Exception as e:
        logger.error(f"Failed to download file: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"code": "internal_error", "message": "Failed to download file"},
        )


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    db: Database = Depends(get_db),
    storage: LocalFileStorage = Depends(get_storage),
    auth: Dict[str, Any] = Depends(require_auth({"write"})),
):
    """Delete a file from storage."""
    try:
        storage.delete(file_id)
        return {"message": "File deleted successfully"}
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "File not found"},
        )
    except Exception as e:
        logger.error(f"Failed to delete file: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"code": "internal_error", "message": "Failed to delete file"},
        )


@router.get("")
async def list_files(
    prefix: Optional[str] = None,
    db: Database = Depends(get_db),
    storage: LocalFileStorage = Depends(get_storage),
    auth: Dict[str, Any] = Depends(require_auth({"read"})),
):
    """List all files, optionally filtered by filename prefix."""
    try:
        records = storage.list(prefix)
        return [file_record_to_dict(record) for record in records]
    except Exception as e:
        logger.error(f"Failed to list files: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"code": "internal_error", "message": "Failed to list files"},
        )
