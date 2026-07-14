
import os
import tempfile
import shutil
import uuid
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.tables import router, get_db
from backend.auth.api_keys import create_api_key
from backend.auth.users import create_user
from backend.core.db import Database
from backend.core.migrations import run_pending_migrations


@pytest.fixture
def temp_db_path():
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
def temp_migrations_dir():
    temp_dir = tempfile.mkdtemp()
    real_migrations_dir = Path(__file__).parent.parent.parent / "migrations"
    shutil.copy(real_migrations_dir / "0001_init.sql", temp_dir)
    shutil.copy(real_migrations_dir / "0002_add_api_keys.sql", temp_dir)
    yield temp_dir
    shutil.rmtree(temp_dir)


@pytest.fixture
def initialized_db(temp_db_path, temp_migrations_dir):
    db = Database(temp_db_path)
    db.connect()
    run_pending_migrations(db, temp_migrations_dir)
    # Create a test table
    db.execute(
        """
        CREATE TABLE test_items (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            value INTEGER
        )
        """
    )
    yield db
    db.close()


@pytest.fixture
def client(initialized_db, temp_db_path):
    # Set environment variable for the test DB path
    original_db_path = os.environ.get("DATABASE_PATH")
    os.environ["DATABASE_PATH"] = temp_db_path

    app = FastAPI()
    app.include_router(router)

    # Override get_db dependency to use our test DB
    def override_get_db():
        try:
            yield initialized_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)

    # Restore original environment variable
    if original_db_path:
        os.environ["DATABASE_PATH"] = original_db_path
    else:
        del os.environ["DATABASE_PATH"]


@pytest.fixture
def read_api_key(initialized_db):
    raw_key, _ = create_api_key(
        initialized_db,
        project_id="test-project",
        name="Test Read Key",
        scopes=["read"]
    )
    return raw_key


@pytest.fixture
def write_api_key(initialized_db):
    raw_key, _ = create_api_key(
        initialized_db,
        project_id="test-project",
        name="Test Write Key",
        scopes=["read", "write"]
    )
    return raw_key


class TestTablesApi:
    def test_crud_workflow(self, client, write_api_key, initialized_db):
        # Create an item
        item_id = str(uuid.uuid4())
        create_response = client.post(
            "/tables/test_items",
            json={"id": item_id, "name": "Test Item", "value": 42},
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert create_response.status_code == 200
        assert create_response.json()["name"] == "Test Item"

        # Get the item
        get_response = client.get(
            f"/tables/test_items/{item_id}",
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert get_response.status_code == 200
        assert get_response.json()["value"] == 42

        # Update the item
        update_response = client.patch(
            f"/tables/test_items/{item_id}",
            json={"value": 99},
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert update_response.status_code == 200
        assert update_response.json()["value"] == 99

        # List items
        list_response = client.get(
            "/tables/test_items",
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert list_response.status_code == 200
        assert len(list_response.json()) == 1

        # Delete item
        delete_response = client.delete(
            f"/tables/test_items/{item_id}",
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert delete_response.status_code == 200

        # Verify it's deleted
        get_after_delete = client.get(
            f"/tables/test_items/{item_id}",
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert get_after_delete.status_code == 404

    def test_nonexistent_table_returns_404(self, client, write_api_key):
        response = client.get(
            "/tables/nonexistent_table",
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert response.status_code == 404

    def test_malicious_table_name_rejected(self, client, write_api_key):
        response = client.get(
            "/tables/test_items; DROP TABLE users --",
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert response.status_code == 404

    def test_read_only_key_rejected_on_write(self, client, read_api_key):
        item_id = str(uuid.uuid4())
        response = client.post(
            "/tables/test_items",
            json={"id": item_id, "name": "Test Item"},
            headers={"Authorization": f"Bearer {read_api_key}"}
        )
        assert response.status_code == 403

    def test_pagination_limit_enforced(self, client, write_api_key, initialized_db):
        # Create 150 test items
        for i in range(150):
            item_id = str(uuid.uuid4())
            initialized_db.execute(
                "INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)",
                (item_id, f"Item {i}", i)
            )

        response = client.get(
            "/tables/test_items?limit=100",
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert response.status_code == 200
        assert len(response.json()) == 100

        # Try limit > 200
        too_big_response = client.get(
            "/tables/test_items?limit=300",
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert too_big_response.status_code == 422  # Validation error, not 200

