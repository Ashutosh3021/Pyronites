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

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, Query
from fastapi.responses import StreamingResponse

from backend.core.db import Database
from backend.core.storage import (
    LocalFileStorage,
    FileRecord,
    InvalidFilenameError,
    FileTooLargeError,
)
from backend.api.schemas import ErrorResponse, to_utc_iso
from backend.api.auth_deps import resolve_auth, require_scopes

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/storage", tags=["storage"])


def get_db() -> Database:
    """Yield a single Database connection for the lifetime of the request."""
    db = Database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    db.connect()
    try:
        yield db
    finally:
        db.close()


def _storage(db: Database) -> LocalFileStorage:
    """Return a LocalFileStorage bound to the given DB connection."""
    root_dir = os.environ.get("STORAGE_ROOT", "storage_files")
    return LocalFileStorage(db, root_dir=root_dir)


def _record_to_dict(record: FileRecord) -> Dict[str, Any]:
    """
    Serialise a ``FileRecord`` to a JSON-safe dict for API responses.

    ``uploaded_at`` is rendered with ``to_utc_iso`` so every timestamp in the
    API uses the same ISO 8601 UTC ``Z`` format as the rest of the contract
    (see ``backend.api.schemas``).
    """
    return {
        "id": record.id,
        "original_filename": record.original_filename,
        "content_type": record.content_type,
        "size_bytes": record.size_bytes,
        "uploaded_at": to_utc_iso(record.uploaded_at),
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
    require_scopes(resolve_auth(request, db), {"write"})
    try:
        filename = file.filename or "unknown"
        content_type = file.content_type or "application/octet-stream"
        record = _storage(db).save(file.file, filename, content_type)
        return _record_to_dict(record)
    except InvalidFilenameError as e:
        raise HTTPException(status_code=400, detail=ErrorResponse(code="invalid_filename", message=str(e)).model_dump())
    except FileTooLargeError as e:
        raise HTTPException(status_code=413, detail=ErrorResponse(code="file_too_large", message=str(e)).model_dump())
    except Exception as e:
        logger.error("Failed to upload file: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=ErrorResponse(code="internal_error", message="Failed to upload file").model_dump())


@router.get("")
async def list_files(
    request: Request,
    prefix: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db),
):
    """
    List files for this project, newest-first.

    Uses the same ``limit``/``offset`` pagination shape as ``GET /tables/{table}``
    so the dashboard can page both list views identically.  Returns a bare JSON
    array of file metadata objects (no envelope) to match that endpoint.
    """
    require_scopes(resolve_auth(request, db), {"read"})
    try:
        records = _storage(db).list(prefix, limit=limit, offset=offset)
        return [_record_to_dict(r) for r in records]
    except Exception as e:
        logger.error("Failed to list files: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=ErrorResponse(code="internal_error", message="Failed to list files").model_dump())


@router.get("/{file_id}/download")
async def download_file(
    file_id: str,
    request: Request,
    db: Database = Depends(get_db),
):
    """Download a file by ID."""
    require_scopes(resolve_auth(request, db), {"read"})
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
        raise HTTPException(status_code=404, detail=ErrorResponse(code="not_found", message="File not found").model_dump())
    except Exception as e:
        logger.error("Failed to download file: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=ErrorResponse(code="internal_error", message="Failed to download file").model_dump())


@router.get("/{file_id}")
async def get_file_metadata(
    file_id: str,
    request: Request,
    db: Database = Depends(get_db),
):
    """Get metadata for a file by ID."""
    require_scopes(resolve_auth(request, db), {"read"})
    try:
        return _record_to_dict(_storage(db).get_record(file_id))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=ErrorResponse(code="not_found", message="File not found").model_dump())
    except Exception as e:
        logger.error("Failed to get file metadata: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=ErrorResponse(code="internal_error", message="Failed to get file metadata").model_dump())


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    request: Request,
    db: Database = Depends(get_db),
):
    """Delete a file from storage."""
    require_scopes(resolve_auth(request, db), {"write"})
    try:
        _storage(db).delete(file_id)
        return {"message": "File deleted successfully"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=ErrorResponse(code="not_found", message="File not found").model_dump())
    except Exception as e:
        logger.error("Failed to delete file: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=ErrorResponse(code="internal_error", message="Failed to delete file").model_dump())
