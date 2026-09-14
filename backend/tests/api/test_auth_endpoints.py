"""
Tests for auth endpoints: signup, login, logout, password reset, account deletion.
"""

import os
import tempfile
import shutil
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.auth import router as auth_router
from backend.core.db import Database
from backend.core.migrations import run_pending_migrations


@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def db_path(temp_dir):
    p = temp_dir / "test.db"
    return str(p)


@pytest.fixture
def client(db_path, temp_dir):
    migrations_dir = temp_dir / "migrations"
    migrations_dir.mkdir()
    real = Path(__file__).parent.parent.parent / "migrations"
    for f in real.glob("*.sql"):
        shutil.copy(f, migrations_dir / f.name)

    db = Database(db_path)
    db.connect()
    run_pending_migrations(db, str(migrations_dir))
    db.close()

    os.environ["DATABASE_PATH"] = db_path
    app = FastAPI()
    app.include_router(auth_router)
    yield TestClient(app)


class TestSignup:
    def test_signup_success(self, client):
        r = client.post("/auth/signup", json={"email": "test@example.com", "password": "secret123"})
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == "test@example.com"
        assert "id" in body

    def test_signup_duplicate_email(self, client):
        client.post("/auth/signup", json={"email": "dup@example.com", "password": "secret123"})
        r = client.post("/auth/signup", json={"email": "dup@example.com", "password": "secret123"})
        assert r.status_code in (400, 409)

    def test_signup_weak_password_accepted(self, client):
        # Backend does not enforce minimum password length on signup
        r = client.post("/auth/signup", json={"email": "weak@example.com", "password": "123"})
        assert r.status_code == 200

    def test_signup_sets_session_cookie(self, client):
        r = client.post("/auth/signup", json={"email": "cookie@example.com", "password": "secret123"})
        assert r.status_code == 200
        assert "session_token" in client.cookies


class TestLogin:
    def test_login_success(self, client):
        client.post("/auth/signup", json={"email": "login@example.com", "password": "secret123"})
        r = client.post("/auth/login", json={"email": "login@example.com", "password": "secret123"})
        assert r.status_code == 200
        assert "session_token" in client.cookies

    def test_login_wrong_password(self, client):
        client.post("/auth/signup", json={"email": "login2@example.com", "password": "secret123"})
        r = client.post("/auth/login", json={"email": "login2@example.com", "password": "wrong"})
        assert r.status_code == 401

    def test_login_nonexistent_user(self, client):
        r = client.post("/auth/login", json={"email": "nobody@example.com", "password": "secret123"})
        assert r.status_code == 401


class TestLogout:
    def test_logout_clears_cookie(self, client):
        client.post("/auth/signup", json={"email": "logout@example.com", "password": "secret123"})
        assert "session_token" in client.cookies
        r = client.post("/auth/logout")
        assert r.status_code == 200
        # Cookie should be cleared
        assert client.cookies.get("session_token") in (None, "")


class TestPasswordReset:
    def test_forgot_password_returns_success(self, client):
        client.post("/auth/signup", json={"email": "reset@example.com", "password": "secret123"})
        r = client.post("/auth/forgot-password", json={"email": "reset@example.com"})
        assert r.status_code == 200

    def test_forgot_password_nonexistent_email_also_returns_success(self, client):
        # Should not reveal whether email exists
        r = client.post("/auth/forgot-password", json={"email": "ghost@example.com"})
        assert r.status_code == 200


class TestDeleteAccount:
    def test_delete_account_requires_auth(self, client):
        r = client.request("DELETE", "/auth/account", json={"password": "secret123"})
        assert r.status_code == 401

    def test_delete_account_wrong_password(self, client):
        client.post("/auth/signup", json={"email": "del@example.com", "password": "secret123"})
        r = client.request("DELETE", "/auth/account", json={"password": "wrongpassword"})
        assert r.status_code == 400

    def test_delete_account_success(self, client):
        client.post("/auth/signup", json={"email": "del2@example.com", "password": "secret123"})
        r = client.request("DELETE", "/auth/account", json={"password": "secret123"})
        assert r.status_code == 200
        assert r.json()["message"] == "Account deleted successfully"
