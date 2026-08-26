
-- 0008_last_project.sql: track the user's most-recently-used project.
-- Idempotent: if the column already exists the runner treats the
-- "duplicate column name" error as success.

ALTER TABLE users ADD COLUMN last_project_id TEXT;
