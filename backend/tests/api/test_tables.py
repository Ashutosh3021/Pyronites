
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
    # Copy all migrations so run_pending_migrations has the full sequence
    for migration_file in sorted(real_migrations_dir.glob("*.sql")):
        shutil.copy(migration_file, temp_dir)
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


@pytest.fixture
def admin_api_key(initialized_db):
    raw_key, _ = create_api_key(
        initialized_db,
        project_id="test-project",
        name="Test Admin Key",
        scopes=["read", "write", "admin"]
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

    def test_create_empty_body_rejected(self, client, write_api_key):
        """POST with empty body must return 400, not a 500 SQL error."""
        response = client.post(
            "/tables/test_items",
            json={},
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert response.status_code == 400

    def test_patch_empty_body_rejected(self, client, write_api_key, initialized_db):
        """PATCH with empty body must return 400 before hitting SQL."""
        item_id = str(uuid.uuid4())
        initialized_db.execute(
            "INSERT INTO test_items (id, name, value) VALUES (?, ?, ?)",
            (item_id, "Item", 1)
        )
        response = client.patch(
            f"/tables/test_items/{item_id}",
            json={},
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert response.status_code == 400

    def test_create_returns_actual_db_row(self, client, write_api_key):
        """POST must return the row that was actually stored, not a fabricated dict."""
        response = client.post(
            "/tables/test_items",
            json={"name": "Real Row", "value": 7},
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert response.status_code == 200
        body = response.json()
        # The returned id must be a real UUID that exists in the DB
        assert "id" in body
        assert body["name"] == "Real Row"
        assert body["value"] == 7

        # Confirm row is actually retrievable
        get_resp = client.get(
            f"/tables/test_items/{body['id']}",
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert get_resp.status_code == 200

    def test_unauthenticated_request_returns_401(self, client):
        """Requests with no auth header must return 401."""
        response = client.get("/tables/test_items")
        assert response.status_code == 401


class TestCreateTableEndpoint:
    def test_create_table_success(self, client, admin_api_key):
        """POST /tables creates a new table."""
        response = client.post(
            "/tables",
            json={
                "table": "new_test_table",
                "columns": [
                    {"name": "id", "type": "INTEGER"},
                    {"name": "name", "type": "TEXT"},
                ],
                "primary_key": "id",
            },
            headers={"Authorization": f"Bearer {admin_api_key}"},
        )
        assert response.status_code == 200
        assert response.json()["table"] == "new_test_table"

    def test_create_table_requires_admin(self, client, write_api_key):
        """POST /tables requires admin scope."""
        response = client.post(
            "/tables",
            json={
                "table": "should_fail",
                "columns": [{"name": "id", "type": "INTEGER"}],
            },
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        assert response.status_code == 403

    def test_create_table_duplicate_name_idempotent(self, client, admin_api_key):
        """CREATE TABLE IF NOT EXISTS is idempotent."""
        payload = {
            "table": "idempotent_table",
            "columns": [{"name": "id", "type": "INTEGER"}],
        }
        r1 = client.post("/tables", json=payload, headers={"Authorization": f"Bearer {admin_api_key}"})
        r2 = client.post("/tables", json=payload, headers={"Authorization": f"Bearer {admin_api_key}"})
        assert r1.status_code == 200
        assert r2.status_code == 200


class TestDropTableEndpoint:
    def test_drop_table_success(self, client, admin_api_key):
        """DELETE /tables/{table} drops a table with confirmation."""
        client.post(
            "/tables",
            json={
                "table": "drop_me",
                "columns": [{"name": "id", "type": "INTEGER"}],
            },
            headers={"Authorization": f"Bearer {admin_api_key}"},
        )
        response = client.request(
            "DELETE",
            "/tables/drop_me",
            json={"confirm_name": "drop_me"},
            headers={"Authorization": f"Bearer {admin_api_key}"},
        )
        assert response.status_code == 200
        assert "dropped" in response.json()["message"]

    def test_drop_table_wrong_confirmation(self, client, admin_api_key):
        """DELETE /tables/{table} rejects mismatched confirmation."""
        client.post(
            "/tables",
            json={"table": "keep_me", "columns": [{"name": "id", "type": "INTEGER"}]},
            headers={"Authorization": f"Bearer {admin_api_key}"},
        )
        response = client.request(
            "DELETE",
            "/tables/keep_me",
            json={"confirm_name": "wrong_name"},
            headers={"Authorization": f"Bearer {admin_api_key}"},
        )
        assert response.status_code == 400

    def test_drop_nonexistent_table_returns_404(self, client, admin_api_key):
        response = client.request(
            "DELETE",
            "/tables/ghost_table",
            json={"confirm_name": "ghost_table"},
            headers={"Authorization": f"Bearer {admin_api_key}"},
        )
        assert response.status_code == 404

    def test_drop_table_requires_admin(self, client, write_api_key):
        """DELETE /tables/{table} requires admin scope."""
        response = client.request(
            "DELETE",
            "/tables/some_table",
            json={"confirm_name": "some_table"},
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        assert response.status_code == 403

    def test_drop_protected_table_not_in_allowed_set(self, client, admin_api_key):
        """Platform-protected tables are filtered from allowed set, so DELETE returns 404."""
        response = client.request(
            "DELETE",
            "/tables/users",
            json={"confirm_name": "users"},
            headers={"Authorization": f"Bearer {admin_api_key}"},
        )
        assert response.status_code == 404

