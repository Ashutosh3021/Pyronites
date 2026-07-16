"""
Storage API — file upload, download, listing, and deletion.

Connection design: every route opens exactly ONE Database connection via
``get_db``.  The ``LocalFileStorage`` instance and the auth helpers both
receive that same connection object — there is no second ``get_db`` call
anywhere in this module.
"""
import os
import logging
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
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
    """Yield a single Database connection for the lifetime of the request."""
    db = Database(DB_PATH)
    db.connect()
    try:
        yield db
    finally:
        db.close()


def _resolve_auth(request: Request, db: Database) -> Optional[Dict[str, Any]]:
    """
    Resolve authentication from the request using the provided DB connection.

    Checks Bearer token first, then session cookie.  Returns a dict with
    ``type`` and ``scopes`` if authenticated, ``None`` otherwise.

    This is a plain function (not a FastAPI dependency) so callers can pass
    the route's own ``db`` instance, avoiding a second connection.
    """
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        api_key_str = auth_header.split(" ", 1)[1]
        api_key = validate_api_key(db, api_key_str)
        if api_key:
            return {"type": "api_key", "scopes": set(api_key.scopes)}

    session_token = request.cookies.get("session_token")
    if session_token:
        user = validate_session(db, session_token)
        if user:
            return {"type": "session", "scopes": {"read", "write", "admin"}}

    return None


def _require_scopes(
    auth_info: Optional[Dict[str, Any]],
    required_scopes: set,
) -> Dict[str, Any]:
    """
    Raise HTTP 401/403 if ``auth_info`` is missing or lacks the required scopes.

    Returns the ``auth_info`` dict unchanged on success.
    """
    if not auth_info:
        raise HTTPException(
            status_code=401,
            detail={"code": "unauthorized", "message": "Missing or invalid authentication"},
        )
    if not required_scopes.issubset(auth_info["scopes"]):
        raise HTTPException(
            status_code=403,
            detail={"code": "forbidden", "message": "Insufficient permissions"},
        )
    return auth_info


def _storage(db: Database) -> LocalFileStorage:
    """Return a LocalFileStorage bound to the given DB connection."""
    return LocalFileStorage(db, root_dir=STORAGE_ROOT)


def _record_to_dict(record: FileRecord) -> Dict[str, Any]:
    """Serialise a FileRecord to a JSON-safe dict."""
    return {
        "id": record.id,
        "original_filename": record.original_filename,
        "content_type": record.content_type,
        "size_bytes": record.size_bytes,
        "uploaded_at": record.uploaded_at.isoformat(),
        "project_id": record.project_id,
    }


# ---------------------------------------------------------------------------
# Routes — each uses a single ``db`` dependency and passes it everywhere
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    db: Database = Depends(get_db),
):
    """Upload a file to storage."""
    _require_scopes(_resolve_auth(request, db), {"write"})
    try:
        filename = file.filename or "unknown"
        content_type = file.content_type or "application/octet-stream"
        record = _storage(db).save(file.file, filename, content_type)
        return _record_to_dict(record)
    except InvalidFilenameError as e:
        raise HTTPException(status_code=400, detail={"code": "invalid_filename", "message": str(e)})
    except FileTooLargeError as e:
        raise HTTPException(status_code=413, detail={"code": "file_too_large", "message": str(e)})
    except Exception as e:
        logger.error("Failed to upload file: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to upload file"})


@router.get("")
async def list_files(
    request: Request,
    prefix: Optional[str] = None,
    db: Database = Depends(get_db),
):
    """List all files, optionally filtered by filename prefix."""
    _require_scopes(_resolve_auth(request, db), {"read"})
    try:
        return [_record_to_dict(r) for r in _storage(db).list(prefix)]
    except Exception as e:
        logger.error("Failed to list files: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to list files"})


@router.get("/{file_id}/download")
async def download_file(
    file_id: str,
    request: Request,
    db: Database = Depends(get_db),
):
    """Download a file by ID."""
    _require_scopes(_resolve_auth(request, db), {"read"})
    store = _storage(db)
    try:
        record = store.get_record(file_id)
        file_bytes = store.get(file_id)
        return StreamingResponse(
            iter([file_bytes]),
            media_type=record.content_type,
            headers={"Content-Disposition": f"attachment; filename={record.original_filename}"},
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "File not found"})
    except Exception as e:
        logger.error("Failed to download file: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to download file"})


@router.get("/{file_id}")
async def get_file_metadata(
    file_id: str,
    request: Request,
    db: Database = Depends(get_db),
):
    """Get metadata for a file by ID."""
    _require_scopes(_resolve_auth(request, db), {"read"})
    try:
        return _record_to_dict(_storage(db).get_record(file_id))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "File not found"})
    except Exception as e:
        logger.error("Failed to get file metadata: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to get file metadata"})


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    request: Request,
    db: Database = Depends(get_db),
):
    """Delete a file from storage."""
    _require_scopes(_resolve_auth(request, db), {"write"})
    try:
        _storage(db).delete(file_id)
        return {"message": "File deleted successfully"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "File not found"})
    except Exception as e:
        logger.error("Failed to delete file: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to delete file"})
