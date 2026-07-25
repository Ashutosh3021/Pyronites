"""Unit tests for HTTP transport error mapping and retries."""

import httpx
import pytest
from unittest.mock import MagicMock, patch

from pyronites.config import ClientConfig
from pyronites.errors import ApiError, AuthError, NotFoundError
from pyronites.http import HttpTransport


def _transport() -> HttpTransport:
    return HttpTransport(ClientConfig(url="https://example.com", key="k", timeout=5))


def test_2xx_json():
    t = _transport()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b'{"ok": true}'
    mock_resp.json.return_value = {"ok": True}
    with patch.object(t._client, "request", return_value=mock_resp):
        result = t.request("GET", "/tables/notes")
    assert result == {"ok": True}
    t.close()


def test_401_raises_auth_error():
    t = _transport()
    mock_resp = MagicMock()
    mock_resp.status_code = 401
    mock_resp.text = "unauthorized"
    mock_resp.json.return_value = {
        "detail": {"code": "unauthorized", "message": "Missing or invalid authentication"}
    }
    with patch.object(t._client, "request", return_value=mock_resp):
        with pytest.raises(AuthError) as exc:
            t.request("GET", "/tables/notes")
    assert exc.value.status_code == 401
    assert exc.value.code == "unauthorized"
    t.close()


def test_404_raises_not_found():
    t = _transport()
    mock_resp = MagicMock()
    mock_resp.status_code = 404
    mock_resp.text = "not found"
    mock_resp.json.return_value = {
        "detail": {"code": "not_found", "message": "Row not found"}
    }
    with patch.object(t._client, "request", return_value=mock_resp):
        with pytest.raises(NotFoundError) as exc:
            t.request("GET", "/tables/notes/xyz")
    assert exc.value.code == "not_found"
    t.close()


def test_500_raises_api_error():
    t = _transport()
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.text = "boom"
    mock_resp.json.return_value = {
        "detail": {"code": "internal_error", "message": "boom"}
    }
    with patch.object(t._client, "request", return_value=mock_resp):
        with pytest.raises(ApiError) as exc:
            t.request("GET", "/tables/notes")
    assert exc.value.status_code == 500
    t.close()


def test_retry_on_503_then_success():
    t = HttpTransport(
        ClientConfig(url="https://example.com", key="k", timeout=5),
        max_retries=2,
        backoff_base=0.01,
    )
    fail = MagicMock()
    fail.status_code = 503
    fail.text = "unavailable"
    fail.json.return_value = {"detail": {"code": "unavailable", "message": "busy"}}
    ok = MagicMock()
    ok.status_code = 200
    ok.content = b'{"ok": true}'
    ok.json.return_value = {"ok": True}
    with patch.object(t._client, "request", side_effect=[fail, ok]) as mock_req:
        result = t.request("GET", "/tables/notes")
    assert result == {"ok": True}
    assert mock_req.call_count == 2
    t.close()


def test_retry_exhausted_on_timeout():
    t = HttpTransport(
        ClientConfig(url="https://example.com", key="k", timeout=5),
        max_retries=1,
        backoff_base=0.01,
    )
    with patch.object(
        t._client, "request", side_effect=httpx.TimeoutException("timeout")
    ) as mock_req:
        with pytest.raises(ApiError) as exc:
            t.request("GET", "/tables/notes")
    assert "timed out" in str(exc.value).lower()
    assert mock_req.call_count == 2
    t.close()


def test_no_retry_on_404():
    t = HttpTransport(
        ClientConfig(url="https://example.com", key="k", timeout=5),
        max_retries=2,
        backoff_base=0.01,
    )
    mock_resp = MagicMock()
    mock_resp.status_code = 404
    mock_resp.text = "not found"
    mock_resp.json.return_value = {
        "detail": {"code": "not_found", "message": "Row not found"}
    }
    with patch.object(t._client, "request", return_value=mock_resp) as mock_req:
        with pytest.raises(NotFoundError):
            t.request("GET", "/tables/notes/x")
    assert mock_req.call_count == 1
    t.close()
