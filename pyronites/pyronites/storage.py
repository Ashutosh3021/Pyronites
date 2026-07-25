"""Storage methods for the pyronites client."""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any, BinaryIO, Dict, List, Optional, Union

from pyronites.errors import ApiError
from pyronites.http import HttpTransport


class StorageClient:
    """Client for ``/storage/*`` routes."""

    def __init__(self, transport: HttpTransport) -> None:
        self._http = transport

    def upload(
        self,
        source: Union[str, Path, BinaryIO, bytes],
        *,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Upload a file.

        Parameters
        ----------
        source:
            Path string, ``Path``, open binary file, or raw ``bytes``.
        filename:
            Required when ``source`` is bytes or a file object without a name.
        content_type:
            Optional MIME type; guessed from filename when omitted.

        Returns
        -------
        dict
            Metadata matching backend shape:
            ``id``, ``original_filename``, ``content_type``, ``size_bytes``,
            ``uploaded_at``, ``project_id``.
        """
        name, data, ctype = self._resolve_upload(source, filename, content_type)
        files = {"file": (name, data, ctype)}
        result = self._http.request("POST", "/storage/upload", files=files)
        if not isinstance(result, dict):
            raise ApiError("Unexpected response from storage upload")
        return result

    def list(
        self,
        *,
        prefix: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List stored files (newest first).

        Maps to ``GET /storage``.
        """
        params: Dict[str, Any] = {"limit": limit, "offset": offset}
        if prefix is not None:
            params["prefix"] = prefix
        result = self._http.request("GET", "/storage", params=params)
        return result if isinstance(result, list) else []

    def get(self, file_id: str) -> Dict[str, Any]:
        """Return metadata for a file.

        Maps to ``GET /storage/{id}``.
        """
        result = self._http.request("GET", f"/storage/{file_id}")
        if not isinstance(result, dict):
            raise ApiError("Unexpected response from storage get")
        return result

    def download(
        self,
        file_id: str,
        *,
        path: Optional[Union[str, Path]] = None,
    ) -> bytes:
        """Download file bytes.

        Maps to ``GET /storage/{id}/download``.

        If ``path`` is given, also writes the bytes to that filesystem path.
        """
        data = self._http.request("GET", f"/storage/{file_id}/download")
        if isinstance(data, dict):
            raise ApiError("Unexpected JSON response from storage download")
        if not isinstance(data, (bytes, bytearray)):
            data = bytes(data) if data is not None else b""
        else:
            data = bytes(data)

        if path is not None:
            Path(path).write_bytes(data)
        return data

    def remove(self, file_id: str) -> Dict[str, Any]:
        """Delete a file.

        Maps to ``DELETE /storage/{id}``.
        """
        result = self._http.request("DELETE", f"/storage/{file_id}")
        return result if isinstance(result, dict) else {"message": "File deleted successfully"}

    def _resolve_upload(
        self,
        source: Union[str, Path, BinaryIO, bytes],
        filename: Optional[str],
        content_type: Optional[str],
    ) -> tuple[str, bytes, str]:
        if isinstance(source, (str, Path)):
            p = Path(source)
            if not p.is_file():
                raise ApiError(f"File not found: {p}")
            name = filename or p.name
            data = p.read_bytes()
        elif isinstance(source, (bytes, bytearray)):
            if not filename:
                raise ApiError("filename is required when uploading raw bytes")
            name = filename
            data = bytes(source)
        else:
            name = filename
            if not name:
                name = getattr(source, "name", None)
                if name:
                    name = Path(name).name
            if not name:
                raise ApiError("filename is required when uploading a file object without a name")
            data = source.read()
            if isinstance(data, str):
                data = data.encode("utf-8")

        ctype = content_type or mimetypes.guess_type(name)[0] or "application/octet-stream"
        return name, data, ctype
