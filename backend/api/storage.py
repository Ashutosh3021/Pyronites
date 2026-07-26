"""
Storage API — file upload, download, listing, and deletion.

Works at /storage and /api/projects/{project_id}/storage.
"""
import logging
import os
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
from backend.api.project_deps import get_db, auth_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/storage", tags=["storage"])


def _auth(request: Request, db: Database):
    return resolve_auth(request, auth_db(request, db))


def _storage(db: Database) -> LocalFileStorage:
    root_dir = os.environ.get("STORAGE_ROOT", "storage_files")
    return LocalFileStorage(db, root_dir=root_dir)


def _record_to_dict(record: FileRecord) -> Dict[str, Any]:
    return {
        "id": record.id,
        "original_filename": record.original_filename,
        "content_type": record.content_type,
        "size_bytes": record.size_bytes,
        "uploaded_at": to_utc_iso(record.uploaded_at),
        "project_id": record.project_id,
    }


@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    db: Database = Depends(get_db),
):
    require_scopes(_auth(request, db), {"write"})
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
    require_scopes(_auth(request, db), {"read"})
    try:
        records = _storage(db).list(prefix, limit=limit, offset=offset)
        return [_record_to_dict(r) for r in records]
    except Exception as e:
        logger.error("Failed to list files: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=ErrorResponse(code="internal_error", message="Failed to list files").model_dump())


@router.get("/{file_id}/download")
async def download_file(file_id: str, request: Request, db: Database = Depends(get_db)):
    require_scopes(_auth(request, db), {"read"})
    store = _storage(db)
    try:
        record = store.get_record(file_id)
        file_bytes = store.get(file_id)
        return StreamingResponse(
            iter([file_bytes]),
            media_type=record.content_type,
            headers={"Content-Disposition": f'attachment; filename="{record.original_filename}"'},
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=ErrorResponse(code="not_found", message="File not found").model_dump())
    except Exception as e:
        logger.error("Failed to download file: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=ErrorResponse(code="internal_error", message="Failed to download file").model_dump())


@router.get("/{file_id}")
async def get_file_metadata(file_id: str, request: Request, db: Database = Depends(get_db)):
    require_scopes(_auth(request, db), {"read"})
    try:
        return _record_to_dict(_storage(db).get_record(file_id))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=ErrorResponse(code="not_found", message="File not found").model_dump())
    except Exception as e:
        logger.error("Failed to get file metadata: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=ErrorResponse(code="internal_error", message="Failed to get file metadata").model_dump())


@router.delete("/{file_id}")
async def delete_file(file_id: str, request: Request, db: Database = Depends(get_db)):
    require_scopes(_auth(request, db), {"write"})
    try:
        _storage(db).delete(file_id)
        return {"message": "File deleted successfully"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=ErrorResponse(code="not_found", message="File not found").model_dump())
    except Exception as e:
        logger.error("Failed to delete file: %s", e, exp_info=True)
        raise HTTPException(status_code=500, detail=ErrorResponse(code="internal_error", message="Failed to delete file").model_dump())
