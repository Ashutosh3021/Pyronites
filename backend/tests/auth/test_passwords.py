
import re
import string
import pytest
from backend.auth.passwords import hash_password, verify_password, generate_strong_password


class TestPasswords:
    def test_hash_password_not_equal_to_plaintext(self):
        plain = "mysecretpassword123"
        hashed = hash_password(plain)
        assert hashed != plain

    def test_hash_password_salts_correctly(self):
        plain = "mysecretpassword123"
        hashed1 = hash_password(plain)
        hashed2 = hash_password(plain)
        assert hashed1 != hashed2

    def test_verify_password_correct(self):
        plain = "mysecretpassword123"
        hashed = hash_password(plain)
        assert verify_password(plain, hashed) is True

    def test_verify_password_incorrect(self):
        plain = "mysecretpassword123"
        hashed = hash_password(plain)
        assert verify_password("wrongpassword", hashed) is False

    def test_generate_strong_password_min_length(self):
        with pytest.raises(ValueError):
            generate_strong_password(3)

    def test_generate_strong_password_has_uppercase(self):
        for _ in range(10):
            password = generate_strong_password(20)
            assert any(c.isupper() for c in password)

    def test_generate_strong_password_has_lowercase(self):
        for _ in range(10):
            password = generate_strong_password(20)
            assert any(c.islower() for c in password)

    def test_generate_strong_password_has_digit(self):
        for _ in range(10):
            password = generate_strong_password(20)
            assert any(c.isdigit() for c in password)

    def test_generate_strong_password_has_symbol(self):
        symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?"
        for _ in range(10):
            password = generate_strong_password(20)
            assert any(c in symbols for c in password)

    def test_generate_strong_password_correct_length(self):
        for length in [4, 10, 20, 50]:
            password = generate_strong_password(length)
            assert len(password) == length

    def test_hash_password_empty_raises(self):
        """hash_password must reject empty strings, not silently hash them."""
        with pytest.raises(ValueError):
            hash_password("")

    def test_verify_password_empty_plain_returns_false(self):
        """Verifying an empty string against a real hash must return False."""
        hashed = hash_password("realpassword123")
        assert verify_password("", hashed) is False

    def test_verify_password_wrong_type_of_hash_returns_false(self):
        """A completely bogus hash string must return False, not raise."""
        result = verify_password("somepassword", "notahash")
        assert result is False

    def test_generate_strong_password_length_3_raises(self):
        """generate_strong_password(3) must raise ValueError."""
        with pytest.raises(ValueError):
            generate_strong_password(3)

    def test_generate_strong_password_uniqueness(self):
        """Two calls must never produce the same password."""
        passwords = {generate_strong_password(20) for _ in range(10)}
        assert len(passwords) == 10

