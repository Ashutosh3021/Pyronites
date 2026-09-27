"""
pytest env guard.

backend/app.py now loads the repo-root .env at import (so local servers and
the RLT harness run with real config).  Tests must stay hermetic: this file
pre-sets the variables .env would otherwise inject — BEFORE any test module
imports backend.app — so load_env()'s setdefault semantics keep test values.

Also prevents: S3 calls with production credentials, container paths
(/data, /app) on developer machines, and real Brevo email sends.
"""

import os
from pathlib import Path

_REPO = Path(__file__).resolve().parent

os.environ.setdefault("DATABASE_PATH", "pyrocore.db")
os.environ.setdefault("STORAGE_ROOT", "storage_files")
os.environ.setdefault("MIGRATIONS_DIR", str(_REPO / "backend" / "migrations"))
os.environ.setdefault("BACKUP_INTERVAL_SECONDS", "3600")
# CORS: empty => app falls back to its exact-origin defaults (no regex).
os.environ.setdefault("FRONTEND_ORIGIN", "")
os.environ.setdefault("FRONTEND_ORIGIN_REGEX", "")
# Never touch S3 or Brevo from tests.
os.environ.setdefault("S3_SYNC_ENABLED", "false")
os.environ.setdefault("BREVO_API_KEY", "")
os.environ.setdefault("PASSWORD_RESET_BASE_URL", "")
# Loopback-only test servers must not inherit proxy trust config.
os.environ.setdefault("TRUSTED_PROXY_IPS", "")
# Connect-per-acquire inside tests: pooled connections keep SQLite files open,
# and Windows cannot rmtree tmp dirs that hold open file handles.
os.environ.setdefault("PYROCORE_NO_POOL", "1")
