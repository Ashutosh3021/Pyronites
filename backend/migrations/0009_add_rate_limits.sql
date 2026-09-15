
-- 0009_add_rate_limits.sql: DB-backed rate limiting

-- Tracks rate limit hits per key+endpoint within a sliding window.
-- Keys are structured like "ip:1.2.3.4" or "apikey:pyro_live_...".
CREATE TABLE IF NOT EXISTS rate_limit_hits (
    key TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    hit_at REAL NOT NULL,
    expires_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_lookup
    ON rate_limit_hits (key, endpoint, expires_at);

CREATE INDEX IF NOT EXISTS idx_rate_limit_cleanup
    ON rate_limit_hits (expires_at);

-- Per-API-key rate limit override (NULL = use global default).
ALTER TABLE api_keys ADD COLUMN rate_limit_rpm INTEGER DEFAULT NULL;
