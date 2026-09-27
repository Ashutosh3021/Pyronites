"""RLT (test realtime) harness — serves the reference UI and the PyroCore API
from ONE origin so session cookies and the whole endpoint suite run without
CORS in the way.

    python "test(rlt)/app.py"      ->  http://127.0.0.1:8111

State is isolated from the dev DB:
    test(rlt)/DB/pyrocore.db        (meta / default project)
    test(rlt)/DB/data/projects/*    (scoped project files)
    test(rlt)/DB/storage_files/     (uploads)
    test(rlt)/DB/backups/           (backups)
"""

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO))

# Env must be set BEFORE backend.app is imported (it reads env at import time).
# backend.app also loads the repo-root .env (setdefault semantics) — these
# pre-sets win, keeping the harness isolated from the real deployment config.
os.environ.setdefault("DATABASE_PATH", str(HERE / "DB" / "pyrocore.db"))
os.environ.setdefault("STORAGE_ROOT", str(HERE / "DB" / "storage_files"))
os.environ.setdefault("MIGRATIONS_DIR", str(REPO / "backend" / "migrations"))
os.environ.setdefault("BACKUP_INTERVAL_SECONDS", "3600")
os.environ.setdefault("FRONTEND_ORIGIN", "http://127.0.0.1:8111")
os.environ.setdefault("FRONTEND_ORIGIN_REGEX", "")  # C2: no wildcard in harness
# H2: trust nobody — locally-spoofed X-Forwarded-For must never split the
# rate-limit bucket (the XFF probe depends on this).
os.environ.setdefault("TRUSTED_PROXY_IPS", "")
# Deterministic runs: no S3 network I/O (the real server entrypoint uses the
# .env S3 config; set RLT_S3=1 to exercise bucket sync from the harness).
if os.environ.get("RLT_S3") != "1":
    os.environ.setdefault("S3_SYNC_ENABLED", "false")

from fastapi.staticfiles import StaticFiles  # noqa: E402

from backend.app import app as backend_app  # noqa: E402  (env first)

# Static UI LAST in the route list so every API route wins the match.
backend_app.mount(
    "/", StaticFiles(directory=str(HERE / "public"), html=True), name="public"
)

app = backend_app


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("TEST_PORT", "8111"))
    print(f"RLT harness  ->  http://127.0.0.1:{port}")
    print(f"  db         =   {os.environ['DATABASE_PATH']}")
    print(f"  storage    =   {os.environ['STORAGE_ROOT']}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info", proxy_headers=False)
