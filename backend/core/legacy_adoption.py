"""
One-time adoption of legacy (unscoped-plane) tables into project files.

Background
----------
Before multi-project scoping, every API key operated on the meta DB
(``DATABASE_PATH``) — the *legacy plane*.  After the H1 strangler, new
scoped traffic lands in ``data/projects/<id>.db`` instead.  Deployments that
created their tables through the legacy plane therefore keep their real data
in the meta DB while the scoped dashboard reads the (near-empty) project
file — tables appear to "vanish" even though nothing was deleted.

This module copies — never moves, never deletes — the mapped tables from the
meta DB into the file of the project that owns them.

Control
-------
``LEGACY_ADOPTION_MAP`` environment variable::

    slug:table1,table2;other_slug:table3

* ``slug`` resolves the project via the same ``id OR project_id OR slug``
  lookup used everywhere else (see ``backend.core.projects.get_project``).
* Table names must be plain SQL identifiers; anything else is ignored.
* Empty / unset value → adoption is a no-op (the normal state for new
  deployments).

Safety
------
* **Marker-gated**: after a project's tables are processed, a row
  ``legacy_adoption_<slug>`` is inserted into the meta DB ``migrations``
  table (persisted + synced to S3), so the copy runs exactly once per slug.
* **Never clobbers**: a table that already exists in the target project file
  is skipped with a log line — existing scoped data always wins.
* **Idempotent**: a crash mid-run rolls back the incomplete project's copy
  (single transaction) and leaves the marker unset, so the next startup
  retries; re-running after success is a no-op.
* **Never blocks startup**: all failures are logged, none are raised —
  the legacy plane keeps serving the same data either way.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Dict, List

from .db import Database, DatabaseError
from .projects import get_project, open_project_db

logger = logging.getLogger(__name__)

MARKER_PREFIX = "legacy_adoption_"
MAP_ENV = "LEGACY_ADOPTION_MAP"

# SQLite plain identifier — used as a guard before interpolating table names
# into SQL (map values come from configuration, not user input, but validate
# anyway so a malformed env var can never smuggle SQL).
_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def parse_adoption_map(raw: str) -> Dict[str, List[str]]:
    """
    Parse ``LEGACY_ADOPTION_MAP`` into ``{slug: [table, ...]}``.

    Format: ``slug:t1,t2;slug2:t3``.  Whitespace around entries is tolerated.
    Malformed entries (no colon, empty slug, empty table list) and table
    names that are not plain identifiers are skipped with a warning —
    never raised.
    """
    mapping: Dict[str, List[str]] = {}
    for chunk in raw.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if ":" not in chunk:
            logger.warning("Legacy adoption map: ignoring entry without ':': %r", chunk)
            continue
        slug, _, tables = chunk.partition(":")
        slug = slug.strip()
        names = [t.strip() for t in tables.split(",") if t.strip()]
        if not slug or not names:
            logger.warning("Legacy adoption map: ignoring empty entry: %r", chunk)
            continue
        valid: List[str] = []
        for name in names:
            if _IDENT.match(name):
                if name not in valid:
                    valid.append(name)
            else:
                logger.warning(
                    "Legacy adoption map: skipping invalid table name %r (slug %r)",
                    name, slug,
                )
        if valid:
            mapping.setdefault(slug, []).extend(valid)
    return mapping


def run_legacy_adoption(meta_db: Database) -> None:
    """
    Adopt every project listed in ``LEGACY_ADOPTION_MAP``.  Never raises.

    Must run AFTER S3 restore and meta migrations (see ``backend.app``) so the
    meta DB is fully populated before tables are copied.
    """
    raw = os.environ.get(MAP_ENV, "").strip()
    if not raw:
        logger.debug("Legacy adoption: %s not set; skipping", MAP_ENV)
        return
    mapping = parse_adoption_map(raw)
    if not mapping:
        return
    logger.info(
        "Legacy adoption: processing %d project(s) from %s", len(mapping), MAP_ENV
    )
    for slug, tables in mapping.items():
        try:
            _adopt_project(meta_db, slug, tables)
        except Exception:
            # Never block startup — the legacy plane still serves this data.
            logger.error("Legacy adoption failed for %r", slug, exc_info=True)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _table_exists(db_conn, name: str) -> bool:
    """sqlite_master lookup against either a ``Database`` or a raw connection."""
    return (
        db_conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


def _adopt_project(meta_db: Database, slug: str, tables: List[str]) -> None:
    marker = MARKER_PREFIX + slug
    try:
        if meta_db.execute(
            "SELECT 1 FROM migrations WHERE id = ?", (marker,)
        ).fetchone():
            logger.debug("Legacy adoption: %s already applied", slug)
            return
    except DatabaseError:
        pass  # no migrations table yet → treat as "not applied"

    project = get_project(meta_db, slug)
    if not project:
        logger.info(
            "Legacy adoption: no active project matches %r; nothing to do", slug
        )
        return

    target = open_project_db(project)  # creates + migrates the file if new
    try:
        # FK enforcement is disabled for the copy: the rows satisfied FKs in
        # the source DB, and a verbatim copy should not fail at COMMIT because
        # a referenced table was not part of this project's map.  The pragma
        # must be set OUTSIDE the transaction (it is a no-op inside one).
        target.execute("PRAGMA foreign_keys=OFF")
        try:
            with target.transaction() as conn:
                _copy_tables(meta_db, conn, slug, tables)
        finally:
            target.execute("PRAGMA foreign_keys=ON")
    finally:
        target.close()

    meta_db.execute(
        "INSERT OR IGNORE INTO migrations (id, name) VALUES (?, ?)",
        (marker, f"legacy adoption ({slug})"),
    )
    logger.info("Legacy adoption: %s complete (marker recorded)", slug)


def _copy_tables(source: Database, target_conn, slug: str, tables: List[str]) -> None:
    """
    Copy each mapped table's schema + rows from ``source`` (meta DB) into
    ``target_conn`` (raw connection of the project file, inside a transaction).
    Target-side reads must use ``target_conn`` only — calling
    ``Database.execute`` on the project DB here would auto-commit the
    in-progress transaction.
    """
    copied = skipped = 0
    for name in tables:
        if not _table_exists(source, name):
            logger.warning(
                "Legacy adoption [%s]: source table %r not found in meta DB; skipping",
                slug, name,
            )
            continue
        if _table_exists(target_conn, name):
            logger.info(
                "Legacy adoption [%s]: %r already exists in project file; "
                "keeping existing data (source copy skipped)",
                slug, name,
            )
            skipped += 1
            continue

        create_row = source.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        if not create_row or not create_row[0]:
            logger.warning(
                "Legacy adoption [%s]: no CREATE statement for %r; skipping",
                slug, name,
            )
            continue

        target_conn.execute(create_row[0])

        cols = [r[1] for r in source.execute(f'PRAGMA table_info("{name}")')]
        rows = source.execute(f'SELECT * FROM "{name}"').fetchall()
        if rows and cols:
            quoted = ", ".join(f'"{c}"' for c in cols)
            placeholders = ", ".join("?" for _ in cols)
            target_conn.executemany(
                f'INSERT INTO "{name}" ({quoted}) VALUES ({placeholders})', rows
            )

        # Secondary objects (non-auto indexes carry SQL; auto-indexes are NULL
        # and are recreated implicitly by UNIQUE/PK table constraints).
        for obj_type in ("index", "trigger"):
            objs = source.execute(
                "SELECT sql FROM sqlite_master "
                "WHERE type=? AND tbl_name=? AND sql IS NOT NULL",
                (obj_type, name),
            ).fetchall()
            for (sql,) in objs:
                try:
                    target_conn.execute(sql)
                except Exception as e:
                    logger.warning(
                        "Legacy adoption [%s]: could not copy %s on %r: %s",
                        slug, obj_type, name, e,
                    )

        logger.info(
            "Legacy adoption [%s]: copied %r (%d row(s))", slug, name, len(rows)
        )
        copied += 1

    logger.info(
        "Legacy adoption [%s]: %d table(s) copied, %d skipped", slug, copied, skipped
    )
