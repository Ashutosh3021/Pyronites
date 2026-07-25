"""Typed exceptions raised by the pyronites client."""

from __future__ import annotations

from typing import Any, Optional


class ApiError(Exception):
    """Base error for non-2xx API responses and client-side validation failures.

    Attributes
    ----------
    status_code:
        HTTP status when the error came from the server, else ``None``.
    code:
        Backend ``code`` string (e.g. ``"not_found"``) when present.
    message:
        Human-readable description.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        code: Optional[str] = None,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.body = body

    def __str__(self) -> str:
        parts = []
        if self.status_code is not None:
            parts.append(str(self.status_code))
        if self.code:
            parts.append(self.code)
        parts.append(self.message)
        return " ".join(parts)


class AuthError(ApiError):
    """Raised for 401 / 403 responses (or equivalent client-side auth failures)."""


class NotFoundError(ApiError):
    """Raised for 404 responses."""
