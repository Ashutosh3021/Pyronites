"""Unit tests for error types."""

from pyronites.errors import ApiError, AuthError, NotFoundError


def test_api_error_str():
    e = ApiError("boom", status_code=500, code="internal_error")
    assert "500" in str(e)
    assert "internal_error" in str(e)
    assert "boom" in str(e)


def test_hierarchy():
    assert issubclass(AuthError, ApiError)
    assert issubclass(NotFoundError, ApiError)
