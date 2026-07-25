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
```

## Config

| Variable | Meaning |
|----------|---------|
| `PYRONITES_URL` | Backend base URL |
| `PYRONITES_KEY` | API key (Bearer) |

Args override env. Missing URL → clear error at create time.

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
client.sql("SELECT count(*) FROM notes")  # admin key
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
