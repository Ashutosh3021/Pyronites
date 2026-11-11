"""Project scoping and row-key resolution in the client."""

from unittest.mock import MagicMock, patch

import pytest

from pyronites.config import ClientConfig, load_config
from pyronites.errors import ApiError
from pyronites.http import HttpTransport, scope_path
from pyronites.table import TableQuery


def _transport(project_id=None) -> HttpTransport:
    return HttpTransport(
        ClientConfig(url="https://example.com", key="k", timeout=5, project_id=project_id)
    )


class TestScopePath:
    def test_no_project_leaves_paths_alone(self):
        assert scope_path("/tables/notes", None) == "/tables/notes"

    @pytest.mark.parametrize(
        "path",
        ["/tables", "/tables/notes", "/storage/upload", "/sql/execute", "/api/keys"],
    )
    def test_data_paths_are_scoped(self, path):
        assert scope_path(path, "abc") == f"/api/projects/abc{path}"

    @pytest.mark.parametrize("path", ["/auth/me", "/auth/login", "/health", "/api/projects"])
    def test_tenancy_blind_paths_are_not_scoped(self, path):
        assert scope_path(path, "abc") == path

    def test_already_scoped_paths_are_left_alone(self):
        assert scope_path("/api/projects/abc/tables", "abc") == "/api/projects/abc/tables"


class TestTransportScoping:
    def test_request_is_rewritten_to_the_project(self):
        t = _transport("proj-1")
        resp = MagicMock()
        resp.status_code = 200
        resp.content = b"[]"
        resp.json.return_value = []
        with patch.object(t._client, "request", return_value=resp) as mock_req:
            t.request("GET", "/tables")
        assert mock_req.call_args[0][1] == "/api/projects/proj-1/tables"
        t.close()

    def test_auth_stays_unscoped(self):
        t = _transport("proj-1")
        resp = MagicMock()
        resp.status_code = 200
        resp.content = b"{}"
        resp.json.return_value = {}
        with patch.object(t._client, "request", return_value=resp) as mock_req:
            t.request("GET", "/auth/me")
        assert mock_req.call_args[0][1] == "/auth/me"
        t.close()

    def test_primary_key_is_read_from_the_schema(self):
        t = _transport("proj-1")
        resp = MagicMock()
        resp.status_code = 200
        resp.content = b"[]"
        resp.json.return_value = [
            {"name": "code", "type": "TEXT", "pk": True},
            {"name": "title", "type": "TEXT", "pk": False},
        ]
        with patch.object(t._client, "request", return_value=resp) as mock_req:
            assert t.primary_key("tickets") == "code"
        assert mock_req.call_args[0][1] == "/api/projects/proj-1/tables/tickets/schema"
        t.close()

    def test_primary_key_falls_back_to_id(self):
        t = _transport()
        resp = MagicMock()
        resp.status_code = 200
        resp.content = b"[]"
        resp.json.return_value = [{"name": "id", "type": "TEXT", "pk": False}]
        with patch.object(t._client, "request", return_value=resp):
            assert t.primary_key("notes") == "id"
        t.close()


class TestConfigProjectId:
    def test_explicit_project_id_wins(self, monkeypatch):
        monkeypatch.setenv("PYRONITES_PROJECT_ID", "from-env")
        config = load_config(url="https://example.com", key="k", project_id="explicit")
        assert config.project_id == "explicit"

    def test_project_id_falls_back_to_the_environment(self, monkeypatch):
        monkeypatch.setenv("PYRONITES_PROJECT_ID", "from-env")
        config = load_config(url="https://example.com", key="k")
        assert config.project_id == "from-env"

    def test_no_project_id_at_all(self, monkeypatch):
        monkeypatch.delenv("PYRONITES_PROJECT_ID", raising=False)
        config = load_config(url="https://example.com", key="k")
        assert config.project_id is None


class TestRowKeyResolution:
    def test_delete_accepts_the_real_primary_key(self):
        http = MagicMock()
        http.request.return_value = {"message": "Row deleted"}
        http.primary_key.return_value = "code"
        q = TableQuery(http, "tickets")
        q.delete().eq("code", "T-1")
        args, _ = http.request.call_args
        assert args[0] == "DELETE"
        assert args[1] == "/tables/tickets/T-1"

    def test_delete_rejects_a_non_key_column(self):
        http = MagicMock()
        http.primary_key.return_value = "code"
        q = TableQuery(http, "tickets")
        with pytest.raises(ApiError) as exc:
            q.delete().eq("title", "T-1")
        assert "code" in str(exc.value)

    def test_update_does_not_overwrite_the_key_column(self):
        http = MagicMock()
        http.request.return_value = {"code": "T-1"}
        http.primary_key.return_value = "code"
        q = TableQuery(http, "tickets")
        q.update({"code": "hijacked", "title": "new"}).eq("code", "T-1")
        args, kwargs = http.request.call_args
        assert args[0] == "PATCH"
        assert args[1] == "/tables/tickets/T-1"
        assert kwargs["json"] == {"title": "new"}

    def test_id_filter_never_asks_for_the_schema(self):
        http = MagicMock()
        http.request.return_value = {"message": "Row deleted"}
        q = TableQuery(http, "notes")
        q.delete().eq("id", "1")
        http.primary_key.assert_not_called()
