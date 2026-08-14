"""Auth methods for the pyronites client."""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

from pyronites.errors import AuthError
from pyronites.http import HttpTransport


class AuthClient:
    def __init__(self, transport: HttpTransport) -> None:
        self._http = transport
        self._user: Optional[Dict[str, Any]] = None
        self._user_ts: float = 0.0
        self._USER_TTL = 30.0

    def sign_up(self, email: str, password: str) -> Dict[str, Any]:
        data = self._http.request(
            "POST", "/auth/signup",
            json={"email": email, "password": password},
        )
        self._user = data
        self._user_ts = time.monotonic()
        return data  # type: ignore[return-value]

    def sign_in(self, email: str, password: str) -> Dict[str, Any]:
        data = self._http.request(
            "POST", "/auth/login",
            json={"email": email, "password": password},
        )
        self._user = data
        self._user_ts = time.monotonic()
        return data  # type: ignore[return-value]

    def sign_out(self) -> None:
        try:
            self._http.request("POST", "/auth/logout")
        finally:
            self._user = None
            self._user_ts = 0.0

    def user(self) -> Optional[Dict[str, Any]]:
        if self._user is not None and (time.monotonic() - self._user_ts) < self._USER_TTL:
            return self._user
        try:
            data = self._http.request("GET", "/auth/me")
            self._user = data
            self._user_ts = time.monotonic()
            return data  # type: ignore[return-value]
        except AuthError:
            self._user = None
            self._user_ts = 0.0
            return None
