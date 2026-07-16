
"""
API key creation, validation, revocation, and listing.

Security notes
--------------
- Raw keys are **never** stored.  Only a SHA-256 hash is persisted.
- Raw keys are **never** logged.  Any ``logger.*`` call in this file must not
  reference ``raw_key`` or any prefix of it.
- The ``key_hash`` field on the ``ApiKey`` model is the stored hash.  It is
  returned in list/validate responses so the caller can verify the hash on
  their own, but it reveals nothing about the original key.
"""
import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from pydantic import BaseModel

from backend.core.db import Database

logger = logging.getLogger(__name__)

ALLOWED_SCOPES = {"read", "write", "admin"}
API_KEY_PREFIX = "pyro_live_"

# Maximum length for a key name — anything longer is almost certainly a bug
# or a padding attack; reject it early rather than storing arbitrary data.
_MAX_NAME_LEN = 128
_MAX_PROJECT_ID_LEN = 64


class ApiKey(BaseModel):
    id: str
    name: str
    project_id: str
    scopes: List[str]
    key_hash: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    is_revoked: bool = False


def create_api_key(
    db: Database,
    project_id: str,
    name: str,
    scopes: List[str],
) -> Tuple[str, "ApiKey"]:
    """
    Create a new API key and persist only its SHA-256 hash.

    The raw key is returned once and is not stored anywhere.  The caller is
    responsible for showing it to the user exactly once and discarding it.

    Args:
        db: Active database connection.
        project_id: Identifier of the project this key belongs to.
        name: Human-readable label (1–128 chars, stripped of whitespace).
        scopes: Non-empty list of scope strings; must be a subset of
            ``ALLOWED_SCOPES`` (``"read"``, ``"write"``, ``"admin"``).

    Returns:
        ``(raw_key, ApiKey)`` — the raw key string and its metadata record.
        The raw key is **not** stored and cannot be recovered after this call.

    Raises:
        ValueError: If ``scopes`` is empty, contains unknown values, ``name``
            is blank/too long, or ``project_id`` is too long.
    """
    # ── Input validation ───────────────────────────────────────────────────
    name = name.strip() if name else ""
    if not name:
        raise ValueError("API key name must not be blank")
    if len(name) > _MAX_NAME_LEN:
        raise ValueError(f"API key name must be {_MAX_NAME_LEN} characters or fewer")

    project_id = project_id.strip() if project_id else ""
    if not project_id:
        raise ValueError("project_id must not be blank")
    if len(project_id) > _MAX_PROJECT_ID_LEN:
        raise ValueError(f"project_id must be {_MAX_PROJECT_ID_LEN} characters or fewer")

    if not scopes:
        raise ValueError("At least one scope must be specified")
    invalid_scopes = set(scopes) - ALLOWED_SCOPES
    if invalid_scopes:
        raise ValueError(
            f"Invalid scopes: {', '.join(sorted(invalid_scopes))}. "
            f"Allowed: {', '.join(sorted(ALLOWED_SCOPES))}"
        )

    key_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    raw_key = API_KEY_PREFIX + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

    try:
        db.execute(
            """
        INSERT INTO api_keys (id, project_id, name, scopes, key_hash, created_at, is_revoked)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
            (
                key_id,
                project_id,
                name,
                ",".join(scopes),
                key_hash,
                created_at.isoformat(),
                False,
            ),
        )
    except Exception as e:
        logger.error("Failed to create API key", exc_info=True)
        raise

    api_key = ApiKey(
        id=key_id,
        name=name,
        project_id=project_id,
        scopes=scopes,
        key_hash=key_hash,
        created_at=created_at,
        is_revoked=False,
    )

    return (raw_key, api_key)


def validate_api_key(
    db: Database,
    raw_key: str,
) -> Optional["ApiKey"]:
    """
    Look up and validate an API key by its raw value.

    Hashes ``raw_key`` before any DB access so the plaintext never reaches the
    query layer.  Updates ``last_used_at`` on success as a side-effect.

    Args:
        db: Active database connection.
        raw_key: The raw ``pyro_live_…`` token from the request header.
            Empty strings and tokens with no prefix are handled gracefully
            (they simply won't match any stored hash).

    Returns:
        ``ApiKey`` metadata if the key exists and is not revoked, else ``None``.
        Returns ``None`` on any DB error rather than propagating — auth failures
        must never reveal internal state to callers.
    """
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    try:
        cursor = db.execute(
            """
        SELECT id, project_id, name, scopes, key_hash, created_at, last_used_at, is_revoked
        FROM api_keys
        WHERE key_hash = ?
        """,
            (key_hash,),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        (
            key_id,
            project_id,
            name,
            scopes_str,
            stored_key_hash,
            created_at_str,
            last_used_at_str,
            is_revoked,
        ) = row

        if bool(is_revoked):
            return None

        now = datetime.now(timezone.utc)
        # Update last_used_at
        db.execute(
            "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
            (now.isoformat(), key_id),
        )

        scopes = scopes_str.split(",") if scopes_str else []
        last_used_at = datetime.fromisoformat(last_used_at_str) if last_used_at_str else None
        created_at = datetime.fromisoformat(created_at_str)

        return ApiKey(
            id=key_id,
            name=name,
            project_id=project_id,
            scopes=scopes,
            key_hash=stored_key_hash,
            created_at=created_at,
            last_used_at=last_used_at,
            is_revoked=False,
        )

    except Exception as e:
        logger.error("Failed to validate API key", exc_info=True)
        return None


def revoke_api_key(db: Database, key_id: str) -> None:
    """
    Mark an API key as revoked so all subsequent validation calls return ``None``.

    This is a soft delete — the row stays in the DB for audit purposes but
    ``is_revoked = TRUE`` causes ``validate_api_key`` to reject it immediately.

    Args:
        db: Active database connection.
        key_id: UUID of the key to revoke.

    Raises:
        DatabaseError: Propagated if the UPDATE fails (e.g. disk full).
    """
    try:
        db.execute("UPDATE api_keys SET is_revoked = ? WHERE id = ?", (True, key_id))
    except Exception as e:
        logger.error("Failed to revoke API key", exc_info=True)
        raise


def list_api_keys(db: Database) -> List["ApiKey"]:
    """
    Return all non-revoked API keys ordered newest-first.

    Note: ``key_hash`` is included in each record so callers can verify the
    stored hash independently.  The raw key is never returned here — it is
    shown exactly once at creation time.

    Args:
        db: Active database connection.

    Returns:
        List of ``ApiKey`` objects; empty list if none exist.

    Raises:
        DatabaseError: Propagated if the SELECT fails.
    """
    try:
        cursor = db.execute(
            """
        SELECT id, project_id, name, scopes, key_hash, created_at, last_used_at, is_revoked
        FROM api_keys
        WHERE is_revoked = FALSE
        ORDER BY created_at DESC
        """
        )
        rows = cursor.fetchall()
        keys = []
        for row in rows:
            (
                key_id,
                project_id,
                name,
                scopes_str,
                stored_key_hash,
                created_at_str,
                last_used_at_str,
                is_revoked,
            ) = row
            scopes = scopes_str.split(",") if scopes_str else []
            last_used_at = datetime.fromisoformat(last_used_at_str) if last_used_at_str else None
            created_at = datetime.fromisoformat(created_at_str)
            keys.append(
                ApiKey(
                    id=key_id,
                    name=name,
                    project_id=project_id,
                    scopes=scopes,
                    key_hash=stored_key_hash,
                    created_at=created_at,
                    last_used_at=last_used_at,
                    is_revoked=bool(is_revoked),
                )
            )
        return keys
    except Exception as e:
        logger.error("Failed to list API keys", exc_info=True)
        raise

