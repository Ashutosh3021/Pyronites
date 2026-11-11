"""
Row addressing is resolved from the table's own primary key.

The row endpoints used to hard-code ``WHERE id = ?``.  A table whose primary
key is called something else (``code``, ``uuid``) was therefore unaddressable:
the frontend refused to send the request ("Row has no id.") and the backend
answered a bare 500 when it did.  These tests pin the fixed behaviour on both
planes, plus the project-scoped connection prompt the dashboard exports.
"""

import os
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app


@pytest.fixture
def app_env(tmp_path, monkeypatch):
    db = tmp_path / "pyrocore.db"
    monkeypatch.setenv("DATABASE_PATH", str(db))
    monkeypatch.setenv("PROJECTS_DIR", str(tmp_path / "projects"))
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path / "storage_files"))
    yield


@pytest.fixture
def session_client(app_env):
    with TestClient(create_app()) as client:
        r = client.post(
            "/auth/signup",
            json={"email": "rows@example.com", "password": "secret123"},
        )
        assert r.status_code == 200, r.text
        yield client


@pytest.fixture
def project(session_client):
    """A non-default project, so it gets its own database file."""
    r = session_client.post(
        "/api/projects",
        json={"project_id": "rowsproj", "project_name": "Rows Project"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return {"id": body["id"], "slug": body["project_id"], "name": body["project_name"]}


def _create_table(client, prefix, table, columns, primary_key):
    r = client.post(
        f"{prefix}/tables",
        json={"table": table, "columns": columns, "primary_key": primary_key},
    )
    assert r.status_code == 200, r.text
    return r


class TestRowKeyResolution:
    """Both planes must address a row by the table's primary key."""

    @pytest.mark.parametrize("prefix", ["", "/api/projects/{pid}"])
    def test_delete_row_by_custom_primary_key(self, session_client, project, prefix):
        prefix = prefix.format(pid=project["id"])
        _create_table(
            session_client,
            prefix,
            "tickets",
            [{"name": "code", "type": "TEXT"}, {"name": "title", "type": "TEXT"}],
            "code",
        )
        inserted = session_client.post(
            f"{prefix}/tables/tickets",
            json={"code": "T-1", "title": "First"},
        )
        assert inserted.status_code == 200, inserted.text

        deleted = session_client.delete(f"{prefix}/tables/tickets/T-1")
        assert deleted.status_code == 200, deleted.text

        missing = session_client.get(f"{prefix}/tables/tickets/T-1")
        assert missing.status_code == 404

    @pytest.mark.parametrize("prefix", ["", "/api/projects/{pid}"])
    def test_update_row_by_custom_primary_key(self, session_client, project, prefix):
        prefix = prefix.format(pid=project["id"])
        _create_table(
            session_client,
            prefix,
            "tickets",
            [{"name": "code", "type": "TEXT"}, {"name": "title", "type": "TEXT"}],
            "code",
        )
        session_client.post(
            f"{prefix}/tables/tickets",
            json={"code": "T-2", "title": "Before"},
        )
        updated = session_client.patch(
            f"{prefix}/tables/tickets/T-2",
            json={"title": "After"},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["title"] == "After"

    @pytest.mark.parametrize("prefix", ["", "/api/projects/{pid}"])
    def test_table_without_primary_key_returns_400_not_500(
        self, session_client, project, prefix
    ):
        """No primary key and no 'id' column means no addressable row.

        The old code raised ``no such column: id`` and the generic handler
        turned it into a 500 with no hint.  It must be a 400 that names the fix.
        """
        prefix = prefix.format(pid=project["id"])
        _create_table(
            session_client,
            prefix,
            "loose_rows",
            [{"name": "label", "type": "TEXT"}],
            None,
        )
        session_client.post(f"{prefix}/tables/loose_rows", json={"label": "x"})

        deleted = session_client.delete(f"{prefix}/tables/loose_rows/1")
        assert deleted.status_code == 400, deleted.text
        assert "primary key" in deleted.text.lower()

    def test_missing_row_returns_404(self, session_client):
        _create_table(
            session_client,
            "",
            "tickets",
            [{"name": "code", "type": "TEXT"}],
            "code",
        )
        deleted = session_client.delete("/tables/tickets/nope")
        assert deleted.status_code == 404


class TestConnectPrompt:
    """The dashboard exports this prompt; the wiring skill parses it."""

    def test_prompt_carries_the_project_identity(self, session_client, project):
        r = session_client.get(
            f"/api/projects/{project['id']}/connect-prompt",
            params={"base_url": "https://api.example.com"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == "rows@example.com"
        assert body["project_id"] == project["id"]
        assert body["project_slug"] == project["slug"]
        assert body["backend_url"] == "https://api.example.com"

        prompt = body["prompt"]
        assert "PYRONITES_URL=https://api.example.com" in prompt
        assert "PYRONITES_EMAIL=rows@example.com" in prompt
        assert f"PYRONITES_PROJECT_ID={project['id']}" in prompt
        assert f"PYRONITES_PROJECT_SLUG={project['slug']}" in prompt

    def test_api_key_field_is_left_blank(self, session_client, project):
        """The prompt never carries a credential the user did not supply."""
        r = session_client.get(f"/api/projects/{project['id']}/connect-prompt")
        assert r.status_code == 200, r.text
        prompt = r.json()["prompt"]
        key_lines = [ln for ln in prompt.splitlines() if ln.startswith("PYRONITES_API_KEY=")]
        assert key_lines == ["PYRONITES_API_KEY="]

    def test_non_http_base_url_is_ignored(self, session_client, project):
        r = session_client.get(
            f"/api/projects/{project['id']}/connect-prompt",
            params={"base_url": "file:///etc/passwd"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["backend_url"].startswith("http")

    def test_requires_authentication(self, app_env):
        with TestClient(create_app()) as client:
            r = client.get("/api/projects/whatever/connect-prompt")
            assert r.status_code == 401
