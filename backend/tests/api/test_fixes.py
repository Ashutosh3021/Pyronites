
import os
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app


@pytest.fixture
def client(tmp_path):
    db_path = str(tmp_path / "test_pyrocore.db")
    storage_root = str(tmp_path / "storage_files")
    os.environ["DATABASE_PATH"] = db_path
    os.environ["STORAGE_ROOT"] = storage_root
    # Disable the scheduled backup loop's S3 upload noise.
    os.environ.pop("S3_SYNC_ENABLED", None)
    app = create_app()
    with TestClient(app) as c:
        yield c


def _signup_login(client, email):
    client.post(
        "/auth/signup",
        json={"email": email, "password": "testpassword123"},
    )
    client.post(
        "/auth/login",
        json={"email": email, "password": "testpassword123"},
    )


def test_auth_me_returns_last_project_id(client):
    email = f"me_{uuid.uuid4().hex[:8]}@example.com"
    _signup_login(client, email)
    # Select the default project (last_project_id defaults to it).
    me = client.get("/auth/me")
    assert me.status_code == 200
    body = me.json()
    assert "last_project_id" in body
    # After creating a new project it becomes the active project.
    created = client.post(
        "/api/projects",
        json={"project_id": "fixproj", "project_name": "FixProj"},
    )
    assert created.status_code == 200
    new_id = created.json()["id"]
    me2 = client.get("/auth/me")
    assert me2.json()["last_project_id"] == new_id


def test_project_select_endpoint(client):
    email = f"sel_{uuid.uuid4().hex[:8]}@example.com"
    _signup_login(client, email)
    created = client.post(
        "/api/projects",
        json={"project_id": "selproj", "project_name": "SelProj"},
    )
    pid = created.json()["id"]
    resp = client.post(f"/api/projects/{pid}/select")
    assert resp.status_code == 200
    assert resp.json()["project_id"] == pid


def test_sql_execute_with_read_write_api_key(client, tmp_path):
    """Regression for E1: a read+write API key must run SQL (no admin required)."""
    email = f"sql_{uuid.uuid4().hex[:8]}@example.com"
    _signup_login(client, email)
    created = client.post(
        "/api/projects",
        json={"project_id": "sqlproj", "project_name": "SqlProj"},
    )
    pid = created.json()["id"]
    key_resp = client.post(
        f"/api/projects/{pid}/api/keys",
        json={"name": "k", "scopes": ["read", "write"]},
    )
    assert key_resp.status_code == 200
    key = key_resp.json()["key"]
    resp = client.post(
        f"/api/projects/{pid}/sql/execute",
        headers={"Authorization": f"Bearer {key}"},
        json={"sql": "SELECT 1 AS ok"},
    )
    assert resp.status_code == 200, resp.text
    results = resp.json()["results"]
    assert results[0]["kind"] == "select"
    assert results[0]["rows"] == [[1]]


def test_storage_download_returns_bytes(client, tmp_path):
    """Regression for E2: /storage/{id} is metadata, /storage/{id}/download is bytes."""
    email = f"sto_{uuid.uuid4().hex[:8]}@example.com"
    _signup_login(client, email)
    content = b"Hello from PyroCore storage test"
    upload = client.post(
        "/storage/upload",
        files={"file": ("test.txt", content, "text/plain")},
    )
    assert upload.status_code == 200
    fid = upload.json()["id"]

    meta = client.get(f"/storage/{fid}")
    assert meta.status_code == 200
    assert meta.json()["id"] == fid  # metadata, not raw bytes

    dl = client.get(f"/storage/{fid}/download")
    assert dl.status_code == 200
    assert dl.content == content  # actual file bytes


def test_s3_restore_never_clobbers_existing_local(tmp_path, monkeypatch):
    """Regression for RCA-2: an existing local DB must NOT be overwritten by a
    (possibly older) remote snapshot on cold/warm start."""
    from unittest.mock import MagicMock

    from backend.core.s3_sync import S3Sync

    local_db = tmp_path / "pyrocore.db"
    local_db.write_text("local live data")

    syncer = S3Sync(bucket="b", prefix="pyrocore/")
    fake_client = MagicMock()
    monkeypatch.setattr(syncer, "_get_client", lambda: fake_client)

    # Local present → must skip and never touch the remote copy.
    assert syncer.download(str(local_db)) is False
    fake_client.download_file.assert_not_called()
    fake_client.head_object.assert_not_called()
    assert local_db.read_text() == "local live data"

    # Local absent → must attempt the remote download.
    local_db.unlink()
    assert syncer.download(str(local_db)) is True
    fake_client.head_object.assert_called_once()
    fake_client.download_file.assert_called_once()
