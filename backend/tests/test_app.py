
"""
Regression tests for the assembled FastAPI application.

These guard against the integration bug where the CLI `start` command built a
DIFFERENT app than the container entry point — it mounted only the tables
router (under a `/api` prefix) and silently omitted health + storage.  By
asserting on the single `create_app()` factory output, we guarantee the
server and the CLI always expose the identical surface.
"""

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app


@pytest.fixture
def client():
    # No DB-backed routes are exercised here, so the default in-memory config is fine.
    return TestClient(create_app())


def test_app_mounts_all_routers(client):
    paths = set(client.app.openapi()["paths"].keys())
    # Health
    assert "/health" in paths
    # Tables (no global /api prefix — matches ARCHITECTURE.md §4)
    assert "/tables/{table}" in paths
    assert "/tables/{table}/{id}" in paths
    # Storage
    assert "/storage/upload" in paths
    assert "/storage/{file_id}" in paths
    assert "/sql/execute" in paths


def test_health_endpoint_is_public(client):
    # Health must not require auth (it is the Docker HEALTHCHECK target).
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] in ("ok", "degraded")


def test_storage_is_protected_even_through_canonical_app(client):
    # Confirms the storage router is actually wired into the canonical app
    # (the bug was that `start` omitted it entirely).
    response = client.get("/storage")
    assert response.status_code == 401


def test_sql_endpoint_requires_admin_scope(client):
    # Unauthenticated → 401 (the SQL editor is admin-only).
    response = client.post("/sql/execute", json={"sql": "SELECT 1"})
    assert response.status_code == 401
