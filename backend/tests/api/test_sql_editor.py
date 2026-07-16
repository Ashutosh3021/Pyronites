
import os
import tempfile
import shutil
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.sql_editor import router, get_db
from backend.core.db import Database
from backend.core.migrations import run_pending_migrations
from backend.auth.api_keys import create_api_key


@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def db_path(temp_dir):
    p = temp_dir / "project.db"
    os.environ["DATABASE_PATH"] = str(p)
    os.environ["STORAGE_ROOT"] = str(temp_dir / "storage")
    yield str(p)


@pytest.fixture
def client(db_path, temp_dir):
    # Point backups next to the db the same way the CLI `start` does.
    migrations_dir = temp_dir / "migrations"
    migrations_dir.mkdir()
    real = Path(__file__).parent.parent.parent / "migrations"
    for f in real.glob("*.sql"):
        shutil.copy(f, migrations_dir / f.name)

    db = Database(db_path)
    db.connect()
    run_pending_migrations(db, str(migrations_dir))
    db.execute("CREATE TABLE things (id TEXT PRIMARY KEY, name TEXT)")
    db.close()

    app = FastAPI()
    app.include_router(router)

    # Seed API keys bound to the same database file.
    def make_client():
        return TestClient(app)

    yield make_client
    db.close()


def _seed_key(db_path, scopes):
    db = Database(db_path)
    db.connect()
    raw, _ = create_api_key(db, "test", "key", scopes)
    db.close()
    return raw


def test_read_query_returns_rows(client, db_path):
    admin_key = _seed_key(db_path, ["admin"])
    c = client()
    c.headers.update({"Authorization": f"Bearer {admin_key}"})
    r = c.post("/sql/execute", json={"sql": "SELECT * FROM things"})
    assert r.status_code == 200
    body = r.json()
    assert body["backup"]["taken"] is False
    assert body["results"][0]["kind"] == "select"
    assert body["results"][0]["columns"] == ["id", "name"]


def test_write_query_triggers_auto_backup(client, db_path, temp_dir):
    admin_key = _seed_key(db_path, ["admin"])
    c = client()
    c.headers.update({"Authorization": f"Bearer {admin_key}"})
    r = c.post(
        "/sql/execute",
        json={"sql": "INSERT INTO things (id, name) VALUES ('1', 'a')"},
    )
    assert r.status_code == 200
    body = r.json()
    # Destructive write must have backed up the live database.
    assert body["backup"]["taken"] is True
    assert Path(body["backup"]["path"]).exists()
    # Backup lands in the `backups/` sibling of the db file.
    assert str(temp_dir / "backups") in body["backup"]["path"]
    assert body["results"][0]["kind"] == "write"
    assert body["results"][0]["changes"] == 1


def test_drop_triggers_auto_backup(client, db_path):
    admin_key = _seed_key(db_path, ["admin"])
    c = client()
    c.headers.update({"Authorization": f"Bearer {admin_key}"})
    r = c.post("/sql/execute", json={"sql": "DROP TABLE things"})
    assert r.status_code == 200
    assert r.json()["backup"]["taken"] is True


def test_non_admin_key_is_forbidden(client, db_path):
    read_key = _seed_key(db_path, ["read", "write"])
    c = client()
    c.headers.update({"Authorization": f"Bearer {read_key}"})
    r = c.post("/sql/execute", json={"sql": "SELECT 1"})
    # SQL editor requires the `admin` scope.
    assert r.status_code == 403


def test_sql_error_returns_400(client, db_path):
    admin_key = _seed_key(db_path, ["admin"])
    c = client()
    c.headers.update({"Authorization": f"Bearer {admin_key}"})
    r = c.post("/sql/execute", json={"sql": "SELECT * FROM no_such_table"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "sql_error"


def test_semicolon_inside_string_literal_not_split(client, db_path):
    admin_key = _seed_key(db_path, ["admin"])
    c = client()
    c.headers.update({"Authorization": f"Bearer {admin_key}"})
    # The ';' inside the literal must not create a bogus second statement.
    r = c.post(
        "/sql/execute",
        json={"sql": "INSERT INTO things (id, name) VALUES ('x', 'a;b')"},
    )
    assert r.status_code == 200
    assert len(r.json()["results"]) == 1
