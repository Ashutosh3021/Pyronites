"""
Shared API response models and serialisation helpers.

Centralising these here guarantees that every API module emits exactly the
same field names, the same timestamp format, and the same error envelope so
clients can rely on a predictable, uniform contract.

Timestamp convention
--------------------
All datetime fields are serialised as ISO 8601 strings **with an explicit UTC
offset** (e.g. ``"2025-07-14T10:30:00+00:00"``).  Using ``datetime.isoformat()``
on a naive datetime produces no offset, which is ambiguous.  Use
``to_utc_iso()`` from this module whenever converting a datetime to a string
for an API response.
"""

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, field_validator, model_validator
from pydantic import Field


# ---------------------------------------------------------------------------
# Timestamp helper
# ---------------------------------------------------------------------------

def to_utc_iso(dt: Optional[datetime]) -> Optional[str]:
    """
    Serialise a datetime to an ISO 8601 UTC string in the same format that
    Pydantic v2 uses for ``datetime`` fields: ``YYYY-MM-DDTHH:MM:SS.ffffffZ``.

    Using ``Z`` rather than ``+00:00`` keeps every timestamp in the API
    response body consistent, whether the value comes from a Pydantic model or
    a manually constructed dict like ``_record_to_dict``.

    Naive datetimes are assumed to already be UTC — they come from our own
    ``datetime.now(timezone.utc).isoformat()`` inserts and are never ambiguous.

    Args:
        dt: Datetime to serialise, or ``None``.

    Returns:
        A string like ``"2025-07-14T10:30:00.000000Z"``, or ``None``.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    # Replace +00:00 offset with Z to match Pydantic v2's default serialisation
    return dt.isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Error envelope — every non-2xx response body uses this shape
# ---------------------------------------------------------------------------

class ErrorResponse(BaseModel):
    """
    Uniform error envelope returned by every non-2xx API response.

    Fields
    ------
    code:
        Machine-readable short identifier, e.g. ``"not_found"``,
        ``"unauthorized"``, ``"bad_request"``.  Clients should branch on this,
        not on the HTTP status code alone.
    message:
        Human-readable explanation.  Safe to display in a UI; must not contain
        secrets or internal stack traces.
    """

    code: str
    message: str


# ---------------------------------------------------------------------------
# Request body models — used by tables and keys endpoints for validation
# ---------------------------------------------------------------------------

MAX_NAME_LEN = 128   # max length for human-readable name fields (key name, etc.)
MAX_ID_LEN = 64      # max length for identifier fields (project_id, row id, etc.)


class CreateApiKeyRequest(BaseModel):
    """
    Request body for the API-key management endpoints (create).

    Validation rules are enforced here by Pydantic so the route handler never
    receives an empty name or an absurdly long string.  (Key names are capped at
    ``MAX_NAME_LEN`` characters; scopes must be a non-empty subset of
    ``ALLOWED_SCOPES``.)
    """

    name: str = Field(
        ...,
        min_length=1,
        max_length=MAX_NAME_LEN,
        description="Human-readable label for this key.",
    )
    scopes: list[str] = Field(
        ...,
        min_length=1,
        description="At least one of: read, write, admin.",
    )

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        """Strip surrounding whitespace; reject strings that are only whitespace."""
        stripped = v.strip()
        if not stripped:
            raise ValueError("name must not be blank")
        return stripped

    @field_validator("scopes")
    @classmethod
    def scopes_not_empty(cls, v: list[str]) -> list[str]:
        """Reject empty lists and unknown scope names."""
        from backend.auth.api_keys import ALLOWED_SCOPES  # avoid circular at import time
        if not v:
            raise ValueError("at least one scope is required")
        invalid = set(v) - ALLOWED_SCOPES
        if invalid:
            raise ValueError(
                f"unknown scope(s): {', '.join(sorted(invalid))}. "
                f"Allowed: {', '.join(sorted(ALLOWED_SCOPES))}"
            )
        return v
