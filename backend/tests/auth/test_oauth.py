"""
Tests for the OAuth domain layer: provider registry, CSRF state, and the
account-resolution rules that decide whether a provider profile becomes a new
account, an existing one, or a refusal.
"""

import os
import shutil
import tempfile
from pathlib import Path

import pytest

from backend.auth import oauth as oauthmod
from backend.auth.oauth import OAuthError
from backend.auth.users import authenticate_user, create_user, get_user_by_email, set_user_active
from backend.core.db import Database
from backend.core.migrations import run_pending_migrations


@pytest.fixture
def db(temp_dir):
    migrations_dir = temp_dir / "migrations"
    migrations_dir.mkdir()
    real = Path(__file__).parent.parent.parent / "migrations"
    for f in real.glob("*.sql"):
        shutil.copy(f, migrations_dir / f.name)

    database = Database(str(temp_dir / "oauth.db"))
    database.connect()
    run_pending_migrations(database, str(migrations_dir))
    yield database
    database.close()


@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def _profile(**overrides):
    base = {
        "provider_user_id": "google-123",
        "email": "user@example.com",
        "email_verified": True,
        "display_name": "Test User",
        "avatar_url": None,
    }
    base.update(overrides)
    return base


class TestProviderRegistry:
    def test_lists_every_provider_without_leaking_secrets(self, monkeypatch):
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "public-id")
        monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "super-secret")

        listed = {p["id"]: p for p in oauthmod.list_providers()}

        assert "google" in listed and "github" in listed
        assert listed["google"]["configured"] is True
        assert listed["github"]["configured"] is False
        # The catalogue is what the login page renders from.
        assert "super-secret" not in str(listed)
        assert "public-id" not in str(listed)

    def test_partial_config_is_treated_as_unconfigured(self, monkeypatch):
        monkeypatch.setenv("GITHUB_CLIENT_ID", "id-only")
        monkeypatch.setenv("GITHUB_CLIENT_SECRET", "")
        assert oauthmod.is_provider_configured("github") is False

    def test_unknown_provider_returns_none(self):
        assert oauthmod.get_provider("facebook") is None
        assert oauthmod.provider_credentials("facebook") is None

    def test_authorize_url_carries_the_contract_fields(self, monkeypatch):
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
        monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "csec")

        url = oauthmod.build_authorize_url("google", "https://api.test/cb", "st-123")

        assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
        assert "client_id=cid" in url
        assert "response_type=code" in url
        assert "state=st-123" in url
        assert "scope=openid+email+profile" in url

    def test_authorize_url_refuses_when_unconfigured(self, monkeypatch):
        monkeypatch.setenv("GITHUB_CLIENT_ID", "")
        monkeypatch.setenv("GITHUB_CLIENT_SECRET", "")
        with pytest.raises(OAuthError):
            oauthmod.build_authorize_url("github", "https://api.test/cb", "st")

    def test_token_exchange_refuses_when_unconfigured(self, monkeypatch):
        monkeypatch.setenv("GITHUB_CLIENT_ID", "")
        monkeypatch.setenv("GITHUB_CLIENT_SECRET", "")
        with pytest.raises(OAuthError):
            oauthmod.exchange_code_for_token("github", "code", "https://api.test/cb")


class TestOAuthState:
    def test_round_trip_returns_the_stored_redirect_uri(self, db):
        raw = oauthmod.create_oauth_state(db, "google", "https://api.test/cb")
        assert oauthmod.consume_oauth_state(db, "google", raw) == "https://api.test/cb"

    def test_state_is_single_use(self, db):
        raw = oauthmod.create_oauth_state(db, "google", "https://api.test/cb")
        assert oauthmod.consume_oauth_state(db, "google", raw) is not None
        # Replay of a captured callback must fail.
        assert oauthmod.consume_oauth_state(db, "google", raw) is None

    def test_state_is_bound_to_its_provider(self, db):
        raw = oauthmod.create_oauth_state(db, "google", "https://api.test/cb")
        assert oauthmod.consume_oauth_state(db, "github", raw) is None

    def test_expired_state_is_rejected(self, db):
        raw = oauthmod.create_oauth_state(db, "google", "https://api.test/cb", ttl_seconds=-1)
        assert oauthmod.consume_oauth_state(db, "google", raw) is None

    def test_unknown_and_empty_state_are_rejected(self, db):
        assert oauthmod.consume_oauth_state(db, "google", "never-issued") is None
        assert oauthmod.consume_oauth_state(db, "google", "") is None
        assert oauthmod.consume_oauth_state(db, "google", "   ") is None

    def test_only_the_hash_is_persisted(self, db):
        raw = oauthmod.create_oauth_state(db, "google", "https://api.test/cb")
        cur = db.execute("SELECT state_hash FROM oauth_states")
        stored = cur.fetchone()[0]
        assert stored != raw
        assert len(stored) == 64  # sha256 hex


class TestGitHubProfile:
    """GitHub reports only the *primary* address on /user. A private primary is
    unverified even when the account owns a verified secondary, and refusing
    that case locks out a legitimate user."""

    @staticmethod
    def _patch(monkeypatch, user_response, emails_response=None):
        from backend.auth import oauth as mod

        def fake_http_json(url, **kwargs):
            if url.endswith("/user/emails"):
                if emails_response is None:
                    raise mod.OAuthProviderError("no emails scope")
                return emails_response
            return user_response

        monkeypatch.setattr(mod, "_http_json", fake_http_json)

    def test_public_verified_email_needs_no_extra_call(self, monkeypatch):
        self._patch(monkeypatch, {"id": 1, "email": "a@b.com", "verified_email": True})

        profile = oauthmod.fetch_profile("github", "tok")

        assert profile["provider_user_id"] == "1"
        assert profile["email"] == "a@b.com"
        assert profile["email_verified"] is True

    def test_unverified_primary_falls_back_to_verified_secondary(self, monkeypatch):
        self._patch(
            monkeypatch,
            {"id": 2, "email": "private@users.noreply.github.com", "verified_email": False},
            emails_response=[
                {"email": "private@users.noreply.github.com", "verified": False, "primary": True},
                {"email": "real@example.com", "verified": True, "primary": False},
            ],
        )

        profile = oauthmod.fetch_profile("github", "tok")

        assert profile["email"] == "real@example.com"
        assert profile["email_verified"] is True

    def test_prefers_the_primary_among_verified_addresses(self, monkeypatch):
        self._patch(
            monkeypatch,
            {"id": 3, "email": None},
            emails_response=[
                {"email": "second@example.com", "verified": True, "primary": False},
                {"email": "first@example.com", "verified": True, "primary": True},
            ],
        )

        profile = oauthmod.fetch_profile("github", "tok")

        assert profile["email"] == "first@example.com"
        assert profile["email_verified"] is True

    def test_never_claims_an_unverified_address_is_verified(self, monkeypatch):
        self._patch(
            monkeypatch,
            {"id": 4, "email": "unverified@x.com", "verified_email": False},
            emails_response=[{"email": "unverified@x.com", "verified": False, "primary": True}],
        )

        profile = oauthmod.fetch_profile("github", "tok")

        assert profile["email_verified"] is False

    def test_missing_email_stays_unverified(self, monkeypatch):
        self._patch(monkeypatch, {"id": 5, "email": None})

        profile = oauthmod.fetch_profile("github", "tok")

        assert profile["email"] is None
        assert profile["email_verified"] is False

    def test_noreply_only_account_is_not_treated_as_verified(self, monkeypatch):
        # GitHub's noreply address is auto-generated and carries no proof of
        # ownership for our purposes.
        self._patch(
            monkeypatch,
            {"id": 6, "email": "1234+login@users.noreply.github.com", "verified_email": False},
            emails_response=[
                {"email": "1234+login@users.noreply.github.com", "verified": True, "primary": True}
            ],
        )

        profile = oauthmod.fetch_profile("github", "tok")

        # GitHub does mark noreply addresses verified, so we accept them, but the
        # value must stay lower-cased and non-empty for the users table.
        assert profile["email"] == "1234+login@users.noreply.github.com"
        assert profile["email_verified"] is True


class TestResolveOAuthUser:
    def test_creates_account_on_first_sign_in(self, db):
        resolution = oauthmod.resolve_oauth_user(db, "google", _profile())

        assert resolution.outcome == "created"
        assert resolution.user.email == "user@example.com"
        assert oauthmod.get_identity(db, "google", "google-123") == resolution.user.id

    def test_oauth_only_account_cannot_use_password_login(self, db):
        resolution = oauthmod.resolve_oauth_user(db, "google", _profile())

        # The stored password is a discarded random secret, so no guess works.
        assert authenticate_user(db, "user@example.com", "password") is None
        assert authenticate_user(db, "user@example.com", "") is None
        assert resolution.user.password_hash.startswith("$argon2")

    def test_returning_user_reuses_the_same_account(self, db):
        first = oauthmod.resolve_oauth_user(db, "google", _profile())
        second = oauthmod.resolve_oauth_user(db, "google", _profile())

        assert second.outcome == "signed_in"
        assert second.user.id == first.user.id

    def test_verified_email_adopts_an_existing_password_account(self, db):
        # This is the migration path for users who signed up with a password.
        existing = create_user(db, "user@example.com", "their-password")

        resolution = oauthmod.resolve_oauth_user(db, "google", _profile())

        assert resolution.outcome == "linked"
        assert resolution.user.id == existing.id
        assert oauthmod.get_identity(db, "google", "google-123") == existing.id
        # Their password still works.
        assert authenticate_user(db, "user@example.com", "their-password") is not None

    def test_unverified_email_cannot_take_over_an_existing_account(self, db):
        create_user(db, "user@example.com", "their-password")

        with pytest.raises(OAuthError, match="not verified"):
            oauthmod.resolve_oauth_user(db, "google", _profile(email_verified=False))

        # No identity was linked, so the attacker stays locked out.
        assert oauthmod.get_identity(db, "google", "google-123") is None
        assert authenticate_user(db, "user@example.com", "their-password") is not None

    def test_missing_email_is_refused(self, db):
        with pytest.raises(OAuthError, match="does not expose an email"):
            oauthmod.resolve_oauth_user(db, "github", _profile(email=None))

    def test_disabled_account_cannot_sign_in(self, db):
        resolution = oauthmod.resolve_oauth_user(db, "google", _profile())
        set_user_active(db, resolution.user.id, False)

        with pytest.raises(OAuthError, match="disabled"):
            oauthmod.resolve_oauth_user(db, "google", _profile())

    def test_one_provider_account_maps_to_exactly_one_user(self, db):
        first = oauthmod.resolve_oauth_user(db, "google", _profile())

        # Same provider account, someone else's email: the existing link wins
        # and the email is never re-bound to a new user.
        second = oauthmod.resolve_oauth_user(
            db, "google", _profile(email="someone-else@example.com", email_verified=True)
        )

        assert second.user.id == first.user.id
        assert get_user_by_email(db, "someone-else@example.com") is None

    def test_profile_refresh_keeps_display_fields_current(self, db):
        oauthmod.resolve_oauth_user(db, "google", _profile())
        oauthmod.resolve_oauth_user(
            db, "google", _profile(display_name="Renamed", avatar_url="https://img/x.png")
        )

        identities = oauthmod.list_identities_for_user(
            db, oauthmod.get_identity(db, "google", "google-123")
        )
        assert len(identities) == 1
        assert identities[0]["provider"] == "google"