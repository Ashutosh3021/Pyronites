"""
The exported connection prompt, wired into the client, against a real server.

This is the exact journey the ``pyronites-wiring`` skill walks when a user
pastes the prompt from the dashboard into their coding agent: parse the
``KEY=value`` block, build a project-scoped client from it, then create,
write, read and delete rows.

It is the only test that proves the *client* and the *server* agree on the
project-scoped paths and on the row key — the two things that silently drift
apart when either side changes alone.
"""

import os
import threading
import time

import pytest
import requests

from backend.app import create_app


def _parse_prompt(text: str) -> dict:
    """Parse the KEY=value block the dashboard exports."""
    fields = {}
    for line in text.splitlines():
        if "=" not in line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        if key.strip().startswith("PYRONITES_"):
            fields[key.strip()] = value.strip()
    return fields


@pytest.fixture
def live_server(tmp_path, monkeypatch):
    """A real HTTP server so the client exercises the network path."""
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "pyrocore.db"))
    monkeypatch.setenv("PROJECTS_DIR", str(tmp_path / "projects"))
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path / "storage"))
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "false")
    monkeypatch.setenv("SESSION_COOKIE_SAMESITE", "lax")

    import uvicorn

    config = uvicorn.Config(
        create_app(), host="127.0.0.1", port=0, log_level="error", lifespan="on"
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.time() + 30
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    if not server.started:
        raise RuntimeError("the test server did not start")

    port = server.servers[0].sockets[0].getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    try:
        yield base
    finally:
        server.should_exit = True
        thread.join(timeout=10)


@pytest.fixture
def wired(live_server):
    """A project, a scoped key and the prompt the dashboard would export."""
    session = requests.Session()
    r = session.post(
        f"{live_server}/auth/signup",
        json={"email": "wire@example.com", "password": "secret123"},
    )
    assert r.status_code == 200, r.text

    r = session.post(
        f"{live_server}/api/projects",
        json={"project_id": "wireproj", "project_name": "Wire Project"},
    )
    assert r.status_code == 200, r.text
    project = r.json()

    r = session.post(
        f"{live_server}/api/projects/{project['id']}/api/keys",
        json={"name": "connect-prompt", "scopes": ["read", "write", "admin"]},
    )
    assert r.status_code == 200, r.text
    raw_key = r.json()["key"]

    r = session.get(
        f"{live_server}/api/projects/{project['id']}/connect-prompt",
        params={"base_url": live_server},
    )
    assert r.status_code == 200, r.text
    prompt = r.json()["prompt"]

    return {
        "base": live_server,
        "project": project,
        "raw_key": raw_key,
        "prompt": prompt,
        "filled": prompt.replace("PYRONITES_API_KEY=", f"PYRONITES_API_KEY={raw_key}"),
    }


def test_prompt_carries_everything_the_skill_needs(wired):
    fields = _parse_prompt(wired["filled"])
    assert fields["PYRONITES_URL"] == wired["base"]
    assert fields["PYRONITES_EMAIL"] == "wire@example.com"
    assert fields["PYRONITES_PROJECT_ID"] == wired["project"]["id"]
    assert fields["PYRONITES_PROJECT_SLUG"] == "wireproj"
    assert fields["PYRONITES_API_KEY"] == wired["raw_key"]


def test_prompt_leaves_the_key_field_blank(wired):
    fields = _parse_prompt(wired["prompt"])
    assert fields["PYRONITES_API_KEY"] == ""


def test_wiring_from_the_prompt_round_trips(wired):
    """Everything the skill's verification checklist asks for, end to end."""
    from pyronites import create_client

    fields = _parse_prompt(wired["filled"])
    client = create_client(
        url=fields["PYRONITES_URL"],
        key=fields["PYRONITES_API_KEY"],
        project_id=fields["PYRONITES_PROJECT_ID"],
    )
    try:
        assert requests.get(f"{wired['base']}/health").json()["status"] == "ok"

        client.create_table(
            "notes",
            columns=[
                {"name": "code", "type": "TEXT"},
                {"name": "title", "type": "TEXT"},
            ],
            primary_key="code",
        )
        assert any(t["name"] == "notes" for t in client.tables())

        row = client.table("notes").insert({"code": "N-1", "title": "probe"})
        assert row["code"] == "N-1"

        found = list(client.table("notes").select().eq("code", "N-1"))
        assert found and found[0]["title"] == "probe"

        client.table("notes").delete().eq("code", "N-1")
        assert list(client.table("notes").select()) == []
    finally:
        client.close()


def test_a_table_whose_key_is_not_id_is_addressable(wired):
    """The bug that made manual deletes impossible from the dashboard."""
    from pyronites import create_client

    fields = _parse_prompt(wired["filled"])
    client = create_client(
        url=fields["PYRONITES_URL"],
        key=fields["PYRONITES_API_KEY"],
        project_id=fields["PYRONITES_PROJECT_ID"],
    )
    try:
        client.create_table(
            "tickets",
            columns=[
                {"name": "uuid", "type": "TEXT"},
                {"name": "label", "type": "TEXT"},
            ],
            primary_key="uuid",
        )
        client.table("tickets").insert({"uuid": "T-9", "label": "nine"})
        assert list(client.table("tickets").select().eq("uuid", "T-9"))

        client.table("tickets").delete().eq("uuid", "T-9")
        assert list(client.table("tickets").select()) == []
    finally:
        client.close()


def test_a_scoped_key_cannot_reach_another_project(wired):
    """The whole point of scoping: no accidental cross-project writes."""
    from pyronites import AuthError, create_client

    fields = _parse_prompt(wired["filled"])
    other = requests.Session()
    r = other.post(
        f"{wired['base']}/auth/signup",
        json={"email": "other@example.com", "password": "secret123"},
    )
    assert r.status_code == 200, r.text
    r = other.post(
        f"{wired['base']}/api/projects",
        json={"project_id": "otherproj", "project_name": "Other"},
    )
    assert r.status_code == 200, r.text
    other_project = r.json()

    client = create_client(
        url=fields["PYRONITES_URL"],
        key=fields["PYRONITES_API_KEY"],
        project_id=other_project["id"],
    )
    try:
        with pytest.raises(AuthError):
            client.tables()
    finally:
        client.close()


def test_a_read_after_a_write_is_not_stale(wired):
    """The client must not serve a cached response for a repeated GET."""
    from pyronites import create_client

    fields = _parse_prompt(wired["filled"])
    client = create_client(
        url=fields["PYRONITES_URL"],
        key=fields["PYRONITES_API_KEY"],
        project_id=fields["PYRONITES_PROJECT_ID"],
    )
    try:
        client.create_table(
            "counters",
            columns=[{"name": "id", "type": "INTEGER"}, {"name": "n", "type": "INTEGER"}],
            primary_key="id",
        )
        before = list(client.table("counters").select())
        client.table("counters").insert({"id": 1, "n": 10})
        after = list(client.table("counters").select())
        assert len(before) == 0
        assert len(after) == 1
    finally:
        client.close()
