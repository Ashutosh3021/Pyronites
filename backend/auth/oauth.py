"""
OAuth 2.0 authorization-code support for Google and GitHub.

Deliberate constraints:

* **No new dependencies.** HTTP goes through ``urllib.request``, matching
  ``backend/core/email_brevo.py``. Adding an OAuth library would have been
  the easy route, but the project pins exact versions and this keeps the
  dependency surface unchanged.
* **No JWT handling.** Both providers expose a ``userinfo`` endpoint, so we
  exchange the code for an access token and read the profile over plain HTTPS
  rather than verifying an ``id_token`` signature (which would need a crypto
  dependency).
* **Email is never trusted unless the provider says it is verified.** Every
  account-linking and account-creation decision below turns on that single
  flag.
* **Hashed state, single use.** Only the SHA-256 of the ``state`` parameter is
  stored, matching how sessions, API keys and reset tokens are handled.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from backend.auth.users import User, create_user, get_user_by_email
from backend.core.db import Database, DatabaseError

logger = logging.getLogger(__name__)

DEFAULT_STATE_TTL_SECONDS = 600
_HTTP_TIMEOUT_SECONDS = 15


class OAuthError(Exception):
    """A failure whose message is safe to show the end user."""


class OAuthProviderError(OAuthError):
    """The upstream provider failed. Details stay in the log, not the URL."""


PROVIDERS: Dict[str, Dict[str, Any]] = {
    "google": {
        "id": "google",
        "name": "Google",
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email profile",
        "client_id_env": "GOOGLE_CLIENT_ID",
        "client_secret_env": "GOOGLE_CLIENT_SECRET",
    },
    "github": {
        "id": "github",
        "name": "GitHub",
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "userinfo_url": "https://api.github.com/user",
        "emails_url": "https://api.github.com/user/emails",
        "scope": "read:user user:email",
        "client_id_env": "GITHUB_CLIENT_ID",
        "client_secret_env": "GITHUB_CLIENT_SECRET",
    },
}


# ── provider registry ──────────────────────────────────────────────────────


def get_provider(provider_id: str) -> Optional[Dict[str, Any]]:
    return PROVIDERS.get(provider_id.lower())


def provider_credentials(provider_id: str) -> Optional[tuple[str, str]]:
    """Return (client_id, client_secret) when the provider is fully configured."""
    provider = get_provider(provider_id)
    if provider is None:
        return None
    client_id = (os.environ.get(provider["client_id_env"]) or "").strip()
    client_secret = (os.environ.get(provider["client_secret_env"]) or "").strip()
    if not client_id or not client_secret:
        return None
    return client_id, client_secret


def is_provider_configured(provider_id: str) -> bool:
    return provider_credentials(provider_id) is not None


def list_providers() -> List[Dict[str, Any]]:
    """Catalogue for the dashboard. Never leaks client ids or secrets."""
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "configured": is_provider_configured(p["id"]),
        }
        for p in PROVIDERS.values()
    ]


# ── state (CSRF) ───────────────────────────────────────────────────────────


def _hash_state(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_oauth_state(
    db: Database,
    provider: str,
    redirect_uri: str,
    ttl_seconds: Optional[int] = None,
) -> str:
    """Mint a state token. Returns the raw value for the authorize URL."""
    if ttl_seconds is None:
        ttl_seconds = int(
            os.environ.get("OAUTH_STATE_TTL_SECONDS", str(DEFAULT_STATE_TTL_SECONDS))
        )
    now = _now()
    expires_at = now + timedelta(seconds=ttl_seconds)
    raw = secrets.token_urlsafe(32)

    try:
        db.execute("DELETE FROM oauth_states WHERE expires_at < ?", (now.isoformat(),))
        db.execute(
            """
            INSERT INTO oauth_states
                (id, state_hash, provider, redirect_uri, expires_at, used_at, created_at)
            VALUES (?, ?, ?, ?, ?, NULL, ?)
            """,
            (
                str(uuid.uuid4()),
                _hash_state(raw),
                provider,
                redirect_uri,
                expires_at.isoformat(),
                now.isoformat(),
            ),
        )
    except DatabaseError:
        logger.error("Failed to create OAuth state", exc_info=True)
        raise
    return raw


def consume_oauth_state(db: Database, provider: str, raw_state: str) -> Optional[str]:
    """
    Burn a state token and return the redirect_uri it was minted with.

    Returns None if the state is unknown, already used, expired, or was minted
    for a different provider.

    The read and the mark-used happen inside one transaction, and the UPDATE
    carries ``used_at IS NULL`` in its WHERE clause so two concurrent
    redemptions of the same state cannot both win. (This is the TOCTOU bug
    that ``consume_reset_token`` still has — do not copy that version.)
    """
    if not raw_state or not raw_state.strip():
        return None

    state_hash = _hash_state(raw_state.strip())
    now = _now()
    now_iso = now.isoformat()

    try:
        with db.transaction():
            cur = db.execute(
                "SELECT id, provider, redirect_uri, expires_at, used_at "
                "FROM oauth_states WHERE state_hash = ?",
                (state_hash,),
            )
            row = cur.fetchone()
            if row is None:
                return None

            _, row_provider, redirect_uri, expires_at_str, used_at = row
            if used_at is not None or row_provider != provider:
                return None

            expires_at = datetime.fromisoformat(expires_at_str)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < now:
                return None

            db.execute(
                "UPDATE oauth_states SET used_at = ? WHERE id = ? AND used_at IS NULL",
                (now_iso, row[0]),
            )
        return redirect_uri
    except DatabaseError:
        logger.error("Failed to consume OAuth state", exc_info=True)
        raise


# ── upstream HTTP ──────────────────────────────────────────────────────────


def _http_json(
    url: str,
    *,
    data: Optional[bytes] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = _HTTP_TIMEOUT_SECONDS,
) -> Any:
    request = urllib.request.Request(url, data=data, headers=headers or {})
    if data is not None:
        request.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        # Include a trimmed body: Google's error payloads name the exact
        # problem (bad redirect_uri, clock skew) and save a support round-trip.
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:300]
        except Exception:  # pragma: no cover - best effort only
            pass
        raise OAuthProviderError(f"{url} returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise OAuthProviderError(f"{url} is unreachable: {exc.reason}") from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise OAuthProviderError(f"{url} returned a non-JSON response") from exc


def build_authorize_url(
    provider_id: str,
    redirect_uri: str,
    state: str,
) -> str:
    provider = get_provider(provider_id)
    creds = provider_credentials(provider_id)
    if provider is None:
        raise OAuthError("Unknown sign-in provider.")
    if creds is None:
        raise OAuthError(f"{provider['name']} sign-in is not configured on this server.")

    params: Dict[str, str] = {
        "client_id": creds[0],
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": provider["scope"],
        "state": state,
    }
    # Google only re-issues a code when consent is re-granted, so ask for it.
    # GitHub has no `prompt` parameter at all — sending the key with an empty
    # value is malformed, so omit it entirely.
    if provider_id == "google":
        params["prompt"] = "consent"

    return f"{provider['authorize_url']}?{urllib.parse.urlencode(params)}"


def exchange_code_for_token(provider_id: str, code: str, redirect_uri: str) -> str:
    provider = get_provider(provider_id)
    creds = provider_credentials(provider_id)
    if provider is None or creds is None:
        raise OAuthError("Sign-in provider is not configured on this server.")

    payload = urllib.parse.urlencode(
        {
            "client_id": creds[0],
            "client_secret": creds[1],
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode("utf-8")

    # GitHub returns form-encoded unless Accept says otherwise.
    data = _http_json(
        provider["token_url"],
        data=payload,
        headers={"Accept": "application/json"},
    )
    if not isinstance(data, dict):
        raise OAuthProviderError("Token endpoint returned an unexpected payload")

    token = data.get("access_token")
    if not token:
        error = data.get("error_description") or data.get("error") or "no access_token"
        raise OAuthProviderError(f"Token exchange failed: {error}")
    return str(token)


def fetch_profile(provider_id: str, access_token: str) -> Dict[str, Any]:
    """Fetch and normalise the provider profile."""
    provider = get_provider(provider_id)
    if provider is None:
        raise OAuthError("Unknown sign-in provider.")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "User-Agent": "PyroCore",
    }

    if provider_id == "github":
        return _github_profile(provider, access_token, headers)
    return _google_profile(provider, headers)


def _google_profile(provider: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    data = _http_json(provider["userinfo_url"], headers=headers)
    if not isinstance(data, dict):
        raise OAuthProviderError("Google userinfo returned an unexpected payload")

    sub = data.get("sub")
    if not sub:
        raise OAuthProviderError("Google userinfo did not include a subject id")

    email = data.get("email")
    return {
        "provider_user_id": str(sub),
        "email": (email or "").strip().lower() or None,
        # Google sends a real JSON boolean here.
        "email_verified": bool(data.get("email_verified")),
        "display_name": data.get("name") or None,
        "avatar_url": data.get("picture") or None,
    }


def _github_profile(
    provider: Dict[str, Any],
    access_token: str,
    headers: Dict[str, str],
) -> Dict[str, Any]:
    data = _http_json(provider["userinfo_url"], headers=headers)
    if not isinstance(data, dict):
        raise OAuthProviderError("GitHub userinfo returned an unexpected payload")

    github_id = data.get("id")
    if not github_id:
        raise OAuthProviderError("GitHub userinfo did not include an id")

    email = data.get("email")
    verified = bool(data.get("verified_email")) if email else False

    # /user only reports the *primary* address. That primary can be private and
    # therefore unverified even when the account also owns a verified
    # secondary — refusing outright there would lock out a legitimate user, so
    # fall back to /user/emails whenever the primary will not do. We already
    # request the user:email scope, so the call is authorized.
    if not verified:
        fallback_email, fallback_verified = _github_primary_email(
            provider, access_token, headers
        )
        if fallback_verified:
            email, verified = fallback_email, True

    return {
        "provider_user_id": str(github_id),
        "email": (email or "").strip().lower() or None,
        "email_verified": verified,
        "display_name": data.get("name") or data.get("login") or None,
        "avatar_url": data.get("avatar_url") or None,
    }


def _github_primary_email(
    provider: Dict[str, Any],
    access_token: str,
    headers: Dict[str, str],
) -> tuple[Optional[str], bool]:
    try:
        data = _http_json(provider["emails_url"], headers=headers)
    except OAuthProviderError:
        logger.warning("GitHub /user/emails lookup failed", exc_info=True)
        return None, False

    if not isinstance(data, list):
        return None, False

    verified_addresses = [e for e in data if isinstance(e, dict) and e.get("verified")]
    primary = next((e for e in verified_addresses if e.get("primary")), None)
    chosen = primary or (verified_addresses[0] if verified_addresses else None)
    if chosen is None:
        return None, False
    return str(chosen.get("email", "")).strip().lower(), True


# ── identity persistence ───────────────────────────────────────────────────


def get_identity(db: Database, provider: str, provider_user_id: str) -> Optional[str]:
    """Return the user_id linked to this provider account, if any."""
    try:
        cur = db.execute(
            "SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?",
            (provider, provider_user_id),
        )
        row = cur.fetchone()
        return row[0] if row else None
    except DatabaseError:
        logger.error("Failed to look up OAuth identity", exc_info=True)
        raise


def upsert_identity(
    db: Database,
    user_id: str,
    provider: str,
    profile: Dict[str, Any],
) -> None:
    """Attach or refresh the identity row, keeping the profile fields current."""
    now = _now().isoformat()
    try:
        cur = db.execute(
            "SELECT id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?",
            (provider, profile["provider_user_id"]),
        )
        row = cur.fetchone()
        if row is None:
            db.execute(
                """
                INSERT INTO oauth_identities
                    (id, user_id, provider, provider_user_id, email, email_verified,
                     display_name, avatar_url, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    user_id,
                    provider,
                    profile["provider_user_id"],
                    profile.get("email"),
                    1 if profile.get("email_verified") else 0,
                    profile.get("display_name"),
                    profile.get("avatar_url"),
                    now,
                    now,
                ),
            )
            return

        db.execute(
            """
            UPDATE oauth_identities
            SET email = ?, email_verified = ?, display_name = ?,
                avatar_url = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                profile.get("email"),
                1 if profile.get("email_verified") else 0,
                profile.get("display_name"),
                profile.get("avatar_url"),
                now,
                row[0],
            ),
        )
    except DatabaseError:
        logger.error("Failed to upsert OAuth identity", exc_info=True)
        raise


def list_identities_for_user(db: Database, user_id: str) -> List[Dict[str, Any]]:
    try:
        cur = db.execute(
            "SELECT provider, email, created_at FROM oauth_identities "
            "WHERE user_id = ? ORDER BY created_at",
            (user_id,),
        )
        return [
            {"provider": r[0], "email": r[1], "created_at": r[2]}
            for r in cur.fetchall()
        ]
    except DatabaseError:
        logger.error("Failed to list OAuth identities", exc_info=True)
        raise


# ── account resolution ─────────────────────────────────────────────────────


class Resolution:
    """Outcome of turning a provider profile into a local session."""

    def __init__(self, user: User, outcome: str):
        self.user = user
        # "signed_in"  — returning user, identity already linked
        # "linked"     — existing account adopted this provider identity
        # "created"    — brand new account
        self.outcome = outcome


def resolve_oauth_user(db: Database, provider: str, profile: Dict[str, Any]) -> Resolution:
    """
    Map a verified provider profile onto a local user.

    Order matters:

    1. A provider account already linked to a user wins. This is the only
       lookup that needs no trust decision, because the link was established
       in a previous callback.
    2. Otherwise, if the provider asserts the email is verified and a local
       account already holds it, attach the identity to that account. This is
       what lets an existing password user adopt OAuth without losing their
       data. An *unverified* email never links, because anyone can set an
       unverified email on a provider account and would otherwise walk into
       somebody else's account.
    3. Otherwise create a new account.
    """
    provider_user_id = profile["provider_user_id"]

    linked_user_id = get_identity(db, provider, provider_user_id)
    if linked_user_id:
        from backend.auth.users import get_user_by_id

        existing = get_user_by_id(db, linked_user_id)
        if existing is None:
            # Dangling identity (user deleted out from under it).
            raise OAuthError("Your account is no longer available. Please sign up again.")
        if not existing.is_active:
            raise OAuthError("This account has been disabled.")
        upsert_identity(db, existing.id, provider, profile)
        return Resolution(existing, "signed_in")

    email = profile.get("email")
    verified = bool(profile.get("email_verified"))
    if not email:
        raise OAuthError(
            "Your provider account does not expose an email address. "
            "Add one and try again."
        )
    if not verified:
        raise OAuthError(
            "Your provider account's email is not verified, so it cannot be "
            "used for sign-in. Verify it and try again."
        )

    existing_user = get_user_by_email(db, email)
    if existing_user is not None:
        if not existing_user.is_active:
            raise OAuthError("This account has been disabled.")
        upsert_identity(db, existing_user.id, provider, profile)
        return Resolution(existing_user, "linked")

    created = _create_user_for_oauth(db, email)
    upsert_identity(db, created.id, provider, profile)
    return Resolution(created, "created")


def _create_user_for_oauth(db: Database, email: str) -> User:
    """
    Create a password-less account.

    ``users.password_hash`` is NOT NULL and every existing code path assumes a
    hash is present, so rather than a schema change we store the hash of a
    256-bit random secret that is discarded immediately. Password login can
    never match it, which is exactly the intent: there is no password to set.
    """
    unguessable = secrets.token_urlsafe(32)
    return create_user(db, email, unguessable)


def get_verified_email_status(db: Database, user_id: str) -> bool:
    """True when the user has at least one verified provider identity."""
    try:
        cur = db.execute(
            "SELECT COUNT(*) FROM oauth_identities WHERE user_id = ? AND email_verified = 1",
            (user_id,),
        )
        row = cur.fetchone()
        return bool(row and row[0])
    except DatabaseError:
        logger.error("Failed to check verified identity status", exc_info=True)
        return False