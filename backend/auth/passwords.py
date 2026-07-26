import logging
import secrets
import string

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

# Official argon2-cffi encoded hashes always start with one of these prefixes.
_ARGON2_PREFIXES = ("$argon2id$", "$argon2i$", "$argon2d$")


def is_argon2_hash(value: str) -> bool:
    """
    Return True if ``value`` looks like an argon2-cffi encoded hash.

    Used to refuse authentication against accidental plaintext rows (e.g.
    inserted via the SQL editor) and to assert that ``create_user`` never
    stores the raw password.
    """
    if not value or not isinstance(value, str):
        return False
    return value.startswith(_ARGON2_PREFIXES)


def hash_password(plain: str) -> str:
    """
    Hash a plaintext password using Argon2id.

    Args:
        plain: The plaintext password to hash.

    Returns:
        The hashed password string (always starts with ``$argon2id$``).

    Raises:
        ValueError: If the password is empty.
    """
    if not plain:
        raise ValueError("Password cannot be empty")

    try:
        hashed = PH.hash(plain)
    except argon2.exceptions.Argon2Error:
        logger.error("Failed to hash password", exc_info=True)
        raise

    # Defensive: never return something that could be confused with plaintext.
    if not is_argon2_hash(hashed):
        raise RuntimeError("hash_password produced a non-Argon2 result")
    return hashed


def verify_password(plain: str, hashed: str) -> bool:
    """
    Verify a plaintext password against a previously hashed password.

    Args:
        plain: The plaintext password to verify.
        hashed: The hashed password to compare against.

    Returns:
        True if the password matches, False otherwise.
        Returns False (never raises) on malformed hashes, plaintext-looking
        stored values, or Argon2 errors so callers always get a consistent
        boolean result.
    """
    # Reject anything that is not an Argon2 encoded hash.  This blocks login
    # against rows where a plaintext password was inserted outside the normal
    # signup path (e.g. raw SQL).
    if not is_argon2_hash(hashed):
        logger.warning(
            "verify_password: stored value is not an Argon2 hash; refusing auth"
        )
        return False

    try:
        return PH.verify(hashed, plain)
    except argon2.exceptions.VerifyMismatchError:
        return False
    except (argon2.exceptions.InvalidHashError, argon2.exceptions.Argon2Error):
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
