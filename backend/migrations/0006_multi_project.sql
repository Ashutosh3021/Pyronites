-- 0006_multi_project.sql
-- Extend projects for multi-project: owner, status, slug helpers.
-- One SQLite file per project (path derived from id; primary/legacy may use meta DB).

ALTER TABLE projects ADD COLUMN owner_id TEXT;
ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE projects ADD COLUMN slug TEXT;
ALTER TABLE projects ADD COLUMN updated_at TIMESTAMP;

-- Backfill slug from project_id when missing (existing single-tenant rows).
UPDATE projects SET slug = project_id WHERE slug IS NULL OR slug = '';

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
