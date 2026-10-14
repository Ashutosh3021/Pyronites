"""
Tests for the OAuth HTTP surface: provider catalogue, start redirect, and the
callback's failure paths plus the mocked happy paths.
"""

import os
import shutil
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.oauth import router as oauth_router
from backend.core.db import Database
from backend.core.migrations import run_pending_migrations

CALLBACK_URI = "https://api.test/auth/oauth/google/callback"

PROFILE = {
    "provider_user_id": "google-123",
    "email": "user@example.com",
    "email_verified": True,
    "display_name": "Test User",
    "avatar_url": None,
}


@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def env(temp_dir):
    """A migrated database plus a TestClient that reads the same file.

    The handle is closed on teardown — Windows cannot remove a temp directory
    that still has an open SQLite file in it.
    """
    migrations_dir = temp_dir / "migrations"
    migrations_dir.mkdir()
    real = Path(__file__).parent.parent.parent / "migrations"
    for f in real.glob("*.sql"):
        shutil.copy(f, migrations_dir / f.name)

    db_path = str(temp_dir / "test.db")
    seed = Database(db_path)
    seed.connect()
    run_pending_migrations(seed, str(migrations_dir))
    seed.close()

    os.environ["DATABASE_PATH"] = db_path
    os.environ["OAUTH_REDIRECT_BASE_URL"] = "https://api.test"
    os.environ["FRONTEND_ORIGIN"] = "https://dashboard.test"

    app = FastAPI()
    app.include_router(oauth_router)

    db = Database(db_path)
    db.connect()
    yield SimpleNamespace(
        client=TestClient(app, follow_redirects=False),
        db=db,
    )
    db.close()


@pytest.fixture
def client(env):
    return env.client


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "csec")


@pytest.fixture
def upstream(monkeypatch):
    """Replace the two network calls with fixed values."""
    from backend.auth import oauth as oauthmod

    monkeypatch.setattr(
        oauthmod, "exchange_code_for_token", lambda p, c, r: "access-token"
    )
    monkeypatch.setattr(oauthmod, "fetch_profile", lambda p, t: dict(PROFILE))
    return oauthmod


def _mint_state(env, provider="google"):
    from backend.auth import oauth as oauthmod

    return oauthmod.create_oauth_state(env.db, provider, CALLBACK_URI)


class TestProvidersCatalogue:
    def test_lists_all_providers_with_config_state(self, client, configured):
        body = client.get("/auth/oauth/providers").json()

        ids = {p["id"] for p in body["providers"]}
        assert ids == {"google", "github"}

        google = next(p for p in body["providers"] if p["id"] == "google")
        github = next(p for p in body["providers"] if p["id"] == "github")
        assert google["configured"] is True
        assert github["configured"] is False

    def test_catalogue_never_exposes_credentials(self, client, configured):
        raw = client.get("/auth/oauth/providers").text
        assert "csec" not in raw


class TestStart:
    def test_redirects_to_the_provider_with_state(self, client, configured):
        res = client.get("/auth/oauth/google/start", follow_redirects=False)

        assert res.status_code == 302
        location = res.headers["location"]
        assert location.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
        assert "state=" in location
        assert "redirect_uri=https%3A%2F%2Fapi.test%2Fauth%2Foauth%2Fgoogle%2Fcallback" in location

    def test_unknown_provider_is_404(self, client):
        res = client.get("/auth/oauth/facebook/start")
        assert res.status_code == 404
        assert res.json()["detail"]["code"] == "unknown_provider"

    def test_unconfigured_provider_is_503_not_a_broken_redirect(self, client):
        # github has no credentials in this environment.
        res = client.get("/auth/oauth/github/start")
        assert res.status_code == 503
        assert res.json()["detail"]["code"] == "provider_not_configured"
        assert "client id" in res.json()["detail"]["message"]


class TestRedirectBaseHonoursProxyTls:
    """uvicorn runs with proxy_headers=False, so scope["scheme"] is http even
    behind Render's TLS terminator. The redirect_uri must still come out https,
    otherwise Google rejects it with redirect_uri_mismatch in production only."""

    def test_forwarded_proto_forces_https_in_the_callback(self, env, configured, monkeypatch):
        monkeypatch.delenv("OAUTH_REDIRECT_BASE_URL", raising=False)
        res = env.client.get(
            "/auth/oauth/google/start",
            headers={"X-Forwarded-Proto": "https"},
            follow_redirects=False,
        )
        location = res.headers["location"]
        assert "redirect_uri=https%3A%2F%2F" in location
        assert "redirect_uri=http%3A" not in location

    def test_explicit_redirect_base_wins_over_detection(self, env, configured):
        # The env fixture sets OAUTH_REDIRECT_BASE_URL=https://api.test
        res = env.client.get(
            "/auth/oauth/google/start",
            headers={"X-Forwarded-Proto": "http"},
            follow_redirects=False,
        )
        assert "redirect_uri=https%3A%2F%2Fapi.test%2F" in res.headers["location"]

    def test_loopback_stays_http(self, env, configured, monkeypatch):
        monkeypatch.delenv("OAUTH_REDIRECT_BASE_URL", raising=False)
        res = env.client.get("/auth/oauth/google/start", follow_redirects=False)
        assert "redirect_uri=http%3A%2F%2Ftestserver%2F" in res.headers["location"]


class TestCallbackFailures:
    def test_provider_error_redirects_to_login(self, client, configured):
        res = client.get("/auth/oauth/google/callback", params={"error": "access_denied"})

        assert res.status_code == 302
        assert res.headers["location"] == "https://dashboard.test/login?oauth_error=access_denied"

    def test_missing_code_redirects_with_invalid_code(self, client, configured):
        res = client.get("/auth/oauth/google/callback")
        assert res.headers["location"].endswith("oauth_error=invalid_code")

    def test_unknown_state_is_rejected(self, client, configured):
        res = client.get(
            "/auth/oauth/google/callback", params={"code": "authcode", "state": "forged"}
        )
        assert res.headers["location"].endswith("oauth_error=invalid_state")

    def test_unverified_email_is_refused(self, env, configured, upstream, monkeypatch):
        raw = _mint_state(env)
        monkeypatch.setattr(
            upstream, "fetch_profile", lambda p, t: {**PROFILE, "email_verified": False}
        )

        res = env.client.get(
            "/auth/oauth/google/callback", params={"code": "authcode", "state": raw}
        )

        assert res.headers["location"].endswith("oauth_error=unverified_email")
        # Nothing was created.
        assert env.db.execute("SELECT id FROM users").fetchall() == []

    def test_missing_email_is_refused(self, env, configured, upstream, monkeypatch):
        raw = _mint_state(env)
        monkeypatch.setattr(upstream, "fetch_profile", lambda p, t: {**PROFILE, "email": None})

        res = env.client.get("/auth/oauth/google/callback", params={"code": "c", "state": raw})

        assert res.headers["location"].endswith("oauth_error=no_email")

    def test_upstream_failure_does_not_leak_detail(self, env, configured, monkeypatch):
        from backend.auth import oauth as oauthmod

        raw = _mint_state(env)

        def boom(p, c, r):
            raise oauthmod.OAuthProviderError("token endpoint said hunter2-secret")

        monkeypatch.setattr(oauthmod, "exchange_code_for_token", boom)

        res = env.client.get("/auth/oauth/google/callback", params={"code": "c", "state": raw})

        assert res.headers["location"].endswith("oauth_error=provider_unavailable")
        assert "hunter2-secret" not in res.headers["location"]

    def test_state_cannot_be_replayed(self, env, configured, upstream):
        raw = _mint_state(env)

        first = env.client.get("/auth/oauth/google/callback", params={"code": "c", "state": raw})
        assert first.status_code == 302
        assert first.headers["location"] == "https://dashboard.test/"

        second = env.client.get("/auth/oauth/google/callback", params={"code": "c", "state": raw})
        assert second.headers["location"].endswith("oauth_error=invalid_state")


class TestCallbackHappyPath:
    def test_creates_account_sets_cookie_and_lands_on_dashboard(
        self, env, configured, upstream
    ):
        raw = _mint_state(env)

        res = env.client.get("/auth/oauth/google/callback", params={"code": "c", "state": raw})

        assert res.status_code == 302
        assert res.headers["location"] == "https://dashboard.test/"
        assert "session_token" in res.cookies

        users = env.db.execute("SELECT id, email FROM users").fetchall()
        assert len(users) == 1
        assert users[0][1] == "user@example.com"

        identity = env.db.execute(
            "SELECT provider, provider_user_id FROM oauth_identities"
        ).fetchone()
        assert identity == ("google", "google-123")

    def test_returning_sign_in_does_not_duplicate_the_account(
        self, env, configured, upstream
    ):
        for _ in range(2):
            raw = _mint_state(env)
            res = env.client.get("/auth/oauth/google/callback", params={"code": "c", "state": raw})
            assert res.status_code == 302

        assert len(env.db.execute("SELECT id FROM users").fetchall()) == 1
        assert len(env.db.execute("SELECT id FROM oauth_identities").fetchall()) == 1

    def test_oauth_user_gets_a_default_project(self, env, configured, upstream):
        raw = _mint_state(env)
        env.client.get("/auth/oauth/google/callback", params={"code": "c", "state": raw})

        assert len(env.db.execute("SELECT id FROM projects").fetchall()) == 1

    def test_existing_password_user_keeps_their_data(self, env, configured, upstream):
        from backend.auth.users import create_user

        existing = create_user(env.db, "user@example.com", "their-password")

        raw = _mint_state(env)
        res = env.client.get("/auth/oauth/google/callback", params={"code": "c", "state": raw})
        assert res.status_code == 302

        users = env.db.execute("SELECT id FROM users").fetchall()
        assert len(users) == 1
        assert users[0][0] == existing.id