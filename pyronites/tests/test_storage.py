"""Unit tests for storage client (mocked HTTP)."""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from pyronites.errors import ApiError
from pyronites.storage import StorageClient


def _client(http: MagicMock) -> StorageClient:
    return StorageClient(http)


def test_upload_bytes():
    http = MagicMock()
    http.request.return_value = {
        "id": "f1",
        "original_filename": "a.txt",
        "content_type": "text/plain",
        "size_bytes": 5,
        "uploaded_at": "2026-01-01T00:00:00Z",
        "project_id": None,
    }
    sc = _client(http)
    meta = sc.upload(b"hello", filename="a.txt", content_type="text/plain")
    assert meta["id"] == "f1"
    http.request.assert_called_once()
    args, kwargs = http.request.call_args
    assert args[0] == "POST"
    assert args[1] == "/storage/upload"
    assert "files" in kwargs
    name, data, ctype = kwargs["files"]["file"]
    assert name == "a.txt"
    assert data == b"hello"
    assert ctype == "text/plain"


def test_upload_bytes_requires_filename():
    http = MagicMock()
    sc = _client(http)
    with pytest.raises(ApiError) as exc:
        sc.upload(b"hello")
    assert "filename" in str(exc.value).lower()


def test_upload_path(tmp_path: Path):
    http = MagicMock()
    http.request.return_value = {
        "id": "f2",
        "original_filename": "note.md",
        "content_type": "text/markdown",
        "size_bytes": 3,
        "uploaded_at": "2026-01-01T00:00:00Z",
        "project_id": None,
    }
    f = tmp_path / "note.md"
    f.write_text("abc")
    sc = _client(http)
    meta = sc.upload(f)
    assert meta["id"] == "f2"
    args, kwargs = http.request.call_args
    name, data, _ = kwargs["files"]["file"]
    assert name == "note.md"
    assert data == b"abc"


def test_list():
    http = MagicMock()
    http.request.return_value = [{"id": "f1"}, {"id": "f2"}]
    sc = _client(http)
    files = sc.list(prefix="img/", limit=10, offset=5)
    assert len(files) == 2
    args, kwargs = http.request.call_args
    assert args[0] == "GET"
    assert args[1] == "/storage"
    assert kwargs["params"]["prefix"] == "img/"
    assert kwargs["params"]["limit"] == 10
    assert kwargs["params"]["offset"] == 5


def test_get():
    http = MagicMock()
    http.request.return_value = {"id": "f1", "original_filename": "a.txt"}
    sc = _client(http)
    meta = sc.get("f1")
    assert meta["id"] == "f1"
    http.request.assert_called_once_with("GET", "/storage/f1")


def test_download_bytes():
    http = MagicMock()
    http.request.return_value = b"file-content"
    sc = _client(http)
    data = sc.download("f1")
    assert data == b"file-content"
    http.request.assert_called_once_with("GET", "/storage/f1/download")


def test_download_to_path(tmp_path: Path):
    http = MagicMock()
    http.request.return_value = b"saved"
    out = tmp_path / "out.bin"
    sc = _client(http)
    data = sc.download("f1", path=out)
    assert data == b"saved"
    assert out.read_bytes() == b"saved"


def test_remove():
    http = MagicMock()
    http.request.return_value = {"message": "File deleted successfully"}
    sc = _client(http)
    result = sc.remove("f1")
    assert "deleted" in result["message"].lower()
    http.request.assert_called_once_with("DELETE", "/storage/f1")


def test_client_has_storage(monkeypatch):
    monkeypatch.setenv("PYRONITES_URL", "https://example.com")
    from pyronites import create_client

    client = create_client()
    assert client.storage is not None
    client.close()
