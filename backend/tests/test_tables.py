
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

    from fastapi import Request, HTTPException
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse
    from backend.api.schemas import ErrorResponse

    app = FastAPI()
    app.include_router(router)

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(request: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(p) for p in first.get("loc", []))
        message = first.get("msg", "Request validation failed")
        if loc:
            message = f"{loc}: {message}"
        return JSONResponse(
            status_code=422,
            content=ErrorResponse(code="validation_error", message=message).model_dump(),
        )

    @app.exception_handler(HTTPException)
    async def _http_exception_handler(request: Request, exc: HTTPException):
        detail = exc.detail
        if isinstance(detail, dict) and ("code" in detail or "message" in detail):
            body = detail
        else:
            body = ErrorResponse(code="error", message=str(detail)).model_dump()
        return JSONResponse(status_code=exc.status_code, content=body)

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
        body = response.json()
        assert body.get("code") == "table_not_found"
        assert "message" in body
        assert "nonexistent_table" in body["message"]
        assert "detail" not in body  # standardized envelope, not FastAPI wrapper

    def test_unknown_column_returns_column_not_found(self, client, write_api_key, initialized_db):
        # insert ok row first
        item_id = str(uuid.uuid4())
        client.post(
            "/tables/test_items",
            json={"id": item_id, "name": "x", "value": 1},
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        # PATCH with unknown column
        response = client.patch(
            f"/tables/test_items/{item_id}",
            json={"not_a_real_column": "oops"},
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        assert response.status_code == 404
        body = response.json()
        assert body.get("code") == "column_not_found"
        assert "not_a_real_column" in body.get("message", "")
        assert "detail" not in body

    def test_unknown_filter_column_returns_column_not_found(self, client, write_api_key):
        response = client.get(
            "/tables/test_items",
            params={"filter_column": "nope_col", "filter_value": "1"},
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        assert response.status_code == 404
        body = response.json()
        assert body.get("code") == "column_not_found"
        assert "nope_col" in body.get("message", "")

    def test_table_vs_column_error_codes_differ(self, client, write_api_key):
        t = client.get(
            "/tables/missing_tbl",
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        c = client.get(
            "/tables/test_items",
            params={"filter_column": "missing_col", "filter_value": "x"},
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        assert t.status_code == 404 and c.status_code == 404
        assert t.json()["code"] == "table_not_found"
        assert c.json()["code"] == "column_not_found"
        assert t.json()["code"] != c.json()["code"]

    def test_error_shape_unauthorized(self, client):
        response = client.get("/tables/test_items")
        assert response.status_code == 401
        body = response.json()
        assert set(body.keys()) >= {"code", "message"}
        assert body["code"] == "unauthorized"
        assert "detail" not in body

    def test_malicious_table_name_rejected(self, client, write_api_key):
        response = client.get(
            "/tables/test_items; DROP TABLE users --",
            headers={"Authorization": f"Bearer {write_api_key}"}
        )
        assert response.status_code == 404
        body = response.json()
        assert body.get("code") == "table_not_found"

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



    def test_json_column_accepts_object_on_create_and_returns_object(
        self, client, write_api_key, initialized_db
    ):
        initialized_db.execute(
            "CREATE TABLE json_docs (id TEXT PRIMARY KEY, meta JSON, title TEXT)"
        )
        payload = {
            "id": str(uuid.uuid4()),
            "title": "hello",
            "meta": {"tags": ["a", "b"], "n": 1},
        }
        resp = client.post(
            "/tables/json_docs",
            json=payload,
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert isinstance(body["meta"], dict)
        assert body["meta"]["tags"] == ["a", "b"]
        assert body["meta"]["n"] == 1

        get_resp = client.get(
            f"/tables/json_docs/{payload['id']}",
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        assert get_resp.status_code == 200
        assert get_resp.json()["meta"] == payload["meta"]

    def test_json_column_accepts_list_on_patch(self, client, write_api_key, initialized_db):
        initialized_db.execute(
            "CREATE TABLE json_lists (id TEXT PRIMARY KEY, items JSON)"
        )
        item_id = str(uuid.uuid4())
        create = client.post(
            "/tables/json_lists",
            json={"id": item_id, "items": [1, 2]},
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        assert create.status_code == 200, create.text
        assert create.json()["items"] == [1, 2]

        patch = client.patch(
            f"/tables/json_lists/{item_id}",
            json={"items": ["x", {"y": 3}]},
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        assert patch.status_code == 200, patch.text
        assert patch.json()["items"] == ["x", {"y": 3}]

    def test_object_on_text_column_returns_400_not_500(
        self, client, write_api_key, initialized_db
    ):
        # test_items.name is TEXT — nested object must not become a bare 500
        item_id = str(uuid.uuid4())
        resp = client.post(
            "/tables/test_items",
            json={"id": item_id, "name": {"nested": True}, "value": 1},
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        assert resp.status_code == 400, resp.text
        body = resp.json()
        assert body.get("code") == "invalid_value"
        assert "name" in body.get("message", "")
        assert "detail" not in body

    def test_invalid_json_string_on_json_column_returns_400(
        self, client, write_api_key, initialized_db
    ):
        initialized_db.execute(
            "CREATE TABLE json_strict (id TEXT PRIMARY KEY, payload JSON)"
        )
        resp = client.post(
            "/tables/json_strict",
            json={"id": str(uuid.uuid4()), "payload": "{not-json"},
            headers={"Authorization": f"Bearer {write_api_key}"},
        )
        assert resp.status_code == 400, resp.text
        body = resp.json()
        assert body.get("code") == "invalid_json"
        assert "payload" in body.get("message", "")
