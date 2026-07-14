
"""
IMPORTANT: Never log raw session tokens in this file or anywhere else!
These are sensitive secrets and must never appear in log files or error messages.
"""
import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from pydantic import BaseModel

from backend.auth.users import User, get_user_by_id
from backend.core.db import Database

logger = logging.getLogger(__name__)

DEFAULT_SESSION_EXPIRY_DAYS = 7


class Session(BaseModel):
    id: str
    user_id: str
    token: str
    expires_at: datetime
    created_at: datetime


def create_session(
    db: Database,
    user_id: str,
    expiry_days: int = DEFAULT_SESSION_EXPIRY_DAYS,
) -> Session:
    """
    Create a new session for a user.

    Args:
        db: Database instance to use.
        user_id: ID of user to create session for.
        expiry_days: Number of days until session expires (default 7).

    Returns:
        The newly created Session with the raw token (only time it's available).
    """
    session_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    expires_at = created_at + timedelta(days=expiry_days)
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    try:
        db.execute(
            """
        INSERT INTO sessions (id, user_id, token, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
            (session_id, user_id, token_hash, expires_at.isoformat(), created_at.isoformat())
        )
    except Exception as e:
        logger.error("Failed to create session", exc_info=True)
        raise

    return Session(
        id=session_id,
        user_id=user_id,
        token=raw_token,
        expires_at=expires_at,
        created_at=created_at,
    )


def validate_session(db: Database, token: str) -> Optional[User]:
    """
    Validate a session token and return the associated user if valid.

    NOTE: This function has a side effect: it deletes any expired sessions it finds
    during lookup (lazy cleanup).

    Args:
        db: Database instance to use.
        token: Session token to validate.

    Returns:
        User if session is valid, None otherwise.
    """
    import hashlib
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    try:
        cursor = db.execute(
            "SELECT id, user_id, expires_at FROM sessions WHERE token = ?",
            (token_hash,)
        )
        row = cursor.fetchone()
        if row is None:
            return None

        session_id, user_id, expires_at_str = row
        expires_at = datetime.fromisoformat(expires_at_str)
        now = datetime.now(timezone.utc)

        if expires_at < now:
            # Lazy cleanup: delete expired session
            try:
                db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            except Exception as e:
                logger.error("Failed to delete expired session", exc_info=True)
            return None

        return get_user_by_id(db, user_id)

    except Exception as e:
        logger.error("Failed to validate session", exc_info=True)
        return None


def revoke_session(db: Database, token: str) -> None:
    """
    Revoke a session token, immediately invalidating it.

    Args:
        db: Database instance to use.
        token: Session token to revoke.
    """
    import hashlib
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    try:
        db.execute("DELETE FROM sessions WHERE token = ?", (token_hash,))
    except Exception as e:
        logger.error("Failed to revoke session", exc_info=True)
        raise


def revoke_all_sessions_for_user(db: Database, user_id: str) -> None:
    """
    Revoke all sessions for a given user (log out everywhere).

    Args:
        db: Database instance to use.
        user_id: ID of user whose sessions to revoke.
    """
    try:
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    except Exception as e:
        logger.error("Failed to revoke all sessions for user", exc_info=True)
        raise

