"""Unit tests for create_client façade."""

import pytest

from pyronites import create_client, __version__
from pyronites.errors import ApiError


def test_version():
    assert isinstance(__version__, str)
    assert __version__


def test_create_client_missing_url(monkeypatch):
    monkeypatch.delenv("PYRONITES_URL", raising=False)
    with pytest.raises(ApiError):
        create_client()


def test_create_client_ok(monkeypatch):
    monkeypatch.setenv("PYRONITES_URL", "https://example.com")
    monkeypatch.setenv("PYRONITES_KEY", "test-key")
    client = create_client()
    assert client.auth is not None
    assert client.table("notes") is not None
    client.close()


def test_table_name_validation(monkeypatch):
    monkeypatch.setenv("PYRONITES_URL", "https://example.com")
    client = create_client()
    with pytest.raises(ApiError):
        client.table("")
    client.close()
