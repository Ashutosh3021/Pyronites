# pyronites — Syntax & Usage Guide

> **This is the public contract.**  
> Apps write against this surface. Implementers treat it as the source of truth for method names, argument shapes, return types, and behaviour.  
> When code and this document disagree, update both in the same change.

Phases are marked so we ship in order (P1 first).

---

## 1. Install & import

```bash
# Development (from repo root, once package layout exists)
pip install -e ./package

# Later (published)
pip install pyronites
```

```python
from pyronites import create_client

client = create_client()          # reads env
# or
client = create_client(
    url="https://your-backend.example.com",
    key="pyro_live_...",
)
```

Public surface is intentionally small:

```python
from pyronites import create_client
# optionally:
from pyronites import ApiError, AuthError, NotFoundError
```

Version:

```python
import pyronites
print(pyronites.__version__)
```

---

## 2. Configuration

### Environment variables (preferred in production)

| Variable         | Required | Meaning                                      |
|------------------|----------|----------------------------------------------|
| `PYRONITES_URL`  | Yes*     | Backend base URL (trailing slash stripped)   |
| `PYRONITES_KEY`  | Yes*     | API key → sent as `Authorization: Bearer …`  |

\* Required for the normal server-side path. Pure user-session scripts can omit the key if they only use cookie auth after `sign_in`.

### Constructor

```python
create_client(
    url: str | None = None,       # overrides PYRONITES_URL
    key: str | None = None,       # overrides PYRONITES_KEY
    timeout: float = 30.0,        # seconds
    # --- Phase P3 only ---
    local_tables: list[str] | None = None,
    remote_tables: list[str] | None = None,
    cache_tables: list[str] | None = None,
    local_db_path: str | None = None,
)
```

**Resolution order**

1. Explicit argument  
2. Environment variable  
3. Safe built-in default (only for `timeout`)

Missing URL → clear, immediate error at `create_client()` time.

**Security**

- Never hard-code keys in source.  
- Never put a powerful `pyro_live_…` service key in a public frontend.  
- Prefer a backend-for-frontend (or server-only process) that holds the key.

---

## 3. Auth (`client.auth`) — Phase P1

```python
client.auth.sign_up(email: str, password: str) -> dict
client.auth.sign_in(email: str, password: str) -> dict
client.auth.sign_out() -> None
client.auth.user() -> dict | None
```

### Behaviour

| Method     | Backend                  | Returns                          | Notes |
|------------|--------------------------|----------------------------------|-------|
| `sign_up`  | `POST /auth/signup`      | `{id, email, created_at}`        | Starts a session (cookie) |
| `sign_in`  | `POST /auth/login`       | `{email}`                        | Starts a session (cookie) |
| `sign_out` | `POST /auth/logout`      | `None`                           | Clears local session state + cookie |
| `user`     | `GET /auth/me`           | `{authenticated, email}` or `None` | `None` when not authenticated |

After a successful `sign_in` / `sign_up` the client keeps the session cookie for subsequent requests (cookie jar).  
API-key mode (no login) continues to work for table/storage access when the key has the required scopes.

**Secure defaults**

- Passwords are never logged or stored by the package.  
- On failure the client raises `AuthError` (does not invent friendlier messages that could leak account existence — we surface the backend message).

### Minimal example

```python
client = create_client()

client.auth.sign_up("alice@example.com", "correct-horse-battery")
# or
client.auth.sign_in("alice@example.com", "correct-horse-battery")

me = client.auth.user()
print(me)   # {"authenticated": True, "email": "alice@example.com"}

client.auth.sign_out()
assert client.auth.user() is None
```

---

## 4. Tables (`client.table(name)`) — Phase P1

```python
t = client.table("notes")   # returns a TableQuery / Table handle
```

### Core methods

```python
# List (optional simple equality filter)
rows: list[dict] = client.table("notes").select()
rows = client.table("notes").select().eq("status", "open")
rows = client.table("notes").select().eq("status", "open").limit(20).offset(0)

# Single row by id (convenience)
row: dict = client.table("notes").select().eq("id", "uuid-here").single()
# or (future-friendly alias)
row = client.table("notes").get("uuid-here")

# Insert one
row = client.table("notes").insert({"title": "Hello", "body": "World"})

# Insert many (client loops if backend has no bulk endpoint)
rows = client.table("notes").insert([
    {"title": "A"},
    {"title": "B"},
])

# Update by id (minimum required by current backend)
row = client.table("notes").update({"title": "Updated"}).eq("id", "uuid-here")

# Delete by id
client.table("notes").delete().eq("id", "uuid-here")
```

### Mapping to backend (current)

| Client call                                      | Backend                                      |
|--------------------------------------------------|----------------------------------------------|
| `.select()`                                      | `GET /tables/{name}?limit=50&offset=0`       |
| `.select().eq(col, val)`                         | `…&filter_column=col&filter_value=val`       |
| `.select().limit(n).offset(m)`                   | query params `limit` / `offset`              |
| `.insert(dict)`                                  | `POST /tables/{name}`                        |
| `.update(data).eq("id", id)`                     | `PATCH /tables/{name}/{id}`                  |
| `.delete().eq("id", id)`                         | `DELETE /tables/{name}/{id}`                 |

**Rules**

- Table names and column names are validated / safely encoded; invalid identifiers raise before the request is sent when possible.  
- Success always returns plain Python `dict` / `list[dict]` (never a raw Response object).  
- Non-2xx → typed exception (see §7).  
- Update / delete currently require an `id` equality filter. Calling them without `.eq("id", …)` raises a clear client-side error.

### Pagination helpers (P1)

```python
.select().limit(50)          # default 50, max 200 (backend limit)
.select().offset(100)
```

### Optional SQL escape hatch (advanced)

```python
result = client.sql("SELECT count(*) AS n FROM notes")
# → POST /sql/execute  (requires admin-scoped key)
```

Documented as dangerous; same warnings as the dashboard SQL editor.

---

## 5. Storage (`client.storage`) — Phase P2

```python
# Upload
meta = client.storage.upload("path/to/file.pdf")
meta = client.storage.upload(open("file.pdf", "rb"), filename="file.pdf")
meta = client.storage.upload(b"raw bytes", filename="data.bin", content_type="application/octet-stream")

# List
files = client.storage.list()
files = client.storage.list(prefix="images/", limit=50, offset=0)

# Metadata
meta = client.storage.get("file-uuid")

# Download
data: bytes = client.storage.download("file-uuid")
client.storage.download("file-uuid", path="/tmp/out.pdf")   # optional save helper

# Delete
client.storage.remove("file-uuid")
```

Return shape for metadata (matches backend):

```python
{
    "id": "…",
    "original_filename": "file.pdf",
    "content_type": "application/pdf",
    "size_bytes": 12345,
    "uploaded_at": "2026-07-25T…Z",
    "project_id": "…" | None,
}
```

Errors such as invalid filename or file-too-large are raised as `ApiError` with the backend `code`.

---

## 6. Local vs remote policy — Phase P3

Default for every table: **remote**.

```python
client = create_client(
    local_tables=["settings", "drafts"],   # never leave the device
    remote_tables=["notes", "services"],  # always hit network
    cache_tables=["catalog"],             # may be served from local after remote read
    local_db_path="./.pyronites_local.db",
)
```

Behaviour summary:

| Policy        | Read                         | Write                                      |
|---------------|------------------------------|--------------------------------------------|
| remote (default) | network only              | network only                               |
| local_only    | local store only             | local store only                           |
| cache         | local if present, else remote (+ store) | documented policy (v1: write-through to remote) |

No silent background full-DB mirror. Explicit helpers (later):

```python
client.pull("catalog")
client.push("catalog")
# or
client.sync(table="catalog")
```

Conflict policy for v1: **remote wins** (document and stick to it).

---

## 7. Errors

All non-2xx responses that contain the backend envelope become typed exceptions:

```python
from pyronites import ApiError, AuthError, NotFoundError

try:
    client.table("notes").update({"x": 1}).eq("id", "missing")
except NotFoundError as e:
    print(e.code, e.message)      # "not_found", "Row not found"
except AuthError as e:
    …                             # 401 / 403 class
except ApiError as e:
    print(e.status_code, e.code, e.message)
```

Hierarchy:

```text
ApiError
├── AuthError          # 401 / 403
└── NotFoundError      # 404
```

- Network / transport failures wrap the underlying exception.  
- Secrets (key, password) are never placed in exception messages or logs.

---

## 8. Complete minimal examples

### Server-side service (API key only)

```python
import os
from pyronites import create_client

os.environ["PYRONITES_URL"] = "https://pyrocore-backend.onrender.com"
os.environ["PYRONITES_KEY"] = "pyro_live_…"

client = create_client()

# Create a note
note = client.table("notes").insert({
    "title": "First note",
    "body": "Hello from the client",
})
print(note["id"])

# List
for row in client.table("notes").select().limit(10):
    print(row["title"])

# Update & delete
client.table("notes").update({"title": "Updated"}).eq("id", note["id"])
client.table("notes").delete().eq("id", note["id"])
```

### User session flow

```python
client = create_client(url="https://…")   # key optional if only using session

client.auth.sign_in("user@example.com", "password")
print(client.auth.user())

rows = client.table("notes").select()
client.auth.sign_out()
```

### Storage round-trip (P2)

```python
meta = client.storage.upload("photo.jpg")
print(meta["id"], meta["size_bytes"])

data = client.storage.download(meta["id"])
client.storage.remove(meta["id"])
```

---

## 9. What is explicitly out of scope (for now)

Do not implement or document as public API without a plan revision:

- OAuth / social providers  
- Realtime / websocket subscriptions  
- Auto-generated ORM models  
- Async client (may come later as an optional twin)  
- Multi-region routing  
- Built-in UI components  
- Guaranteed offline-first CRDT sync

---

## 10. Implementation checklist (for us)

When coding a module, verify against this document:

- [ ] Public method name and signature match §3–§6  
- [ ] Return type is plain dict / list / bytes / None as shown  
- [ ] Errors map to the hierarchy in §7  
- [ ] No secrets in logs or exception strings  
- [ ] Backend route mapping still accurate (update this file + `architect.md` together)  
- [ ] Feature is checked off in `features.md`

---

## 11. Document map

| File                | Role                                      |
|---------------------|-------------------------------------------|
| `package/plan.md`   | Phases, success criteria, non-goals       |
| `package/features.md` | Feature-level checklist                 |
| `package/architect.md` | Internal modules, data flow, security |
| **`package/syntax.md`** | **Public API contract & usage examples (this file)** |

Keep all four in sync when the public surface changes.
