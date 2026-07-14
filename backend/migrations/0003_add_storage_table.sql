
CREATE TABLE IF NOT EXISTS storage_files (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL,
    project_id TEXT NOT NULL
);
