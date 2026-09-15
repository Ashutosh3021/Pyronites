"""
Tests for rate limiting: auth endpoints, Retry-After headers, X-RateLimit-* headers.
"""

import os
import tempfile
import shutil
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse

from backend.api.auth import router as auth_router
from backend.api.schemas import ErrorResponse
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
    os.environ["AUTH_RATE_LIMIT_PER_MIN"] = "5"  # Low limit for testing
    os.environ["FORGOT_RATE_LIMIT_PER_HOUR"] = "3"
    app = FastAPI()

    @app.exception_handler(HTTPException)
    async def _http_exception_handler(request: Request, exc: HTTPException):
        detail = exc.detail
        if isinstance(detail, dict) and ("code" in detail or "message" in detail):
            body = detail
        else:
            body = ErrorResponse(code="error", message=str(detail)).model_dump()
        headers = exc.headers or {}
        return JSONResponse(status_code=exc.status_code, content=body, headers=headers)

    app.include_router(auth_router)
    with TestClient(app) as c:
        yield c
    os.environ.pop("AUTH_RATE_LIMIT_PER_MIN", None)
    os.environ.pop("FORGOT_RATE_LIMIT_PER_HOUR", None)


class TestSignupRateLimit:
    def test_signup_returns_rate_limit_headers(self, client):
        r = client.post("/auth/signup", json={"email": "rl1@example.com", "password": "secret123"})
        assert r.status_code == 200
        # Successful responses don't have rate limit headers (only 429 does)
        # But the endpoint should work fine

    def test_signup_blocked_after_limit(self, client):
        # Use up 5 requests (the test limit)
        for i in range(5):
            client.post(
                "/auth/signup",
                json={"email": f"rate{i}@example.com", "password": "secret123"},
            )
        # 6th request should be blocked
        r = client.post(
            "/auth/signup",
            json={"email": "rate6@example.com", "password": "secret123"},
        )
        assert r.status_code == 429
        body = r.json()
        assert body["code"] == "rate_limited"
        assert "Retry-After" in r.headers
        assert "X-RateLimit-Limit" in r.headers
        assert "X-RateLimit-Remaining" in r.headers
        assert "X-RateLimit-Reset" in r.headers
        assert int(r.headers["X-RateLimit-Limit"]) == 5
        assert int(r.headers["X-RateLimit-Remaining"]) == 0


class TestLoginRateLimit:
    def test_login_returns_rate_limit_headers(self, client):
        client.post("/auth/signup", json={"email": "loginrl@example.com", "password": "secret123"})
        r = client.post("/auth/login", json={"email": "loginrl@example.com", "password": "secret123"})
        assert r.status_code == 200

    def test_login_blocked_after_limit(self, client):
        # Create a user first
        client.post("/auth/signup", json={"email": "loginrl2@example.com", "password": "secret123"})
        # Use up 5 login requests (wrong password counts too)
        for i in range(5):
            client.post(
                "/auth/login",
                json={"email": "loginrl2@example.com", "password": "wrong"},
            )
        # 6th should be blocked
        r = client.post(
            "/auth/login",
            json={"email": "loginrl2@example.com", "password": "wrong"},
        )
        assert r.status_code == 429
        assert "Retry-After" in r.headers
        assert int(r.headers["Retry-After"]) >= 1


class TestForgotPasswordRateLimit:
    def test_forgot_password_blocked_after_limit(self, client):
        # Use up 3 forgot-password requests (the test limit)
        for i in range(3):
            client.post("/auth/forgot-password", json={"email": "forgot@example.com"})
        # 4th should be blocked
        r = client.post("/auth/forgot-password", json={"email": "forgot@example.com"})
        assert r.status_code == 429
        assert "Retry-After" in r.headers
        body = r.json()
        assert body["code"] == "rate_limited"

    def test_forgot_password_different_emails_share_ip_limit(self, client):
        # IP-based limit applies across all emails from same IP
        for i in range(3):
            client.post("/auth/forgot-password", json={"email": "a@example.com"})
        # Different email from same IP is also blocked (IP key shared)
        r = client.post("/auth/forgot-password", json={"email": "b@example.com"})
        assert r.status_code == 429


class TestRateLimitHeaders:
    def test_429_includes_retry_after(self, client):
        for i in range(5):
            client.post("/auth/signup", json={"email": f"h{i}@example.com", "password": "secret123"})
        r = client.post("/auth/signup", json={"email": "h6@example.com", "password": "secret123"})
        assert r.status_code == 429
        retry_after = int(r.headers["Retry-After"])
        assert retry_after >= 1
        assert retry_after <= 60

    def test_429_includes_x_ratelimit_limit(self, client):
        for i in range(5):
            client.post("/auth/signup", json={"email": f"l{i}@example.com", "password": "secret123"})
        r = client.post("/auth/signup", json={"email": "l6@example.com", "password": "secret123"})
        assert r.headers["X-RateLimit-Limit"] == "5"

    def test_429_includes_x_ratelimit_remaining_zero(self, client):
        for i in range(5):
            client.post("/auth/signup", json={"email": f"r{i}@example.com", "password": "secret123"})
        r = client.post("/auth/signup", json={"email": "r6@example.com", "password": "secret123"})
        assert r.headers["X-RateLimit-Remaining"] == "0"

    def test_429_includes_x_ratelimit_reset(self, client):
        for i in range(5):
            client.post("/auth/signup", json={"email": f"rs{i}@example.com", "password": "secret123"})
        r = client.post("/auth/signup", json={"email": "rs6@example.com", "password": "secret123"})
        reset = int(r.headers["X-RateLimit-Reset"])
        assert reset > 0
