
import logging
import secrets
import string
from typing import Set

import argon2
from argon2 import PasswordHasher

# Configure logger
logger = logging.getLogger(__name__)

# Argon2 parameters chosen for security/performance balance
# Time cost: 3 passes (increases computation time, slows attackers)
# Memory cost: 65536 KiB = 64 MiB (uses more memory, makes GPU attacks harder)
# Parallelism: 4 threads (utilizes multi-core CPUs)
# These values are a reasonable default for most applications
# Adjust based on your server's hardware capabilities
PH = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
)


def hash_password(plain: str) -> str:
    """
    Hash a plaintext password using Argon2id.

    Args:
        plain: The plaintext password to hash.

    Returns:
        The hashed password string.

    Raises:
        ValueError: If the password is empty.
    """
    if not plain:
        raise ValueError("Password cannot be empty")

    try:
        return PH.hash(plain)
    except argon2.exceptions.Argon2Error as e:
        logger.error("Failed to hash password", exc_info=True)
        raise


def verify_password(plain: str, hashed: str) -> bool:
    """
    Verify a plaintext password against a previously hashed password.

    Args:
        plain: The plaintext password to verify.
        hashed: The hashed password to compare against.

    Returns:
        True if the password matches, False otherwise.
        Returns False (never raises) on malformed hashes or Argon2 errors so
        callers always get a consistent boolean result.
    """
    try:
        return PH.verify(hashed, plain)
    except argon2.exceptions.VerifyMismatchError:
        return False
    except (argon2.exceptions.InvalidHashError, argon2.exceptions.Argon2Error) as e:
        logger.error("Failed to verify password", exc_info=True)
        return False


def generate_strong_password(length: int = 20) -> str:
    """
    Generate a cryptographically secure strong password.

    Args:
        length: The length of the generated password (minimum 4).

    Returns:
        A strong password meeting complexity requirements.

    Raises:
        ValueError: If length is less than 4.
    """
    if length < 4:
        raise ValueError("Password length must be at least 4 characters")

    # Character sets
    lowercase = string.ascii_lowercase
    uppercase = string.ascii_uppercase
    digits = string.digits
    symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?"

    # Ensure at least one character from each category
    password_chars: list[str] = [
        secrets.choice(lowercase),
        secrets.choice(uppercase),
        secrets.choice(digits),
        secrets.choice(symbols),
    ]

    # Fill the rest with random characters from all categories
    all_chars = lowercase + uppercase + digits + symbols
    for _ in range(length - 4):
        password_chars.append(secrets.choice(all_chars))

    # Shuffle the password (cryptographically secure shuffle)
    shuffled = []
    while password_chars:
        idx = secrets.randbelow(len(password_chars))
        shuffled.append(password_chars.pop(idx))

    return "".join(shuffled)

