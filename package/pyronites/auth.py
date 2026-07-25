"""Auth methods for the pyronites client."""

from __future__ import annotations

from typing import Any, Dict, Optional

from pyronites.errors import AuthError
from pyronites.http import HttpTransport


class AuthClient:
    """Client for ``/auth/*`` routes."""

    def __init__(self, transport: HttpTransport) -> None:
        self._http = transport
        self._user: Optional[Dict[str, Any]] = None

    def sign_up(self, email: str, password: str) -> Dict[str, Any]:
        """Create a new account and start a session.

        Maps to ``POST /auth/signup``.
        Returns ``{id, email, created_at}``.
        """
        data = self._http.request(
            "POST",
            "/auth/signup",
            json={"email": email, "password": password},
        )
        self._user = data
        return data  # type: ignore[return-value]

    def sign_in(self, email: str, password: str) -> Dict[str, Any]:
        """Authenticate and start a session.

        Maps to ``POST /auth/login``.
        Returns ``{email}``.
        """
        data = self._http.request(
            "POST",
            "/auth/login",
            json={"email": email, "password": password},
        )
        self._user = data
        return data  # type: ignore[return-value]

    def sign_out(self) -> None:
        """Revoke the current session.

        Maps to ``POST /auth/logout``.
        """
        try:
            self._http.request("POST", "/auth/logout")
        finally:
            self._user = None

    def user(self) -> Optional[Dict[str, Any]]:
        """Return the current user, or ``None`` if not authenticated.

        Maps to ``GET /auth/me``.
        On 401 returns ``None`` instead of raising.
        """
        try:
            data = self._http.request("GET", "/auth/me")
            self._user = data
            return data  # type: ignore[return-value]
        except AuthError:
            self._user = None
            return None
