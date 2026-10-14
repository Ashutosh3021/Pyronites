-- 0013: request metrics for the Analytics page.
--
-- The dashboard needs request volume, latency and error rate over time. The
-- existing log ring is in-memory (lost on restart) and only captures warnings
-- and above, so it cannot answer those questions.
--
-- One row per request. `route` stores the *route template*
-- (`/api/projects/{project_id}/tables/{table}`) rather than the concrete path,
-- so the row count stays bounded instead of growing with every table name.
CREATE TABLE IF NOT EXISTS metrics_buckets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    bucket_ts REAL NOT NULL,
    method TEXT NOT NULL,
    route TEXT NOT NULL,
    status INTEGER NOT NULL,
    duration_ms REAL NOT NULL,
    created_at TEXT NOT NULL
);

-- Serves the dashboard's range query, which filters by project and time.
CREATE INDEX IF NOT EXISTS idx_metrics_project_ts ON metrics_buckets (project_id, bucket_ts);
-- Serves retention pruning, which only filters by time.
CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics_buckets (bucket_ts);