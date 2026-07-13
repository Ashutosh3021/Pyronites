
"""
IMPORTANT: Never log raw API keys in this file or anywhere else!
These are sensitive secrets and must never appear in log files or error messages.
"""
import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from pydantic import BaseModel

from pyrocore.backend.auth.passwords import hash_password, verify_password
from pyrocore.backend.core.db import Database

logger = logging.getLogger(__name__)

ALLOWED_SCOPES = {"read", "write", "admin"}
API_KEY_PREFIX = "pyro_live_"


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
) -> Tuple[str, ApiKey]:
    """
    Create a new API key.

    Args:
        db: Database instance to use.
        project_id: Project ID to associate the key with.
        name: Human-readable name for the API key.
        scopes: List of scopes to grant (must be subset of ALLOWED_SCOPES).

    Returns:
        Tuple of (raw_api_key, ApiKey model). Raw key only available once at creation!

    Raises:
        ValueError: If any scope is not in ALLOWED_SCOPES.
    """
    # Validate scopes
    invalid_scopes = set(scopes) - ALLOWED_SCOPES
    if invalid_scopes:
        raise ValueError(f"Invalid scopes: {', '.join(invalid_scopes)}. Allowed: {', '.join(ALLOWED_SCOPES)}")

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
) -> Optional[ApiKey]:
    """
    Validate an API key and return it if valid.

    Args:
        db: Database instance to use.
        raw_key: Raw API key to validate.

    Returns:
        ApiKey if valid, None otherwise.
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
    Revoke an API key, immediately invalidating it.

    Args:
        db: Database instance to use.
        key_id: ID of API key to revoke.
    """
    try:
        db.execute("UPDATE api_keys SET is_revoked = ? WHERE id = ?", (True, key_id))
    except Exception as e:
        logger.error("Failed to revoke API key", exc_info=True)
        raise

