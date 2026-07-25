# pyronites — Client Package Features

> Feature checklist for the Python client.  
> Use this while implementing and reviewing PRs.  
> Status legend: `[ ]` not started · `[~]` partial · `[x]` done

---

## F0 — Packaging & project layout

- [ ] Package name: `pyronites`
- [ ] Installable in development: `pip install -e ./package` (or repo root layout TBD)
- [ ] `pyproject.toml` with runtime deps kept minimal (`httpx` or `requests`, typing)
- [ ] Public import surface: `from pyronites import create_client`
- [ ] Version string available (`pyronites.__version__`)
- [ ] License aligned with main repo when chosen

---

## F1 — Configuration

### F1.1 Environment variables

- [ ] `PYRONITES_URL` — backend base URL (no trailing slash required; normalize in client)
- [ ] `PYRONITES_KEY` — API key for `Authorization: Bearer ...`
- [ ] Optional overrides documented in package README
- [ ] Clear error if URL is missing when creating client

### F1.2 Programmatic config

- [ ] `create_client(url=..., key=...)` allows explicit args (override env)
- [ ] Args win over env when both are present (documented)

### F1.3 Local vs remote policy (Phase P3)

- [ ] Config for `remote_tables` (default: all tables remote)
- [ ] Config for `local_tables` (never sent to backend)
- [ ] Config for `cache_tables` (optional local cache after remote read)
- [ ] Config for local store path
- [ ] Default policy documented: **remote unless listed otherwise**

---

## F2 — HTTP transport

- [ ] Single internal client used by auth, table, storage modules
- [ ] Base URL joining without double slashes
- [ ] Sends `Authorization: Bearer <key>` when key is set
- [ ] Optional session cookie jar for browser-like login flows (if needed for cookie auth)
- [ ] Parses backend error envelope `{ "code", "message" }` into typed errors
- [ ] Timeouts configurable (sensible default, e.g. 30s)
- [ ] Does not log secrets (keys, passwords)

---

## F3 — Auth features

Map to backend: `/auth/signup`, `/auth/login`, `/auth/logout`, `/auth/me` (and related).

- [ ] `client.auth.sign_up(email, password)`
- [ ] `client.auth.sign_in(email, password)`
- [ ] `client.auth.sign_out()`
- [ ] `client.auth.user()` → current user dict or `None`
- [ ] Session/token retained on the client instance after sign-in for subsequent calls
- [ ] Sign-in failure does not leak whether email exists (rely on backend behaviour)
- [ ] Works with API key–only mode (no user session) for server apps that only use table access

**Checklist for fluffy-spork auth migration**

- [ ] Replace in-memory user store signup with `sign_up`
- [ ] Replace login with `sign_in`
- [ ] Profile/me uses `user()` or table read as designed

---

## F4 — Table (database) features

Map to backend: `/tables/{name}`, `/tables/{name}/{id}`, etc.

### F4.1 Core CRUD

- [ ] `client.table(name).select()` — list rows (respect backend pagination if any)
- [ ] `client.table(name).insert(row_dict)` — create one row
- [ ] `client.table(name).insert(list_of_dicts)` — optional bulk if backend allows; else document loop
- [ ] `client.table(name).update(data).eq("id", value)` — update by id (minimum)
- [ ] `client.table(name).delete().eq("id", value)` — delete by id (minimum)
- [ ] `client.table(name).select().eq("column", value)` — simple filter if backend supports query params; otherwise document SQL path

### F4.2 Behaviour rules

- [ ] Table name validation / safe encoding in URL path
- [ ] JSON body encoding UTF-8
- [ ] Returns Python dicts / lists (not raw Response objects) on success
- [ ] Raises on non-2xx with message from backend when present

### F4.3 SQL escape hatch (optional but useful)

- [ ] `client.sql(query)` or `client.rpc_sql(query)` mapping to `/sql/execute` for admin-scoped keys only
- [ ] Documented as advanced / dangerous (same warnings as dashboard SQL editor)

---

## F5 — Storage features (Phase P2)

Map to backend: `/storage/upload`, `/storage`, `/storage/{id}`, `/storage/{id}/download`.

- [ ] `client.storage.upload(file)` — path, file object, or bytes + filename
- [ ] `client.storage.list()`
- [ ] `client.storage.download(file_id)` → bytes or save-to-path helper
- [ ] `client.storage.remove(file_id)`
- [ ] Propagates file-too-large and invalid-filename errors clearly

---

## F6 — Local vs remote features (Phase P3)

- [ ] Remote-only tables: all operations hit network
- [ ] Local-only tables: read/write only local store; never call backend
- [ ] Cached tables: read may serve cache; write policy documented (write-through vs write-local-then-sync)
- [ ] Explicit `client.sync(table=...)` or `client.pull` / `client.push` — no hidden full DB mirror in v1
- [ ] Conflict policy documented (v1: last-write-wins or “remote wins” — pick one and stick to it)

---

## F7 — Developer experience

- [ ] Short README in package: install, env vars, 10-line example
- [ ] Type hints on public methods
- [ ] Docstrings on public API
- [ ] Example script that runs against local backend or Render URL
- [ ] Changelog file when versioning starts

---

## F8 — Safety & quality

- [ ] No password or API key in exception messages
- [ ] Unit tests with mocked HTTP for auth + table happy paths
- [ ] One integration test path documented (manual or CI against local uvicorn)
- [ ] Compatible with Python 3.10+ (or version decided in plan)

---

## F9 — Integration targets (acceptance)

- [ ] **Manual Python REPL** — same as the successful notes demo, but via package API
- [ ] **fluffy-spork** — services + history persisted in Pyronites through the package
- [ ] **Any future student app** — only needs env + `create_client()`

---

## Feature priority order

1. F0 Packaging  
2. F1.1 + F1.2 Config  
3. F2 Transport  
4. F3 Auth  
5. F4.1 Table CRUD  
6. F7 Docs example  
7. F5 Storage  
8. F1.3 + F6 Local/remote  
9. F8 Tests & harden  
10. Publish (plan Phase P4)

---

## Explicit non-features (do not implement without new approval)

- OAuth / social providers
- Realtime subscriptions
- Auto-generated ORM models from SQL schema
- Multi-region client routing
- Built-in UI components
