-- 0012: single-use CSRF state for the OAuth authorization-code round trip.

-- The state parameter is what stops an attacker from feeding their own
-- authorization code into our callback. It has to be unguessable, bound to
-- one provider, short-lived, and burnable exactly once.

-- Only the SHA-256 hash is stored, matching how sessions, API keys and reset
-- tokens are handled elsewhere. A leaked database backup cannot be replayed
-- against a live callback.
CREATE TABLE IF NOT EXISTS oauth_states (
    id TEXT PRIMARY KEY,
    state_hash TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_hash ON oauth_states (state_hash);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states (expires_at);