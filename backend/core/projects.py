"""
Multi-project registry and per-project SQLite files.

Meta database (DATABASE_PATH / pyrocore.db)
    users, sessions, projects, api_keys, migrations

Per-project databases
    data/projects/{project_uuid}.db  — user tables, storage_files, etc.

Legacy / primary project
    The first ("Default") project may keep using the meta DB path for its
    data so existing single-tenant deployments do not lose tables.  New
    projects always get a dedicated file under the projects directory.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.db import Database, DatabaseError
from backend.core.migrations import run_pending_migrations

logger = logging.getLogger(__name__)

MAX_PROJECTS_PER_USER = 10
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
DEFAULT_PROJECT_NAME = "Default"
DEFAULT_PROJECT_SLUG = "default"


def meta_db_path() -> str:
    return os.environ.get("DATABASE_PATH", "pyrocore.db")


def projects_dir() -> Path:
    override = os.environ.get("PROJECTS_DIR")
    if override:
        return Path(override)
    return Path(meta_db_path()).resolve().parent / "data" / "projects"


def migrations_dir() -> str:
    return os.environ.get(
        "MIGRATIONS_DIR",
        str(Path(__file__).resolve().parent.parent / "migrations"),
    )


def project_file_path(project_id: str) -> Path:
    safe = project_id.strip()
    if not re.match(r"^[a-fA-F0-9-]{36}$", safe) and not re.match(r"^[a-z0-9][a-z0-9-]{0,62}$", safe):
        raise ValueError("invalid project id for path")
    return projects_dir() / f"{safe}.db"


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    if not s:
        s = "project"
    if not _SLUG_RE.match(s):
        s = re.sub(r"[^a-z0-9-]", "", s)[:63] or "project"
    return s[:63]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def open_meta_db() -> Database:
    db = Database(meta_db_path())
    db.connect()
    return db


def open_project_db(project_row: Dict[str, Any], *, run_migrations: bool = True) -> Database:
    path = project_row.get("db_path") or str(project_file_path(project_row["id"]))
    db = Database(path)
    db.connect()
    if run_migrations:
        try:
            run_pending_migrations(db, migrations_dir())
        except Exception:
            logger.error("Failed migrations for project db %s", path, exc_info=True)
            db.close()
            raise
    return db


def count_projects_for_owner(db: Database, owner_id: str) -> int:
    cur = db.execute(
        "SELECT COUNT(*) FROM projects WHERE owner_id = ? AND status != 'deleted'",
        (owner_id,),
    )
    row = cur.fetchone()
    return int(row[0]) if row else 0


def count_active_projects_for_owner(db: Database, owner_id: str) -> int:
    cur = db.execute(
        "SELECT COUNT(*) FROM projects WHERE owner_id = ? AND status = 'active'",
        (owner_id,),
    )
    row = cur.fetchone()
    return int(row[0]) if row else 0


def list_projects_for_owner(db: Database, owner_id: str, *, include_archived: bool = False) -> List[Dict[str, Any]]:
    if include_archived:
        cur = db.execute(
            """
            SELECT id, project_id, project_name, slug, owner_id, status,
                   storage_location, backup_interval, enable_public_api,
                   created_at, updated_at
            FROM projects
            WHERE owner_id = ? AND status != 'deleted'
            ORDER BY created_at ASC
            """,
            (owner_id,),
        )
    else:
        cur = db.execute(
            """
            SELECT id, project_id, project_name, slug, owner_id, status,
                   storage_location, backup_interval, enable_public_api,
                   created_at, updated_at
            FROM projects
            WHERE owner_id = ? AND status = 'active'
            ORDER BY created_at ASC
            """,
            (owner_id,),
        )
    return [_row_to_project(r) for r in cur.fetchall()]


def get_project(db: Database, project_id: str) -> Optional[Dict[str, Any]]:
    cur = db.execute(
        """
        SELECT id, project_id, project_name, slug, owner_id, status,
               storage_location, backup_interval, enable_public_api,
               created_at, updated_at
        FROM projects
        WHERE (id = ? OR project_id = ? OR slug = ?) AND status != 'deleted'
        LIMIT 1
        """,
        (project_id, project_id, project_id),
    )
    row = cur.fetchone()
    return _row_to_project(row) if row else None


def ensure_owner(project: Dict[str, Any], user_id: str) -> None:
    if project.get("owner_id") and project["owner_id"] != user_id:
        raise PermissionError("not project owner")


def create_project(
    db: Database,
    *,
    owner_id: str,
    name: str,
    slug: Optional[str] = None,
    use_meta_db: bool = False,
    storage_location: str = "local",
    backup_interval: str = "1hour",
    enable_public_api: bool = True,
) -> Dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise ValueError("project name must not be empty")

    n = count_projects_for_owner(db, owner_id)
    if n >= MAX_PROJECTS_PER_USER:
        raise ValueError(f"project limit reached (max {MAX_PROJECTS_PER_USER})")

    base_slug = slugify(slug or name)
    final_slug = _unique_slug(db, owner_id, base_slug)

    project_uuid = str(uuid.uuid4())
    created = _now()

    db.execute(
        """
        INSERT INTO projects (
            id, project_id, project_name, slug, owner_id, status,
            storage_location, backup_interval, enable_public_api,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
        """,
        (
            project_uuid,
            final_slug,
            name,
            final_slug,
            owner_id,
            storage_location,
            backup_interval,
            1 if enable_public_api else 0,
            created,
            created,
        ),
    )

    row = get_project(db, project_uuid)
    assert row is not None

    if not use_meta_db:
        path = project_file_path(project_uuid)
        path.parent.mkdir(parents=True, exist_ok=True)
        pdb = Database(str(path))
        pdb.connect()
        try:
            run_pending_migrations(pdb, migrations_dir())
        finally:
            pdb.close()
        logger.info("Created project DB %s", path)
    else:
        logger.info("Primary project %s uses meta DB %s", project_uuid, meta_db_path())

    return row


def ensure_default_project(db: Database, owner_id: str) -> Dict[str, Any]:
    existing = list_projects_for_owner(db, owner_id)
    if existing:
        return existing[0]

    cur = db.execute(
        "SELECT id FROM projects WHERE (owner_id IS NULL OR owner_id = '') AND status != 'deleted' LIMIT 1"
    )
    orphan = cur.fetchone()
    if orphan:
        db.execute(
            "UPDATE projects SET owner_id = ?, status = 'active', updated_at = ? WHERE id = ?",
            (owner_id, _now(), orphan[0]),
        )
        proj = get_project(db, orphan[0])
        if proj:
            return proj

    return create_project(
        db,
        owner_id=owner_id,
        name=DEFAULT_PROJECT_NAME,
        slug=DEFAULT_PROJECT_SLUG,
        use_meta_db=True,
    )


def update_project(
    db: Database,
    project_id: str,
    *,
    name: Optional[str] = None,
    slug: Optional[str] = None,
    backup_interval: Optional[str] = None,
    enable_public_api: Optional[bool] = None,
) -> Dict[str, Any]:
    proj = get_project(db, project_id)
    if not proj:
        raise KeyError("project not found")

    new_name = name.strip() if name is not None else proj["name"]
    if not new_name:
        raise ValueError("project name must not be empty")

    new_slug = proj["slug"]
    if slug is not None:
        new_slug = _unique_slug(db, proj["owner_id"] or "", slugify(slug), exclude_id=proj["id"])

    new_backup = backup_interval if backup_interval is not None else proj.get("backup_interval") or "1hour"
    new_pub = (
        (1 if enable_public_api else 0)
        if enable_public_api is not None
        else (1 if proj.get("enable_public_api") else 0)
    )

    db.execute(
        """
        UPDATE projects SET
            project_name = ?,
            project_id = ?,
            slug = ?,
            backup_interval = ?,
            enable_public_api = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (new_name, new_slug, new_slug, new_backup, new_pub, _now(), proj["id"]),
    )
    updated = get_project(db, proj["id"])
    assert updated is not None
    return updated


def archive_project(db: Database, project_id: str) -> Dict[str, Any]:
    proj = get_project(db, project_id)
    if not proj:
        raise KeyError("project not found")
    db.execute(
        "UPDATE projects SET status = 'archived', updated_at = ? WHERE id = ?",
        (_now(), proj["id"]),
    )
    cur = db.execute(
        "SELECT id, project_id, project_name, slug, owner_id, status, storage_location, backup_interval, enable_public_api, created_at, updated_at FROM projects WHERE id = ?",
        (proj["id"],),
    )
    row = cur.fetchone()
    return _row_to_project(row) if row else proj


def restore_project(db: Database, project_id: str) -> Dict[str, Any]:
    cur = db.execute(
        "SELECT id FROM projects WHERE (id = ? OR project_id = ?) AND status = 'archived'",
        (project_id, project_id),
    )
    row = cur.fetchone()
    if not row:
        raise KeyError("archived project not found")
    db.execute(
        "UPDATE projects SET status = 'active', updated_at = ? WHERE id = ?",
        (_now(), row[0]),
    )
    proj = get_project(db, row[0])
    assert proj is not None
    return proj


def hard_delete_project(
    db: Database,
    project_id: str,
    *,
    confirm_name: str,
    owner_id: Optional[str] = None,
) -> None:
    """
    Permanently delete a project after name confirmation.

    Refuses to delete the owner's last active project (keeps Default usable).
    """
    cur = db.execute(
        """
        SELECT id, project_id, project_name, slug, status, owner_id
        FROM projects WHERE id = ? OR project_id = ? OR slug = ?
        """,
        (project_id, project_id, project_id),
    )
    row = cur.fetchone()
    if not row:
        raise KeyError("project not found")
    pid, pslug, pname, owner = row[0], row[1], row[2], row[5]
    if (confirm_name or "").strip() != pname:
        raise ValueError("confirmation name does not match project name")

    oid = owner_id or owner
    if oid:
        active_n = count_active_projects_for_owner(db, oid)
        # If this row is still active, deleting it would leave active_n - 1
        status = row[4] or "active"
        remaining = active_n - (1 if status == "active" else 0)
        if remaining < 1:
            raise ValueError(
                "cannot delete the last active project — create another project first"
            )

    db.execute(
        "DELETE FROM api_keys WHERE project_id = ? OR project_id = ?",
        (pslug, pid),
    )
    db.execute("DELETE FROM projects WHERE id = ?", (pid,))

    path = project_file_path(pid)
    meta = Path(meta_db_path()).resolve()
    if path.resolve() != meta and path.exists():
        try:
            path.unlink()
            for suffix in ("-wal", "-shm"):
                side = Path(str(path) + suffix)
                if side.exists():
                    side.unlink()
        except OSError as e:
            logger.warning("Could not remove project DB file %s: %s", path, e)


def _unique_slug(db: Database, owner_id: str, base: str, exclude_id: Optional[str] = None) -> str:
    candidate = base
    n = 2
    while True:
        cur = db.execute(
            """
            SELECT id FROM projects
            WHERE (project_id = ? OR slug = ?) AND status != 'deleted'
            """,
            (candidate, candidate),
        )
        row = cur.fetchone()
        if row is None or (exclude_id and row[0] == exclude_id):
            return candidate
        candidate = f"{base[:50]}-{n}"
        n += 1
        if n > 1000:
            raise ValueError("could not allocate unique slug")


def _row_to_project(row: Any) -> Dict[str, Any]:
    return {
        "id": row[0],
        "project_id": row[1],
        "name": row[2],
        "slug": row[3] or row[1],
        "owner_id": row[4],
        "status": row[5] or "active",
        "storage_location": row[6],
        "backup_interval": row[7],
        "enable_public_api": bool(row[8]),
        "created_at": row[9],
        "updated_at": row[10] if len(row) > 10 else None,
        "db_path": None,
    }
