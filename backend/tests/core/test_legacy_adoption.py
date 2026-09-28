
import os

import pytest

from backend.core.db import Database
from backend.core.legacy_adoption import (
    MARKER_PREFIX,
    parse_adoption_map,
    run_legacy_adoption,
)


class TestParseAdoptionMap:
    def test_parses_multiple_projects(self):
        m = parse_adoption_map("prepiq:a,b; keepawake:fs_users")
        assert m == {"prepiq": ["a", "b"], "keepawake": ["fs_users"]}

    def test_ignores_malformed_entries(self):
        m = parse_adoption_map("no_colon;:notables;slug:;other:t1")
        assert m == {"other": ["t1"]}

    def test_rejects_non_identifier_table_names(self):
        m = parse_adoption_map('prepiq:a,bad-name,"quoted"')
        assert m == {"prepiq": ["a"]}

    def test_deduplicates_preserving_order(self):
        m = parse_adoption_map("prepiq:b,a,b")
        assert m == {"prepiq": ["b", "a"]}

    def test_empty_input(self):
        assert parse_adoption_map("") == {}
        assert parse_adoption_map("  ;  ") == {}


@pytest.fixture
def meta(tmp_path):
    """Meta DB with migrations/projects tables, one project, two source tables."""
    db = Database(str(tmp_path / "meta.db"))
    db.connect()
    db.execute(
        "CREATE TABLE migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, "
        "applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    db.execute(
        "CREATE TABLE projects ("
        "id TEXT PRIMARY KEY, project_id TEXT UNIQUE NOT NULL, "
        "project_name TEXT NOT NULL, "
        "storage_location TEXT NOT NULL DEFAULT 'local', "
        "backup_interval TEXT NOT NULL DEFAULT '1hour', "
        "enable_public_api INTEGER NOT NULL DEFAULT 1, "
        "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
        "owner_id TEXT, status TEXT NOT NULL DEFAULT 'active', slug TEXT, "
        "updated_at TIMESTAMP)"
    )
    db.execute(
        "INSERT INTO projects (id, project_id, project_name, slug, owner_id, status) "
        "VALUES ('pid1', 'pid1', 'PrepIQ', 'prepiq', 'u1', 'active')"
    )
    db.execute("CREATE TABLE subjects (id INTEGER PRIMARY KEY, title TEXT)")
    db.execute("INSERT INTO subjects (title) VALUES ('Math'), ('Physics')")
    db.execute("CREATE TABLE fs_users (id INTEGER PRIMARY KEY, handle TEXT)")
    db.execute("INSERT INTO fs_users (handle) VALUES ('pingmon')")
    yield db
    db.close()


@pytest.fixture
def adoption_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DIR", str(tmp_path / "projects"))
    monkeypatch.setenv(
        "LEGACY_ADOPTION_MAP", "prepiq:subjects,fs_users,missing_table"
    )
    return tmp_path / "projects"


def _open_target(projects_dir, project_id="pid1"):
    db = Database(str(projects_dir / f"{project_id}.db"))
    db.connect()
    return db


class TestRunLegacyAdoption:
    def test_copies_tables_rows_and_marker(self, meta, adoption_env):
        run_legacy_adoption(meta)

        target = _open_target(adoption_env)
        rows = target.execute("SELECT title FROM subjects ORDER BY id").fetchall()
        assert [r[0] for r in rows] == ["Math", "Physics"]
        assert target.execute("SELECT COUNT(*) FROM fs_users").fetchone()[0] == 1
        target.close()

        marker = MARKER_PREFIX + "prepiq"
        assert meta.execute(
            "SELECT 1 FROM migrations WHERE id = ?", (marker,)
        ).fetchone()
        # Source is copied, never moved.
        assert meta.execute("SELECT COUNT(*) FROM subjects").fetchone()[0] == 2

    def test_rerun_is_a_no_op(self, meta, adoption_env):
        run_legacy_adoption(meta)
        run_legacy_adoption(meta)

        target = _open_target(adoption_env)
        assert target.execute("SELECT COUNT(*) FROM subjects").fetchone()[0] == 2
        assert target.execute("SELECT COUNT(*) FROM fs_users").fetchone()[0] == 1
        target.close()

    def test_never_clobbers_existing_target_table(self, meta, adoption_env, monkeypatch):
        # Pre-existing scoped data in the project file must win.
        monkeypatch.setenv("LEGACY_ADOPTION_MAP", "prepiq:subjects,fs_users")
        pre = _open_target(adoption_env)
        pre.execute("CREATE TABLE subjects (id INTEGER PRIMARY KEY, title TEXT)")
        pre.execute("INSERT INTO subjects (title) VALUES ('KEEP')")
        pre.close()

        run_legacy_adoption(meta)

        target = _open_target(adoption_env)
        titles = [
            r[0] for r in target.execute("SELECT title FROM subjects").fetchall()
        ]
        assert titles == ["KEEP"]
        # Tables that don't exist yet are still adopted.
        assert target.execute("SELECT COUNT(*) FROM fs_users").fetchone()[0] == 1
        target.close()
        assert meta.execute(
            "SELECT 1 FROM migrations WHERE id = ?", (MARKER_PREFIX + "prepiq",)
        ).fetchone()

    def test_unknown_slug_is_skipped_without_marker(self, meta, tmp_path, monkeypatch):
        monkeypatch.setenv("PROJECTS_DIR", str(tmp_path / "projects"))
        monkeypatch.setenv("LEGACY_ADOPTION_MAP", "ghost:subjects")

        run_legacy_adoption(meta)  # must not raise

        assert not (tmp_path / "projects").exists() or not list(
            (tmp_path / "projects").glob("*.db")
        )
        assert not meta.execute(
            "SELECT 1 FROM migrations WHERE id = ?", (MARKER_PREFIX + "ghost",)
        ).fetchone()

    def test_unset_env_is_a_no_op(self, meta, monkeypatch, tmp_path):
        monkeypatch.setenv("LEGACY_ADOPTION_MAP", "")
        monkeypatch.setenv("PROJECTS_DIR", str(tmp_path / "projects"))

        run_legacy_adoption(meta)

        assert not (tmp_path / "projects").exists()
        assert not meta.execute("SELECT 1 FROM migrations").fetchone()
