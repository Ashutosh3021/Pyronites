
import os
import tempfile
import shutil
from pathlib import Path
import pytest

from backend.auth.api_keys import (
    create_api_key,
    validate_api_key,
    revoke_api_key,
    ALLOWED_SCOPES,
    API_KEY_PREFIX
)
from backend.core.db import Database
from backend.core.migrations import run_pending_migrations


class TestApiKeys:
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
        # Copy all migrations so run_pending_migrations has the full sequence
        for migration_file in sorted(real_migrations_dir.glob("*.sql")):
            shutil.copy(migration_file, temp_dir)
        yield temp_dir
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def initialized_db(self, temp_db_path, temp_migrations_dir):
        db = Database(temp_db_path)
        db.connect()
        run_pending_migrations(db, temp_migrations_dir)
        yield db
        db.close()

    def test_create_and_validate_api_key_success(self, initialized_db):
        raw_key, api_key = create_api_key(
            initialized_db,
            project_id="test-project",
            name="Test Key",
            scopes=["read", "write"]
        )
        assert raw_key.startswith(API_KEY_PREFIX)
        validated = validate_api_key(initialized_db, raw_key)
        assert validated is not None
        assert validated.id == api_key.id

    def test_api_key_only_hash_stored(self, initialized_db):
        raw_key, api_key = create_api_key(
            initialized_db,
            project_id="test-project",
            name="Test Key",
            scopes=["read"]
        )
        cursor = initialized_db.execute(
            "SELECT key_hash FROM api_keys WHERE id = ?",
            (api_key.id,)
        )
        stored_hash = cursor.fetchone()[0]
        assert stored_hash != raw_key  # Raw key is NOT stored in DB
        import hashlib
        assert stored_hash == hashlib.sha256(raw_key.encode()).hexdigest()

    def test_create_api_key_invalid_scope(self, initialized_db):
        with pytest.raises(ValueError):
            create_api_key(
                initialized_db,
                project_id="test-project",
                name="Test Key",
                scopes=["read", "invalid-scope"]
            )

    def test_revoke_api_key(self, initialized_db):
        raw_key, api_key = create_api_key(
            initialized_db,
            project_id="test-project",
            name="Test Key",
            scopes=["read"]
        )
        revoke_api_key(initialized_db, api_key.id)
        validated = validate_api_key(initialized_db, raw_key)
        assert validated is None

    def test_validate_nonexistent_api_key(self, initialized_db):
        validated = validate_api_key(initialized_db, API_KEY_PREFIX + "invalid-key")
        assert validated is None

    def test_create_api_key_empty_scopes_rejected(self, initialized_db):
        """Creating a key with no scopes at all should raise ValueError."""
        with pytest.raises(ValueError):
            create_api_key(
                initialized_db,
                project_id="test-project",
                name="No Scope Key",
                scopes=[]
            )

    def test_validate_revoked_key_returns_none(self, initialized_db):
        """validate_api_key must return None immediately for revoked keys."""
        raw_key, api_key = create_api_key(
            initialized_db,
            project_id="test-project",
            name="To Revoke",
            scopes=["read"]
        )
        revoke_api_key(initialized_db, api_key.id)
        # Validate should treat it as missing
        result = validate_api_key(initialized_db, raw_key)
        assert result is None

    def test_list_api_keys_excludes_revoked(self, initialized_db):
        """list_api_keys must not include revoked keys."""
        from backend.auth.api_keys import list_api_keys
        _, key1 = create_api_key(initialized_db, "p", "Key1", ["read"])
        _, key2 = create_api_key(initialized_db, "p", "Key2", ["write"])
        revoke_api_key(initialized_db, key1.id)
        keys = list_api_keys(initialized_db)
        ids = [k.id for k in keys]
        assert key1.id not in ids
        assert key2.id in ids

    def test_raw_key_not_in_key_hash_field(self, initialized_db):
        """The key_hash field on ApiKey must never equal the raw key."""
        raw_key, api_key = create_api_key(
            initialized_db, "p", "HashCheck", ["read"]
        )
        assert api_key.key_hash != raw_key
        assert not api_key.key_hash.startswith(API_KEY_PREFIX)

