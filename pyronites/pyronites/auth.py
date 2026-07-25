"""Auth methods for the pyronites client."""

from __future__ import annotations

from typing import Any, Dict, Optional

from pyronites.errors import AuthError
from pyronites.http import HttpTransport


class AuthClient:
    def __init__(self, transport: HttpTransport) -> None:
        self._http = transport
        self._user: Optional[Dict[str, Any]] = None

    def sign_up(self, email: str, password: str) -> Dict[str, Any]:
        data = self._http.request(
            "POST", "/auth/signup",
            json={"email": email, "password": password},
        )
        self._user = data
        return data  # type: ignore[return-value]

    def sign_in(self, email: str, password: str) -> Dict[str, Any]:
        data = self._http.request(
            "POST", "/auth/login",
            json={"email": email, "password": password},
        )
        self._user = data
        return data  # type: ignore[return-value]

    def sign_out(self) -> None:
        try:
            self._http.request("POST", "/auth/logout")
        finally:
            self._user = None

    def user(self) -> Optional[Dict[str, Any]]:
        try:
            data = self._http.request("GET", "/auth/me")
            self._user = data
            return data  # type: ignore[return-value]
        except AuthError:
            self._user = None
            return None
