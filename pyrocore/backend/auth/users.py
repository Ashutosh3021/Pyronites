
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, EmailStr, Field

from pyrocore.backend.auth.passwords import hash_password, verify_password
from pyrocore.backend.core.db import Database, DatabaseError

logger = logging.getLogger(__name__)


class UserAlreadyExistsError(Exception):
    """Raised when attempting to create a user with an email that already exists."""
    pass


class User(BaseModel):
    """Internal user model with password hash (never exposed publicly)."""
    id: str
    email: str
    password_hash: str
    created_at: datetime
    is_active: bool = True


class UserPublic(BaseModel):
    """Public user model safe to return over API (no password hash)."""
    id: str
    email: EmailStr
    created_at: datetime
    is_active: bool


def create_user(db: Database, email: str, plain_password: str) -> User:
    """
    Create a new user.

    Args:
        db: Database instance to use.
        email: Email address for the new user.
        plain_password: Plaintext password for the new user.

    Returns:
        The newly created User.

    Raises:
        UserAlreadyExistsError: If a user with that email already exists.
        ValueError: If email format is invalid.
    """
    # Validate email format
    if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", email):
        raise ValueError("Invalid email format")

    # Normalize email to lowercase for case-insensitive checks
    normalized_email = email.lower()

    # Check if user already exists
    existing = get_user_by_email(db, normalized_email)
    if existing is not None:
        raise UserAlreadyExistsError(f"User with email {email} already exists")

    # Create new user
    user_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    password_hash = hash_password(plain_password)

    try:
        db.execute(
            """
        INSERT INTO users (id, email, password_hash, created_at)
        VALUES (?, ?, ?, ?)
        """,
            (user_id, normalized_email, password_hash, created_at.isoformat())
        )
    except DatabaseError as e:
        logger.error("Failed to insert user into database", exc_info=True)
        raise

    return User(
        id=user_id,
        email=normalized_email,
        password_hash=password_hash,
        created_at=created_at,
        is_active=True,
    )


def authenticate_user(db: Database, email: str, plain_password: str) -> Optional[User]:
    """
    Authenticate a user by email and password.

    Args:
        db: Database instance to use.
        email: Email address of user to authenticate.
        plain_password: Plaintext password to check.

    Returns:
        User if authentication successful, None otherwise (no info leaked about why.
    """
    try:
        normalized_email = email.lower()
        user = get_user_by_email(db, normalized_email)

        if user is None:
            return None

        if not user.is_active:
            return None

        if not verify_password(plain_password, user.password_hash):
            return None

        return user

    except Exception as e:  # Catch any exception to avoid leaking info
        logger.error("Error during user authentication", exc_info=True)
        return None


def get_user_by_id(db: Database, user_id: str) -> Optional[User]:
    """
    Retrieve user by ID.

    Args:
        db: Database instance.
        user_id: User's unique ID.

    Returns:
        User if found, None otherwise.
    """
    try:
        cursor = db.execute(
            "SELECT id, email, password_hash, created_at FROM users WHERE id = ?",
            (user_id,)
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return User(
            id=row[0],
            email=row[1],
            password_hash=row[2],
            created_at=datetime.fromisoformat(row[3]),
            is_active=True,
        )
    except DatabaseError as e:
        logger.error("Failed to get user by id", exc_info=True)
        return None


def get_user_by_email(db: Database, email: str) -> Optional[User]:
    """
    Retrieve user by email (case-insensitive).

    Args:
        db: Database instance.
        email: Email address to look up.

    Returns:
        User if found, None otherwise.
    """
    normalized_email = email.lower()
    try:
        cursor = db.execute(
            "SELECT id, email, password_hash, created_at FROM users WHERE email = ?",
            (normalized_email,)
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return User(
            id=row[0],
            email=row[1],
            password_hash=row[2],
            created_at=datetime.fromisoformat(row[3]),
            is_active=True,
        )
    except DatabaseError as e:
        logger.error("Failed to get user by email", exc_info=True)
        return None

