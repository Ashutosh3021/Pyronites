"""
Tests for project CRUD endpoints.
"""

import os
import tempfile
import shutil
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.projects import router as projects_router
from backend.api.auth import router as auth_router
from backend.core.db import Database
from backend.core.migrations import run_pending_migrations


@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def client(temp_dir):
    db_path = temp_dir / "test.db"
    migrations_dir = temp_dir / "migrations"
    migrations_dir.mkdir()
    real = Path(__file__).parent.parent.parent / "migrations"
    for f in real.glob("*.sql"):
        shutil.copy(f, migrations_dir / f.name)

    db = Database(str(db_path))
    db.connect()
    run_pending_migrations(db, str(migrations_dir))
    db.close()

    os.environ["DATABASE_PATH"] = str(db_path)
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(projects_router)
    test_client = TestClient(app)

    # Create a user and log in
    test_client.post("/auth/signup", json={"email": "proj@example.com", "password": "secret123"})
    yield test_client


class TestProjectCRUD:
    def test_create_project(self, client):
        r = client.post("/api/projects", json={
            "project_id": "myproj",
            "project_name": "My Project",
        })
        assert r.status_code == 200
        body = r.json()
        assert body["project_id"] == "myproj"
        assert body["project_name"] == "My Project"

    def test_list_projects(self, client):
        client.post("/api/projects", json={"project_id": "p1", "project_name": "Project 1"})
        r = client.get("/api/projects")
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_get_project_detail(self, client):
        client.post("/api/projects", json={"project_id": "detail", "project_name": "Detail"})
        r = client.get("/api/projects/detail")
        assert r.status_code == 200
        assert r.json()["project_id"] == "detail"

    def test_rename_project(self, client):
        client.post("/api/projects", json={"project_id": "rename", "project_name": "Old Name"})
        r = client.patch("/api/projects/rename", json={"name": "New Name"})
        assert r.status_code == 200
        assert r.json()["project_name"] == "New Name"

    def test_archive_project(self, client):
        # Create a second project so we can archive one (can't archive the last one)
        client.post("/api/projects", json={"project_id": "arch1", "project_name": "Arch1"})
        client.post("/api/projects", json={"project_id": "arch2", "project_name": "Arch2"})
        r = client.post("/api/projects/arch1/archive")
        assert r.status_code == 200

    def test_restore_project(self, client):
        client.post("/api/projects", json={"project_id": "rest1", "project_name": "Rest1"})
        client.post("/api/projects", json={"project_id": "rest2", "project_name": "Rest2"})
        client.post("/api/projects/rest1/archive")
        r = client.post("/api/projects/rest1/restore")
        assert r.status_code == 200

    def test_hard_delete_project(self, client):
        client.post("/api/projects", json={"project_id": "del1", "project_name": "Del1"})
        client.post("/api/projects", json={"project_id": "del2", "project_name": "Del2"})
        r = client.request("DELETE", "/api/projects/del1", json={"confirm_name": "Del1"})
        assert r.status_code == 200

    def test_hard_delete_project_wrong_confirmation(self, client):
        client.post("/api/projects", json={"project_id": "del3", "project_name": "Del3"})
        client.post("/api/projects", json={"project_id": "del4", "project_name": "Del4"})
        r = client.request("DELETE", "/api/projects/del3", json={"confirm_name": "wrong_name"})
        assert r.status_code == 400

    def test_cannot_delete_last_active_project(self, client):
        # The Default project was created on signup. We can't delete it if it's the only one.
        # Actually, we can create another project, then try to delete the last active one.
        r = client.request("DELETE", "/api/projects/default", json={"confirm_name": "Default"})
        # Should fail because it's the last active project
        assert r.status_code == 400

    def test_unauthenticated_returns_401(self):
        app = FastAPI()
        app.include_router(projects_router)
        c = TestClient(app)
        r = c.get("/api/projects")
        assert r.status_code == 401
