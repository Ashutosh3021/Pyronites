"""
Load the repo-root ``.env`` file into ``os.environ`` (12-factor style).

Semantics
---------
* **Never overrides** an already-set environment variable (``setdefault``), so
  containers (docker-compose ``env_file``, render.yaml, Dockerfile ``ENV``),
  tests, and the RLT harness always win over the file.
* Path-like keys are only applied when their target actually exists on this
  machine.  The shipped ``.env`` contains *container* paths (``/data/...``,
  ``/app/...``) — blindly applying them on a developer machine would point
  the server at ``C:\\data`` and crash on a missing migrations dir.
* Import-safe and dependency-free (no python-dotenv required).

Entry points call ``load_env()`` before reading configuration:
``backend/app.py`` (top-level, so uvicorn/pytest/harness all pick it up).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# Keys whose values are filesystem paths.  *_PATH is validated against its
# parent directory (the file itself may not exist yet — it gets created);
# *_DIR / *_ROOT must exist to be useful.
_PATH_FILE_KEYS = {"DATABASE_PATH"}
_PATH_DIR_KEYS = {"MIGRATIONS_DIR", "STORAGE_ROOT"}


def _path_usable(key: str, value: str) -> bool:
    if not value:
        return False
    try:
        p = Path(value)
        if key in _PATH_FILE_KEYS:
            parent = p.parent
            # "" or "." parent means the value is relative to CWD — fine.
            return str(parent) in ("", ".") or parent.exists()
        if key in _PATH_DIR_KEYS:
            return p.exists()
    except OSError:
        return False
    return True


def load_env(path: Optional[str | Path] = None) -> Dict[str, str]:
    """
    Parse a .env file and set any variables that are not already present.

    Returns the dict of variables that were actually loaded (for logging /
    tests).  Missing file, unreadable file, or malformed lines are logged at
    INFO/WARNING and skipped — never raised.
    """
    if path is None:
        path = Path(__file__).resolve().parents[2] / ".env"
    env_path = Path(path)
    if not env_path.is_file():
        return {}

    loaded: Dict[str, str] = {}
    try:
        raw = env_path.read_text(encoding="utf-8")
    except OSError as e:
        logger.warning("Could not read %s: %s", env_path, e)
        return {}

    for line_no, line in enumerate(raw.splitlines(), 1):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if s.startswith("export "):
            s = s[len("export ") :].strip()
        if "=" not in s:
            logger.warning("%s:%d: skipping malformed line", env_path.name, line_no)
            continue
        key, _, value = s.partition("=")
        key = key.strip()
        value = value.strip()
        # Strip matching single/double quotes.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if not key:
            continue
        if key in os.environ:
            continue  # real environment always wins
        if (key in _PATH_FILE_KEYS or key in _PATH_DIR_KEYS) and not _path_usable(
            key, value
        ):
            logger.info(
                "Skipping %s=%s from .env (path does not exist on this machine)",
                key,
                value,
            )
            continue
        os.environ[key] = value
        loaded[key] = value

    if loaded:
        logger.info("Loaded %d variable(s) from %s", len(loaded), env_path)
    return loaded
