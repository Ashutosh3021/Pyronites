# pyronites — Syntax & Usage Guide

> **Public contract.** Apps write against this surface.

## Install & import

```bash
pip install -e ./pyronites
# later: pip install pyronites
```

```python
from pyronites import create_client, ApiError, AuthError, NotFoundError

client = create_client()  # reads PYRONITES_URL + PYRONITES_KEY
# or
client = create_client(url="https://...", key="pyro_live_...")
# or, scoped to one project
client = create_client(url="https://...", key="pyro_live_...", project_id="3f2b…")
```

## Config

| Variable | Meaning |
|----------|---------|
| `PYRONITES_URL` | Backend base URL |
| `PYRONITES_KEY` | API key (Bearer) |
| `PYRONITES_PROJECT_ID` | Project id — scopes every call to that project |
| `PYRONITES_LOCAL_DB` | Path for the local/cache store |

Args override env. Missing URL → clear error at create time.

## Project scoping

With a project id set, table, storage and SQL calls are rewritten to
`/api/projects/{project_id}/...`. A project-scoped key can only reach the
project it was minted for, so the client cannot write to the wrong database by
accident.

## Auth (P1)

```python
client.auth.sign_up(email, password) -> dict
client.auth.sign_in(email, password) -> dict
client.auth.sign_out() -> None
client.auth.user() -> dict | None
```

## Tables (P1)

```python
client.table("notes").select()
client.table("notes").select().eq("status", "open").limit(20)
client.table("notes").insert({"title": "Hello"})
client.table("notes").update({"title": "X"}).eq("id", "...")
client.table("notes").delete().eq("id", "...")
client.table("notes").get("id")
client.table("notes").schema()   # columns, types, primary key
client.tables()                  # table names + row counts
client.sql("SELECT count(*) FROM notes")  # admin key
```

Rows are addressed by the table's **primary key**, which is not always named
`id`. `update()` and `delete()` resolve the key from the schema; when the
filter column does not match it, the error names the real key.

## Table management (admin scope)

```python
client.create_table("notes", columns=[{"name": "id", "type": "TEXT"}], primary_key="id")
client.drop_table("notes")
```

## Storage (P2)

```python
client.storage.upload(...)
client.storage.list()
client.storage.download(id)
client.storage.remove(id)
```

## Errors

```python
ApiError
├─ AuthError       # 401/403
└─ NotFoundError   # 404
```

## Document map

| File | Role |
|------|------|
| `docs/plan.md` | Phases |
| `docs/features.md` | Checklist |
| `docs/architect.md` | Internals |
| `docs/syntax.md` | This file |
