-- 0010: plane marker for API keys.
--
-- Strangler boundary: the unscoped legacy plane (/tables, /storage, /sql)
-- is tenancy-blind. Keys minted on the SCOPED plane must not be usable
-- there (cross-tenant read/write of the shared meta DB). Existing keys
-- default to 'legacy' so their historical behaviour is unchanged.
ALTER TABLE api_keys ADD COLUMN plane TEXT NOT NULL DEFAULT 'legacy';
