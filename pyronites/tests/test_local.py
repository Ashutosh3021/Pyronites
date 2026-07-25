"""Unit tests for local store and table policy (Phase P3)."""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from pyronites.config import POLICY_CACHE, POLICY_LOCAL, POLICY_REMOTE, load_config
from pyronites.errors import ApiError
from pyronites.local import LocalStore
from pyronites.table import TableQuery


def test_policy_priority(monkeypatch):
    monkeypatch.setenv("PYRONITES_URL", "https://example.com")
    cfg = load_config(
        local_tables=["settings"],
        cache_tables=["catalog"],
        remote_tables=["notes"],
    )
    assert cfg.table_policy("settings") == POLICY_LOCAL
    assert cfg.table_policy("catalog") == POLICY_CACHE
    assert cfg.table_policy("notes") == POLICY_REMOTE
    assert cfg.table_policy("other") == POLICY_REMOTE


def test_local_store_crud(tmp_path: Path):
    store = LocalStore(str(tmp_path / "local.db"))
    row = store.insert("settings", {"theme": "dark"})
    assert "id" in row
    assert row["theme"] == "dark"
    rows = store.select("settings")
    assert len(rows) == 1
    updated = store.update("settings", row["id"], {"theme": "light"})
    assert updated["theme"] == "light"
    store.delete("settings", row["id"])
    assert store.select("settings") == []
    store.close()


def test_local_only_table_no_http(tmp_path: Path):
    http = MagicMock()
    store = LocalStore(str(tmp_path / "local.db"))
    q = TableQuery(http, "settings", policy=POLICY_LOCAL, local=store)
    inserted = q.insert({"key": "a", "value": "1"})
    assert inserted["key"] == "a"
    http.request.assert_not_called()
    rows = list(q.select())
    assert len(rows) == 1
    http.request.assert_not_called()
    q.update({"value": "2"}).eq("id", inserted["id"])
    http.request.assert_not_called()
    q.delete().eq("id", inserted["id"])
    http.request.assert_not_called()
    store.close()


def test_remote_table_uses_http():
    http = MagicMock()
    http.request.return_value = [{"id": "1"}]
    q = TableQuery(http, "notes", policy=POLICY_REMOTE, local=None)
    rows = list(q.select())
    assert rows == [{"id": "1"}]
    http.request.assert_called()


def test_cache_read_miss_then_store(tmp_path: Path):
    http = MagicMock()
    http.request.return_value = [{"id": "c1", "name": "item"}]
    store = LocalStore(str(tmp_path / "cache.db"))
    q = TableQuery(http, "catalog", policy=POLICY_CACHE, local=store)
    rows = list(q.select())
    assert len(rows) == 1
    http.request.assert_called_once()
    http.reset_mock()
    rows2 = list(q.select())
    assert len(rows2) == 1
    http.request.assert_not_called()
    store.close()


def test_cache_write_through(tmp_path: Path):
    http = MagicMock()
    http.request.return_value = {"id": "n1", "title": "hi"}
    store = LocalStore(str(tmp_path / "cache.db"))
    q = TableQuery(http, "catalog", policy=POLICY_CACHE, local=store)
    row = q.insert({"title": "hi"})
    assert row["id"] == "n1"
    http.request.assert_called_once()
    assert store.get("catalog", "n1") is not None
    store.close()


def test_pull_and_sync(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("PYRONITES_URL", "https://example.com")
    from pyronites import create_client

    client = create_client(
        cache_tables=["catalog"],
        local_db_path=str(tmp_path / "sync.db"),
    )
    client._http.request = MagicMock(
        return_value=[{"id": "1", "name": "a"}, {"id": "2", "name": "b"}]
    )
    n = client.pull("catalog")
    assert n == 2
    rows = list(client.table("catalog").select())
    assert len(rows) == 2
    client._http.request = MagicMock(return_value=[{"id": "3"}])
    assert client.sync("catalog") == 1
    client.close()


def test_push_rejects_local_only(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("PYRONITES_URL", "https://example.com")
    from pyronites import create_client

    client = create_client(
        local_tables=["settings"],
        local_db_path=str(tmp_path / "loc.db"),
    )
    client.table("settings").insert({"x": 1})
    with pytest.raises(ApiError) as exc:
        client.push("settings")
    assert "local-only" in str(exc.value).lower()
    client.close()
