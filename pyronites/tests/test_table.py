"""Unit tests for table fluent API (mocked HTTP)."""

from unittest.mock import MagicMock

import pytest

from pyronites.errors import ApiError
from pyronites.table import TableQuery


def _make_query(mock_http: MagicMock) -> TableQuery:
    return TableQuery(mock_http, "notes")


def test_insert_one():
    http = MagicMock()
    http.request.return_value = {"id": "1", "title": "hi"}
    q = _make_query(http)
    result = q.insert({"title": "hi"})
    assert result == {"id": "1", "title": "hi"}
    http.request.assert_called_once_with(
        "POST", "/tables/notes", json={"title": "hi"}
    )


def test_insert_many():
    http = MagicMock()
    http.request.side_effect = [
        {"id": "1", "title": "a"},
        {"id": "2", "title": "b"},
    ]
    q = _make_query(http)
    result = q.insert([{"title": "a"}, {"title": "b"}])
    assert len(result) == 2


def test_select_basic():
    http = MagicMock()
    http.request.return_value = [{"id": "1"}]
    q = _make_query(http)
    rows = list(q.select())
    assert rows == [{"id": "1"}]


def test_select_with_eq_limit():
    http = MagicMock()
    http.request.return_value = []
    q = _make_query(http)
    list(q.select().eq("title", "x").limit(5).offset(10))
    args, kwargs = http.request.call_args
    assert args[0] == "GET"
    assert kwargs["params"]["filter_column"] == "title"
    assert kwargs["params"]["filter_value"] == "x"
    assert kwargs["params"]["limit"] == 5
    assert kwargs["params"]["offset"] == 10


def test_update_requires_id():
    http = MagicMock()
    q = _make_query(http)
    with pytest.raises(ApiError) as exc:
        q.update({"title": "x"}).execute()
    assert "id" in str(exc.value).lower()


def test_update_by_id():
    http = MagicMock()
    http.request.return_value = {"id": "abc", "title": "x"}
    q = _make_query(http)
    result = q.update({"title": "x"}).eq("id", "abc")
    assert result["title"] == "x"
    http.request.assert_called_once_with(
        "PATCH", "/tables/notes/abc", json={"title": "x"}
    )


def test_delete_by_id():
    http = MagicMock()
    http.request.return_value = {"message": "Row deleted"}
    q = _make_query(http)
    result = q.delete().eq("id", "abc")
    assert result["message"] == "Row deleted"
    http.request.assert_called_once_with("DELETE", "/tables/notes/abc")


def test_get_by_id():
    http = MagicMock()
    http.request.return_value = {"id": "abc", "title": "hi"}
    q = _make_query(http)
    row = q.get("abc")
    assert row["id"] == "abc"
    http.request.assert_called_once_with("GET", "/tables/notes/abc")


def test_schema():
    http = MagicMock()
    http.request.return_value = [{"name": "id", "type": "TEXT", "pk": True}]
    q = _make_query(http)
    cols = q.schema()
    assert cols[0]["name"] == "id"
    http.request.assert_called_once_with("GET", "/tables/notes/schema")
