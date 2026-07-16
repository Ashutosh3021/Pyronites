"""
End-to-end critical journey against the assembled FastAPI app.

Exercises the exact user flow the dashboard drives, in dependency order:
  signup → login → create project → create table (DDL) → insert row →
  list rows → SELECT via /sql/execute → create API key → use that key
  (Bearer) from a *separate* client to mutate a table (proves external
  usability) → upload file → delete file → DROP table (asserts auto-backup).

This complements the router-level unit tests by asserting the contracts the
frontend depends on (field names, masked keys, ISO-Z timestamps, backup flag).
"""

import os
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app


@pytest.fixture
def app_env(tmp_path, monkeypatch):
    """Point the app at a throwaway DB + storage root for the duration."""
    db = tmp_path / "pyrocore.db"
    storage = tmp_path / "storage_files"
    monkeypatch.setenv("DATABASE_PATH", str(db))
    monkeypatch.setenv("STORAGE_ROOT", str(storage))
    yield


@pytest.fixture
def session_client(app_env):
    """A logged-in dashboard session client (cookie captured on signup)."""
    with TestClient(create_app()) as client:
        # Signup auto-logs the user in (cookie stored by TestClient's jar).
        r = client.post(
            "/auth/signup",
            json={"email": "demo@example.com", "password": "secret123"},
        )
        assert r.status_code == 200, r.text
        yield client


def test_critical_journey(session_client):
    client = session_client

    # ── login on a fresh client (re-derive session from credentials) ──────────
    login = client.post(
        "/auth/login",
        json={"email": "demo@example.com", "password": "secret123"},
    )
    assert login.status_code == 200
    assert "session_token" in client.cookies

    # ── create project (mints the initial `default` API key) ──────────────────
    proj = client.post(
        "/api/projects",
        json={
            "project_id": "demo",
            "project_name": "Demo Project",
            "storage_location": "local",
            "backup_interval": "1hour",
            "admin_password": "admins3cret!",
            "enable_public_api": True,
        },
    )
    assert proj.status_code == 200, proj.text
    proj_body = proj.json()
    assert proj_body["project_id"] == "demo"
    assert proj_body["project_name"] == "Demo Project"
    assert "api_key" in proj_body and proj_body["api_key"]["key"].startswith("pyro_live_")

    # ── create a table via DDL (admin scope — session has it) ─────────────────
    ddl = client.post(
        "/tables",
        json={
            "table": "items",
            "columns": [
                {"name": "id", "type": "INTEGER"},
                {"name": "label", "type": "TEXT"},
                {"name": "created_at", "type": "DATETIME"},
            ],
            "primary_key": "id",
        },
    )
    assert ddl.status_code == 200, ddl.text
    assert ddl.json()["table"] == "items"

    # ── insert a row (write scope) ─────────────────────────────────────────────
    insert = client.post(
        "/tables/items",
        json={"label": "first", "created_at": "2026-07-16T00:00:00Z"},
    )
    assert insert.status_code == 200, insert.text
    assert insert.json()["label"] == "first"

    # ── list rows ──────────────────────────────────────────────────────────────
    listing = client.get("/tables/items")
    assert listing.status_code == 200, listing.text
    rows = listing.json()
    assert isinstance(rows, list) and len(rows) == 1

    # ── SELECT via /sql/execute ───────────────────────────────────────────────
    sel = client.post("/sql/execute", json={"sql": "SELECT * FROM items"})
    assert sel.status_code == 200, sel.text
    body = sel.json()
    assert body["backup"]["taken"] is False
    assert body["results"][0]["columns"] == ["id", "label", "created_at"]
    assert body["results"][0]["row_count"] == 1

    # ── create a dedicated API key (read + write) ──────────────────────────────
    mk = client.post(
        "/api/keys",
        json={"name": "external", "scopes": ["read", "write"]},
    )
    assert mk.status_code == 200, mk.text
    raw_key = mk.json()["key"]
    assert raw_key.startswith("pyro_live_")

    # The key list returns a masked form, never the raw value.
    keys = client.get("/api/keys")
    assert keys.status_code == 200
    masked = [k for k in keys.json() if k["name"] == "external"][0]
    assert "•" in masked["masked"] and "external" not in masked["masked"]

    # ── use the API key from a SEPARATE client (Bearer) — external usability ───
    with TestClient(create_app()) as ext:
        ext.headers["Authorization"] = f"Bearer {raw_key}"
        # read
        r1 = ext.get("/tables/items")
        assert r1.status_code == 200 and len(r1.json()) == 1
        # write (insert another row)
        r2 = ext.post("/tables/items", json={"label": "from-key"})
        assert r2.status_code == 200, r2.text
        # the session client should now see 2 rows
        assert len(client.get("/tables/items").json()) == 2
        # DDL is admin-only and the key lacks admin → must be rejected
        r3 = ext.post("/tables", json={"table": "nope", "columns": [{"name": "x", "type": "TEXT"}]})
        assert r3.status_code == 403

    # ── upload a file then delete it ───────────────────────────────────────────
    upload = client.post(
        "/storage/upload",
        files={"file": ("hello.txt", b"hello world", "text/plain")},
    )
    assert upload.status_code == 200, upload.text
    file_id = upload.json()["id"]
    assert upload.json()["original_filename"] == "hello.txt"
    assert upload.json()["size_bytes"] == 11

    listing_files = client.get("/storage")
    assert listing_files.status_code == 200
    assert any(f["id"] == file_id for f in listing_files.json())

    delete = client.delete(f"/storage/{file_id}")
    assert delete.status_code == 200

    # ── DROP table triggers an automatic backup ───────────────────────────────
    drop = client.post("/sql/execute", json={"sql": "DROP TABLE items"})
    assert drop.status_code == 200, drop.text
    drop_body = drop.json()
    assert drop_body["backup"]["taken"] is True
    assert drop_body["backup"]["path"]


def test_protected_routes_reject_anonymous(app_env):
    """Regression: every dashboard route requires a session or API key."""
    with TestClient(create_app()) as client:
        assert client.get("/tables").status_code == 401
        assert client.get("/api/stats").status_code == 401
        assert client.get("/api/keys").status_code == 401
        assert client.post("/api/projects", json={"project_id": "x", "project_name": "y"}).status_code == 401
        # Health remains public.
        assert client.get("/health").status_code == 200
