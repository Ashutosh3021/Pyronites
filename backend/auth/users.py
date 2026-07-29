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
    pass


class User(BaseModel):
    id: str
    email: str
    password_hash: str
    created_at: datetime
    is_active: bool = True


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    created_at: datetime
    is_active: bool


def create_user(db: Database, email: str, plain_password: str) -> User:
    if not email or not email.strip():
        raise ValueError("Email must not be empty")
    if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", email):
        raise ValueError("Invalid email format")
    if not plain_password:
        raise ValueError("Password must not be empty")

    normalized_email = email.lower()
    existing = get_user_by_email(db, normalized_email)
    if existing is not None:
        raise UserAlreadyExistsError("A user with that email already exists")

    user_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc)
    password_hash = hash_password(plain_password)

    try:
        db.execute(
            "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (user_id, normalized_email, password_hash, created_at.isoformat()),
        )
    except DatabaseError as e:
        from backend.core.db import DatabaseIntegrityError
        if isinstance(e, DatabaseIntegrityError):
            raise UserAlreadyExistsError("A user with that email already exists") from e
        logger.exception("Failed to insert user into database")
        raise

    return User(
        id=user_id,
        email=normalized_email,
        password_hash=password_hash,
        created_at=created_at,
        is_active=True,
    )


def authenticate_user(db: Database, email: str, plain_password: str) -> Optional[User]:
    try:
        user = get_user_by_email(db, email.lower())
        if user is None or not user.is_active:
            return None
        if not verify_password(plain_password, user.password_hash):
            return None
        return user
    except Exception:
        logger.exception("Error during user authentication")
        return None


def get_user_by_id(db: Database, user_id: str) -> Optional[User]:
    try:
        cursor = db.execute(
            "SELECT id, email, password_hash, created_at, is_active FROM users WHERE id = ?",
            (user_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return User(
            id=row[0],
            email=row[1],
            password_hash=row[2],
            created_at=datetime.fromisoformat(row[3]),
            is_active=bool(row[4]) if len(row) > 4 else True,
        )
    except DatabaseError:
        logger.exception("Failed to get user by id")
        raise


def get_user_by_email(db: Database, email: str) -> Optional[User]:
    try:
        cursor = db.execute(
            "SELECT id, email, password_hash, created_at, is_active FROM users WHERE email = ?",
            (email.lower(),),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return User(
            id=row[0],
            email=row[1],
            password_hash=row[2],
            created_at=datetime.fromisoformat(row[3]),
            is_active=bool(row[4]) if len(row) > 4 else True,
        )
    except DatabaseError:
        logger.exception("Failed to get user by email")
        raise


def set_user_active(db: Database, user_id: str, active: bool) -> bool:
    try:
        cursor = db.execute(
            "UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?",
            (1 if active else 0, datetime.now(timezone.utc).isoformat(), user_id),
        )
        return cursor.rowcount > 0
    except DatabaseError:
        logger.exception("Failed to set user active state")
        raise


def set_user_password(db: Database, user_id: str, plain_password: str) -> bool:
    if not plain_password or len(plain_password) < 8:
        raise ValueError("Password must be at least 8 characters")
    password_hash = hash_password(plain_password)
    try:
        cursor = db.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (password_hash, datetime.now(timezone.utc).isoformat(), user_id),
        )
        return cursor.rowcount > 0
    except DatabaseError:
        logger.exception("Failed to set user password")
        raise


def delete_user(db: Database, user_id: str) -> bool:
    try:
        cursor = db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return cursor.rowcount > 0
    except DatabaseError:
        logger.exception("Failed to delete user")
        raise
