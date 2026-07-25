"""Unit tests for auth client (mocked HTTP)."""

from unittest.mock import MagicMock

from pyronites.auth import AuthClient
from pyronites.errors import AuthError


def test_sign_up():
    http = MagicMock()
    http.request.return_value = {
        "id": "u1",
        "email": "a@example.com",
        "created_at": "2026-01-01T00:00:00Z",
    }
    auth = AuthClient(http)
    user = auth.sign_up("a@example.com", "secret")
    assert user["email"] == "a@example.com"
    http.request.assert_called_once_with(
        "POST",
        "/auth/signup",
        json={"email": "a@example.com", "password": "secret"},
    )


def test_sign_in():
    http = MagicMock()
    http.request.return_value = {"email": "a@example.com"}
    auth = AuthClient(http)
    result = auth.sign_in("a@example.com", "secret")
    assert result["email"] == "a@example.com"


def test_sign_out():
    http = MagicMock()
    http.request.return_value = {"message": "Logged out"}
    auth = AuthClient(http)
    auth.sign_out()
    http.request.assert_called_once_with("POST", "/auth/logout")


def test_user_ok():
    http = MagicMock()
    http.request.return_value = {"authenticated": True, "email": "a@example.com"}
    auth = AuthClient(http)
    me = auth.user()
    assert me["authenticated"] is True


def test_user_unauthorized():
    http = MagicMock()
    http.request.side_effect = AuthError("Not authenticated", status_code=401)
    auth = AuthClient(http)
    assert auth.user() is None
