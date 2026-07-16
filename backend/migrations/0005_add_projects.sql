-- 0005_add_projects.sql
-- Single-tenant local deployment: the running database IS the project.
-- This table records the one project's metadata so the dashboard's
-- Overview / Settings / New-Project wizard have a row to read and update.

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    project_id TEXT UNIQUE NOT NULL,
    project_name TEXT NOT NULL,
    storage_location TEXT NOT NULL DEFAULT 'local',
    backup_interval TEXT NOT NULL DEFAULT '1hour',
    enable_public_api INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
