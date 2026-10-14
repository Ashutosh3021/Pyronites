"""
Tests for DDL generation.

The important property is that a caller-supplied default is never interpolated
as SQL — it is either recognised as a literal keyword/number or quoted. The
dashboard's live SQL preview calls the same builder, so these tests also pin
what the user sees before they press Create.
"""

import pytest

from backend.core.schema_rules import (
    CreateTableBody,
    RESERVED_TABLES,
    build_create_table_ddl,
    render_default_literal,
)


class TestRenderDefaultLiteral:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            (None, None),
            ("", None),
            ("   ", None),
            ("0", "0"),
            ("-12", "-12"),
            ("3.5", "3.5"),
            ("1e10", "1e10"),
            ("-2.5E-3", "-2.5E-3"),
            ("null", "NULL"),
            ("NULL", "NULL"),
            ("true", "TRUE"),
            ("false", "FALSE"),
            ("hello", "'hello'"),
            ("it's", "'it''s'"),
            ("O'Brien", "'O''Brien'"),
        ],
    )
    def test_renders_expected_literal(self, raw, expected):
        assert render_default_literal(raw) == expected

    @pytest.mark.parametrize(
        "hostile",
        [
            "1); DROP TABLE users;--",
            "'); DELETE FROM sessions;--",
            "x' UNION SELECT * FROM users",
            '" OR "1"="1',
            "0x41",
        ],
    )
    def test_hostile_default_becomes_an_inert_string(self, hostile):
        rendered = render_default_literal(hostile)
        # Quoted, so the payload can never escape into SQL.
        assert rendered.startswith("'")
        assert rendered.endswith("'")
        # Any embedded quote is doubled, which is what neutralises it.
        assert rendered.count("'") % 2 == 0


class TestBuildCreateTableDDL:
    def test_minimal_table(self):
        ddl = build_create_table_ddl(
            "notes", [{"name": "title", "type": "TEXT"}, {"name": "body", "type": "TEXT"}]
        )
        assert ddl == "CREATE TABLE IF NOT EXISTS notes (title TEXT, body TEXT)"

    def test_type_is_upper_cased(self):
        ddl = build_create_table_ddl("t", [{"name": "n", "type": "integer"}])
        assert ddl == "CREATE TABLE IF NOT EXISTS t (n INTEGER)"

    def test_constraints_render_in_stable_order(self):
        ddl = build_create_table_ddl(
            "users",
            [
                {"name": "id", "type": "TEXT", "not_null": True},
                {"name": "email", "type": "TEXT", "not_null": True, "unique": True},
                {"name": "age", "type": "INTEGER", "default": "0"},
            ],
            primary_key="id",
        )
        assert ddl == (
            "CREATE TABLE IF NOT EXISTS users ("
            "id TEXT NOT NULL, "
            "email TEXT NOT NULL UNIQUE, "
            "age INTEGER DEFAULT 0, "
            "PRIMARY KEY (id))"
        )

    def test_blank_default_is_omitted(self):
        ddl = build_create_table_ddl(
            "t", [{"name": "c", "type": "TEXT", "default": "   "}]
        )
        assert ddl == "CREATE TABLE IF NOT EXISTS t (c TEXT)"

    def test_actual_sqlite_executes_the_generated_ddl(self, tmp_path):
        """The statement we preview must be one SQLite actually accepts."""
        import sqlite3

        ddl = build_create_table_ddl(
            "notes",
            [
                {"name": "id", "type": "TEXT", "not_null": True},
                {"name": "title", "type": "TEXT", "not_null": True},
                {"name": "email", "type": "TEXT", "unique": True},
                {"name": "views", "type": "INTEGER", "default": "0"},
                {"name": "created_at", "type": "DATETIME", "default": "CURRENT_TIMESTAMP"},
            ],
            primary_key="id",
        )
        con = sqlite3.connect(":memory:")
        try:
            con.execute(ddl)
            con.execute(
                "INSERT INTO notes (id, title, created_at) VALUES (?, ?, ?)",
                ("1", "hello", "2026-01-01"),
            )
            row = con.execute("SELECT views, created_at FROM notes").fetchone()
            # Integer default applied, datetime default stored as text.
            assert row[0] == 0
            assert row[1] == "2026-01-01"
            # NOT NULL and UNIQUE are live, not decorative.
            with pytest.raises(sqlite3.IntegrityError):
                # omits the NOT NULL `title`
                con.execute("INSERT INTO notes (id) VALUES (?)", ("2",))

            con.execute(
                "INSERT INTO notes (id, title, email) VALUES (?, ?, ?)",
                ("3", "x", "dup@x.com"),
            )
            with pytest.raises(sqlite3.IntegrityError):
                con.execute(
                    "INSERT INTO notes (id, title, email) VALUES (?, ?, ?)",
                    ("4", "y", "dup@x.com"),
                )
        finally:
            con.close()

    def test_empty_primary_key_is_omitted(self):
        ddl = build_create_table_ddl("t", [{"name": "c", "type": "TEXT"}], primary_key=None)
        assert "PRIMARY KEY" not in ddl


class TestCreateTableBodyValidation:
    def test_accepts_rich_columns(self):
        body = CreateTableBody(
            table="notes",
            columns=[
                {"name": "id", "type": "TEXT", "not_null": True},
                {"name": "title", "type": "TEXT"},
            ],
            primary_key="id",
        )
        assert len(body.columns) == 2

    def test_duplicate_column_names_rejected(self):
        with pytest.raises(ValueError, match="duplicate column name"):
            CreateTableBody(
                table="t",
                columns=[{"name": "a", "type": "TEXT"}, {"name": "A", "type": "TEXT"}],
            )

    @pytest.mark.parametrize("name", sorted(RESERVED_TABLES))
    def test_every_reserved_name_is_rejected(self, name):
        with pytest.raises(ValueError, match="reserved"):
            CreateTableBody(table=name, columns=[{"name": "c", "type": "TEXT"}])

    def test_unknown_column_keys_are_ignored_not_rejected(self):
        # A newer client must not break an older server.
        body = CreateTableBody(
            table="t", columns=[{"name": "c", "type": "TEXT", "collation": "NOCASE"}]
        )
        assert body.columns[0]["name"] == "c"

    def test_overlong_default_rejected(self):
        with pytest.raises(ValueError, match="too long"):
            CreateTableBody(
                table="t", columns=[{"name": "c", "type": "TEXT", "default": "x" * 501}]
            )

    def test_error_message_lists_allowed_types(self):
        with pytest.raises(ValueError, match="TEXT"):
            CreateTableBody(table="t", columns=[{"name": "c", "type": "VARCHAR(10)"}])