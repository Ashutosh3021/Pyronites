# pyronites — Client Package Architecture

> Architecture reference for the Python client package.  
> Explains how the package fits the overall system, internal modules, data flow, and security boundaries.

---

## 1. System context

```text
┌─────────────────────────────┐
│  App (e.g. fluffy-spork)    │
│  Flask / FastAPI / script   │
└──────────────┬──────────────┘
               │  imports
               ▼
┌─────────────────────────────┐
│  pyronites (this package)   │
│  config · auth · table ·    │
│  storage · (optional local) │
└──────────────┬──────────────┘
               │  HTTPS + API key / session
               ▼
┌─────────────────────────────┐
│  Pyronites backend          │
│  FastAPI + SQLite + files   │
│  (self-hosted / Render)     │
└─────────────────────────────┘
```

**Important:** The package is a **client only**. It does not open `pyrocore.db` on disk. The backend owns the database file. This matches Supabase: the SDK talks to an API, not to Postgres sockets from the browser/app blindly.

---

## 2. Design principles

1. **Thin over clever** — Prefer straightforward HTTP wrappers over hidden magic.
2. **Backend is source of truth** for remote data — Client does not invent schema rules the server does not enforce.
3. **Env-first secrets** — URL and keys come from environment in production; never hardcode.
4. **Remote by default** — Local storage is opt-in so behaviour stays predictable for students.
5. **Zero cost** — Dependencies stay small; no paid third-party API required.
6. **Match existing API** — Paths, auth headers, and `{code, message}` errors follow the live backend contract.

---

## 3. Recommended module layout

```text
pyronites/
  __init__.py          # export create_client, version
  client.py            # PyronitesClient façade
  config.py            # load env + explicit kwargs + policy
  http.py              # transport, headers, error parsing
  auth.py              # AuthClient (sign_up, sign_in, ...)
  table.py             # TableQuery / Table API
  storage.py           # StorageClient (Phase P2)
  local.py             # local store + policy (Phase P3)
  errors.py            # ApiError, AuthError, NotFoundError, ...
```

Apps only need:

```text
from pyronites import create_client
client = create_client()
```

Everything else is internal or accessed via `client.auth`, `client.table(...)`, `client.storage`.

---

## 4. Component responsibilities

### 4.1 `config.py`

- Resolve `url` and `key` from arguments and environment
- Normalize URL (strip trailing slash)
- Hold optional local/remote table policy (P3)
- Fail fast with a clear message if required config is missing

### 4.2 `http.py`

- Own the single HTTP session (`httpx.Client` or `requests.Session`)
- Attach `Authorization` when key present
- Map status codes + body to `errors.py` exceptions
- Shared by auth, table, storage (one connection policy, one timeout policy)

### 4.3 `auth.py`

- Call backend auth routes
- Keep session state on the client instance after login (token and/or cookies)
- Expose `user()` from `/auth/me` or last login payload as documented

### 4.4 `table.py`

- Build paths under `/tables/{name}`
- Chainable or simple methods for select/insert/update/delete
- Translate filters to whatever the backend supports today (start with id-based update/delete; extend when backend query params exist)

### 4.5 `storage.py`

- Multipart upload to `/storage/upload`
- List / delete / download helpers
- Return metadata dicts consistent with backend `_record_to_dict` shape

### 4.6 `local.py` (Phase P3)

- Small local SQLite or JSON store
- Consult policy before every table operation:
  - local-only → local store only
  - remote-only → HTTP only
  - cache → read path may use local; writes follow documented policy
- Must never silently drop remote writes

### 4.7 `errors.py`

- `ApiError` — generic non-2xx with `code` and `message`
- `AuthError` — 401/403 class
- `NotFoundError` — 404
- Preserve backend `code` string for programmatic handling

---

## 5. Data flow

### 5.1 Server app with API key (fluffy-spork style)

```text
App route
  → client.table("services").insert(payload)
    → http.py adds Bearer API key
      → POST /tables/services
        → backend SQLite
      ← JSON row
    ← dict to app
```

Auth of *end users* can still use `client.auth.sign_in`; the **service** may use the key for table access after the user is known, or use the user session if the backend associates sessions with row ownership later.

### 5.2 User session flow

```text
App login form
  → client.auth.sign_in(email, password)
    → POST /auth/login
    ← session established on client
  → client.table("notes").select()
    → request carries session and/or key
    ← rows
```

### 5.3 Local vs remote decision (P3)

```text
client.table("X").insert(row)
  → policy.lookup("X")
       ├─ local_only  → local.py write → return
       ├─ remote      → http.py → backend → return
       └─ cache       → (policy-defined) local +/or remote
```

---

## 6. Mapping to backend routes

| Client method | Backend (approximate) |
|---------------|------------------------|
| `auth.sign_up` | `POST /auth/signup` |
| `auth.sign_in` | `POST /auth/login` |
| `auth.sign_out` | `POST /auth/logout` |
| `auth.user` | `GET /auth/me` |
| `table(t).select` | `GET /tables/{t}` |
| `table(t).insert` | `POST /tables/{t}` |
| `table(t).update...` | `PATCH /tables/{t}/{id}` |
| `table(t).delete...` | `DELETE /tables/{t}/{id}` |
| `storage.upload` | `POST /storage/upload` |
| `storage.list` | `GET /storage` |
| `storage.download` | `GET /storage/{id}/download` |
| `storage.remove` | `DELETE /storage/{id}` |

If a backend path changes, update this table and the client in the same change set.

---

## 7. Security architecture

| Concern | Approach |
|---------|----------|
| API key | From env; never commit; never put in client-side public frontend without accepting risk |
| Passwords | Only sent over HTTPS to `/auth/*`; not stored by the package |
| Logging | Strip `Authorization` and password fields from any debug logs |
| Local store (P3) | File permissions are the host OS’s problem; document that local DB may hold sensitive cache |
| SQL escape hatch | Only with admin-capable key; document danger |
| Trust model | Same as using Supabase key: anyone with the key can read/write per key scopes |

**Frontend note:** A pure browser app should not embed a powerful `pyro_live_` service key. Prefer user login (session) or a backend-for-frontend (fluffy-spork style) that holds the key on the server.

---

## 8. Config surface (architecture view)

```text
create_client(
  url=None,              # else PYRONITES_URL
  key=None,              # else PYRONITES_KEY
  timeout=30,
  # --- Phase P3 ---
  local_tables=None,
  remote_tables=None,
  cache_tables=None,
  local_db_path=None,
)
```

Resolution order:

1. Explicit constructor argument  
2. Environment variable  
3. Built-in default (only where safe, e.g. timeout)

---

## 9. Error handling architecture

```text
HTTP 2xx → return parsed JSON (dict/list/bytes)
HTTP 4xx/5xx → parse {code, message} if present → raise ApiError subclass
Network failure → raise transport error (wrap original exception)
```

Apps should catch `AuthError` vs `NotFoundError` when they need branching; otherwise catch `ApiError`.

---

## 10. Versioning & compatibility

- **Client major version** may bump when public method names break
- **Backend** remains independent; client should tolerate extra JSON fields
- Document minimum backend capabilities per client version (e.g. “requires tables API + auth routes as of Pyronites MVP”)

---

## 11. Testing architecture

| Layer | What |
|-------|------|
| Unit | Mock transport; assert URLs, headers, error mapping |
| Integration | Real backend on localhost or CI service; signup → insert → select → delete |
| Manual | REPL script in docs against Render URL |

Do not require paid cloud services for CI.

---

## 12. Evolution path

| Stage | Architecture state |
|-------|--------------------|
| P1 | `client` + `config` + `http` + `auth` + `table` + `errors` |
| P2 | + `storage` |
| P3 | + `local` + policy in `config` |
| P4 | Published package; optional async twin module if needed |

Each stage must keep the same façade (`create_client`) so apps do not rewrite imports.

---

## 13. Checklist before coding a module

- [ ] Which backend routes does it call? (update section 6 if new)
- [ ] What public methods does the app see?
- [ ] What errors can it raise?
- [ ] Does it need config beyond URL/key?
- [ ] Is any secret logged or returned?
- [ ] Is it covered in `features.md` with a checkbox?

---

## 14. Summary

The **pyronites** package is a thin, env-configured HTTP client with a Supabase-like façade.  
The **Pyronites backend** remains the database and auth authority.  
Local storage is a later, explicit policy layer — not the default.  
This keeps student projects simple, free, and portable across any host that runs the backend.
