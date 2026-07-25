"""Unit tests for config resolution."""

import pytest

from pyronites.config import load_config
from pyronites.errors import ApiError


def test_explicit_args(monkeypatch):
    monkeypatch.delenv("PYRONITES_URL", raising=False)
    monkeypatch.delenv("PYRONITES_KEY", raising=False)
    cfg = load_config(url="https://example.com/", key="k1", timeout=10)
    assert cfg.url == "https://example.com"
    assert cfg.key == "k1"
    assert cfg.timeout == 10


def test_env_fallback(monkeypatch):
    monkeypatch.setenv("PYRONITES_URL", "https://env.example.com")
    monkeypatch.setenv("PYRONITES_KEY", "env-key")
    cfg = load_config()
    assert cfg.url == "https://env.example.com"
    assert cfg.key == "env-key"


def test_args_override_env(monkeypatch):
    monkeypatch.setenv("PYRONITES_URL", "https://env.example.com")
    monkeypatch.setenv("PYRONITES_KEY", "env-key")
    cfg = load_config(url="https://arg.example.com", key="arg-key")
    assert cfg.url == "https://arg.example.com"
    assert cfg.key == "arg-key"


def test_missing_url_raises(monkeypatch):
    monkeypatch.delenv("PYRONITES_URL", raising=False)
    with pytest.raises(ApiError) as exc:
        load_config()
    assert "PYRONITES_URL" in str(exc.value)
