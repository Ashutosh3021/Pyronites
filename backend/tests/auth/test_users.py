
import os
import tempfile
import shutil
from pathlib import Path
import pytest
from backend.auth.users import (
    User,
    UserPublic,
    UserAlreadyExistsError,
    create_user,
    authenticate_user,
    get_user_by_id,
    get_user_by_email
)
from backend.core.db import Database
from backend.core.migrations import run_pending_migrations


class TestUsers:
    @pytest.fixture
    def temp_db_path(self):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            temp_path = f.name
        yield temp_path
        if os.path.exists(temp_path):
            os.remove(temp_path)
            wal_path = temp_path + "-wal"
            shm_path = temp_path + "-shm"
            if os.path.exists(wal_path):
                os.remove(wal_path)
            if os.path.exists(shm_path):
                os.remove(shm_path)

    @pytest.fixture
    def temp_migrations_dir(self):
        temp_dir = tempfile.mkdtemp()
        real_migrations_dir = Path(__file__).parent.parent.parent / "migrations"
        shutil.copy(real_migrations_dir / "0001_init.sql", temp_dir)
        yield temp_dir
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def initialized_db(self, temp_db_path, temp_migrations_dir):
        db = Database(temp_db_path)
        db.connect()
        run_pending_migrations(db, temp_migrations_dir)
        yield db
        db.close()

    def test_create_user_success(self, initialized_db):
        user = create_user(initialized_db, "test@example.com", "StrongPass123!")
        assert user is not None
        assert user.email == "test@example.com"
        assert user.password_hash != "StrongPass123!"

    def test_create_user_duplicate_email(self, initialized_db):
        create_user(initialized_db, "test@example.com", "StrongPass123!")
        with pytest.raises(UserAlreadyExistsError):
            create_user(initialized_db, "test@example.com", "AnotherPass456!")

    def test_create_user_duplicate_email_case_insensitive(self, initialized_db):
        create_user(initialized_db, "Test@Example.com", "StrongPass123!")
        with pytest.raises(UserAlreadyExistsError):
            create_user(initialized_db, "test@example.com", "AnotherPass456!")

    def test_create_user_invalid_email(self, initialized_db):
        with pytest.raises(ValueError):
            create_user(initialized_db, "not-an-email", "StrongPass123!")

    def test_authenticate_user_success(self, initialized_db):
        create_user(initialized_db, "test@example.com", "StrongPass123!")
        user = authenticate_user(initialized_db, "test@example.com", "StrongPass123!")
        assert user is not None
        assert user.email == "test@example.com"

    def test_authenticate_user_wrong_password(self, initialized_db):
        create_user(initialized_db, "test@example.com", "StrongPass123!")
        user = authenticate_user(initialized_db, "test@example.com", "WrongPass456!")
        assert user is None

    def test_authenticate_user_nonexistent_email(self, initialized_db):
        user = authenticate_user(initialized_db, "nonexistent@example.com", "SomePass123!")
        assert user is None

    def test_get_user_by_id(self, initialized_db):
        created_user = create_user(initialized_db, "test@example.com", "StrongPass123!")
        retrieved_user = get_user_by_id(initialized_db, created_user.id)
        assert retrieved_user is not None
        assert retrieved_user.id == created_user.id
        assert retrieved_user.email == created_user.email

    def test_get_user_by_id_nonexistent(self, initialized_db):
        retrieved_user = get_user_by_id(initialized_db, "nonexistent-id")
        assert retrieved_user is None

    def test_get_user_by_email(self, initialized_db):
        created_user = create_user(initialized_db, "test@example.com", "StrongPass123!")
        retrieved_user = get_user_by_email(initialized_db, "test@example.com")
        assert retrieved_user is not None
        assert retrieved_user.id == created_user.id

    def test_get_user_by_email_nonexistent(self, initialized_db):
        retrieved_user = get_user_by_email(initialized_db, "nonexistent@example.com")
        assert retrieved_user is None

    def test_user_public_model_no_password_hash(self):
        # Verify UserPublic doesn't even have password_hash as a field
        assert "password_hash" not in UserPublic.model_fields

