# pyronites — Client Package Architecture

> See also `docs/syntax.md` (public API) and `docs/features.md` (checklist).

Install: `pip install -e ./pyronites`

## Module layout

```text
pyronites/                 # installable root
  docs/                    # plan, features, architect, syntax
  pyproject.toml
  README.md
  pyronites/               # importable package
    __init__.py            # create_client, errors, __version__
    client.py              # PyronitesClient façade
    config.py
    http.py
    auth.py
    table.py
    storage.py             # P2
    local.py               # P3
    errors.py
  tests/
```

Apps only need:

```python
from pyronites import create_client
client = create_client()
```

## Design principles

1. Thin over clever
2. Backend is source of truth
3. Env-first secrets (`PYRONITES_URL` / `PYRONITES_KEY`)
4. Remote by default
5. Zero cost (httpx only)
6. Match existing backend API

## Backend route mapping

| Client | Backend |
|--------|---------|
| `auth.sign_up` | `POST /auth/signup` |
| `auth.sign_in` | `POST /auth/login` |
| `auth.sign_out` | `POST /auth/logout` |
| `auth.user` | `GET /auth/me` |
| `table(t).select` | `GET /tables/{t}` |
| `table(t).insert` | `POST /tables/{t}` |
| `table(t).update...` | `PATCH /tables/{t}/{id}` |
| `table(t).delete...` | `DELETE /tables/{t}/{id}` |
| `storage.*` | `/storage/*` (P2) |
