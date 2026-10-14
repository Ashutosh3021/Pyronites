-- 0011: external identities for federated sign-in (OAuth).

-- A user may hold several identities (Google + GitHub) but a given provider
-- account maps to exactly one user. The UNIQUE(provider, provider_user_id)
-- constraint is the takeover guard: an attacker cannot re-point a provider
-- account at a different user_id, and one provider account cannot sign in as
-- two people.
--
-- users.email stays UNIQUE NOT NULL. Linking a provider identity to an
-- existing user is an application-level decision (backend/auth/oauth.py) that
-- only proceeds when the provider asserts the email is verified.
CREATE TABLE IF NOT EXISTS oauth_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    display_name TEXT,
    avatar_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_identities_email ON oauth_identities (email);