-- 0004_add_is_active_to_users.sql
-- Add is_active column to users table so the field is persisted and readable.
-- Existing rows default to 1 (active).

ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
