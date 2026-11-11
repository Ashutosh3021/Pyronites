# pyronites

Official Python client for the [Pyronites](https://github.com/Ashutosh3021/Pyronites) backend.

Supabase-style API, zero mandatory paid services — point it at your own backend URL + API key.

## Install

```bash
# Development (from this repo)
pip install -e ./pyronites

# From PyPI (after publish)
pip install pyronites
```

Requires **Python 3.10+**.

## 5-minute setup

```bash
export PYRONITES_URL="https://your-backend.example.com"
export PYRONITES_KEY="pyro_live_..."
export PYRONITES_PROJECT_ID="3f2b…"   # optional — scopes every call to one project
```

```python
from pyronites import create_client

client = create_client()

# Auth (optional)
client.auth.sign_in("user@example.com", "password")
print(client.auth.user())

# Tables
note = client.table("notes").insert({"title": "Hello", "body": "World"})
for row in client.table("notes").select().limit(10):
    print(row)
client.table("notes").update({"title": "Updated"}).eq("id", note["id"])
client.table("notes").delete().eq("id", note["id"])

# Storage
meta = client.storage.upload("photo.jpg")
data = client.storage.download(meta["id"])
client.storage.remove(meta["id"])

# Local-only / cache tables (optional)
client = create_client(
    local_tables=["settings"],
    cache_tables=["catalog"],
    local_db_path="./.pyronites_local.db",
)
client.table("settings").insert({"theme": "dark"})
client.pull("catalog")
```

## Project scoping

PyroCore gives every project its own database. Pass the project id and the
client rewrites every table, storage and SQL call to
`/api/projects/{project_id}/...`, so a project-scoped key can never reach
another project's data.

```python
client = create_client(
    url="https://your-backend.example.com",
    key="pyro_live_...",
    project_id="3f2b…",
)
```

The same value can come from `PYRONITES_PROJECT_ID`. The dashboard exports a
ready-made connection prompt under **Connect** — it carries the backend URL,
your email, the project slug and id, and the API key to paste in.

Rows are addressed by the table's **primary key**, which is not always named
`id`. `update()` and `delete()` resolve it from the table schema; if the
filter column does not match, the error names the real key.

## Config

| Source | Variables / args |
|--------|------------------|
| Env | `PYRONITES_URL`, `PYRONITES_KEY`, optional `PYRONITES_PROJECT_ID`, `PYRONITES_LOCAL_DB` |
| Constructor | `create_client(url=..., key=..., timeout=30, project_id=..., local_tables=..., cache_tables=..., remote_tables=..., local_db_path=...)` |

Args override env. Missing URL raises a clear error at create time.

**Security:** never put a powerful service key in a public frontend.

## Public API

See [`docs/syntax.md`](docs/syntax.md).

## Development

```bash
cd pyronites
pip install -e ".[dev]"
pytest
```

## License

MIT
