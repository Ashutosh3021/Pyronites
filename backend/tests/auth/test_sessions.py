
import os
import tempfile
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest

from backend.auth.sessions import (
    create_session,
    validate_session,
    revoke_session,
    revoke_all_sessions_for_user
)
from backend.auth.users import create_user
from backend.core.db import Database
from backend.core.migrations import run_pending_migrations


class TestSessions:
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
        shutil.copy(real_migrations_dir / "0002_add_api_keys.sql", temp_dir)
        yield temp_dir
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def initialized_db(self, temp_db_path, temp_migrations_dir):
        db = Database(temp_db_path)
        db.connect()
        run_pending_migrations(db, temp_migrations_dir)
        yield db
        db.close()

    @pytest.fixture
    def test_user(self, initialized_db):
        return create_user(initialized_db, "test@example.com", "StrongPass123!")

    def test_create_and_validate_session_success(self, initialized_db, test_user):
        session = create_session(initialized_db, test_user.id)
        user = validate_session(initialized_db, session.token)
        assert user is not None
        assert user.id == test_user.id

    def test_validate_session_expired(self, initialized_db, test_user):
        session = create_session(initialized_db, test_user.id, expiry_days=-1)
        user = validate_session(initialized_db, session.token)
        assert user is None

    def test_expired_session_cleaned_up(self, initialized_db, test_user):
        session = create_session(initialized_db, test_user.id, expiry_days=-1)
        # First validate to trigger cleanup
        validate_session(initialized_db, session.token)
        # Check if session is deleted from DB
        import hashlib
        token_hash = hashlib.sha256(session.token.encode()).hexdigest()
        cursor = initialized_db.execute(
            "SELECT id FROM sessions WHERE token = ?",
            (token_hash,)
        )
        assert cursor.fetchone() is None

    def test_revoke_session(self, initialized_db, test_user):
        session = create_session(initialized_db, test_user.id)
        revoke_session(initialized_db, session.token)
        user = validate_session(initialized_db, session.token)
        assert user is None

    def test_revoke_all_sessions_for_user(self, initialized_db, test_user):
        session1 = create_session(initialized_db, test_user.id)
        session2 = create_session(initialized_db, test_user.id)
        revoke_all_sessions_for_user(initialized_db, test_user.id)
        assert validate_session(initialized_db, session1.token) is None
        assert validate_session(initialized_db, session2.token) is None

