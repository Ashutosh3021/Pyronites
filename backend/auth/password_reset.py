"""
Password-reset token helpers.

Raw tokens are never stored — only SHA-256 hashes. The raw value is returned
once from ``create_reset_token`` so it can be put in the email link.
"""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from backend.core.db import Database, DatabaseError

logger = logging.getLogger(__name__)

DEFAULT_TTL_SECONDS = int(os.environ.get("PASSWORD_RESET_TTL_SECONDS", "3600"))


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_reset_token(
    db: Database,
    user_id: str,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> str:
    """
    Invalidate prior unused tokens for this user, create a new one.

    Returns:
        The raw token (show only in the email link).
    """
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=ttl_seconds)
    raw = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw)
    token_id = str(uuid.uuid4())

    try:
        # One active reset path at a time per user
        db.execute(
            "DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL",
            (user_id,),
        )
        db.execute(
            """
            INSERT INTO password_reset_tokens
                (id, user_id, token_hash, expires_at, used_at, created_at)
            VALUES (?, ?, ?, ?, NULL, ?)
            """,
            (
                token_id,
                user_id,
                token_hash,
                expires_at.isoformat(),
                now.isoformat(),
            ),
        )
    except DatabaseError:
        logger.error("Failed to create password reset token", exc_info=True)
        raise

    return raw


def consume_reset_token(db: Database, raw_token: str) -> Optional[str]:
    """
    Validate and mark a token used.

    Returns:
        user_id if valid, else None.
    """
    if not raw_token or not raw_token.strip():
        return None

    token_hash = _hash_token(raw_token.strip())
    now = datetime.now(timezone.utc)

    try:
        cur = db.execute(
            """
            SELECT id, user_id, expires_at, used_at
            FROM password_reset_tokens
            WHERE token_hash = ?
            """,
            (token_hash,),
        )
        row = cur.fetchone()
        if row is None:
            return None

        row_id, user_id, expires_at_str, used_at = row
        if used_at is not None:
            return None

        expires_at = datetime.fromisoformat(expires_at_str)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            return None

        db.execute(
            "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?",
            (now.isoformat(), row_id),
        )
        return user_id
    except DatabaseError:
        logger.error("Failed to consume password reset token", exc_info=True)
        raise
