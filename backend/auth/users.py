
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, EmailStr

from backend.auth.passwords import hash_password, verify_password
from backend.core.db import Database, DatabaseError

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
    if not email or not email.strip():
        raise ValueError("Email must not be empty")
    if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", email):
        raise ValueError("Invalid email format")

    if not plain_password:
        raise ValueError("Password must not be empty")

    # Normalize email to lowercase for case-insensitive checks
    normalized_email = email.lower()

    # Check if user already exists
    existing = get_user_by_email(db, normalized_email)
    if existing is not None:
        # Do NOT include the email in the exception message — it could be
        # reflected back in an API response and aid account enumeration.
        raise UserAlreadyExistsError("A user with that email already exists")

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
        # Convert a unique constraint violation (race condition: concurrent signup
        # for the same email) into the expected UserAlreadyExistsError.
        from backend.core.db import DatabaseIntegrityError
        if isinstance(e, DatabaseIntegrityError):
            raise UserAlreadyExistsError("A user with that email already exists") from e
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
        User if found, None if no such user exists.

    Raises:
        DatabaseError: If a database error occurs (re-raised so callers can
            distinguish "not found" from "DB down").
    """
    try:
        cursor = db.execute(
            "SELECT id, email, password_hash, created_at, is_active FROM users WHERE id = ?",
            (user_id,)
        )
        row = cursor.fetchone()
        if row is None:
            return None
        # is_active is stored as INTEGER (0/1) in SQLite
        is_active = bool(row[4]) if len(row) > 4 else True
        return User(
            id=row[0],
            email=row[1],
            password_hash=row[2],
            created_at=datetime.fromisoformat(row[3]),
            is_active=is_active,
        )
    except DatabaseError as e:
        logger.error("Failed to get user by id", exc_info=True)
        raise


def get_user_by_email(db: Database, email: str) -> Optional[User]:
    """
    Retrieve user by email (case-insensitive).

    Args:
        db: Database instance.
        email: Email address to look up.

    Returns:
        User if found, None if no such user exists.

    Raises:
        DatabaseError: If a database error occurs.
    """
    normalized_email = email.lower()
    try:
        cursor = db.execute(
            "SELECT id, email, password_hash, created_at, is_active FROM users WHERE email = ?",
            (normalized_email,)
        )
        row = cursor.fetchone()
        if row is None:
            return None
        is_active = bool(row[4]) if len(row) > 4 else True
        return User(
            id=row[0],
            email=row[1],
            password_hash=row[2],
            created_at=datetime.fromisoformat(row[3]),
            is_active=is_active,
        )
    except DatabaseError as e:
        logger.error("Failed to get user by email", exc_info=True)
        raise

