# pyronites — Client Package Plan

> Reference & checklist for building the official Python client that talks to a self-hosted PyroCore / Pyronites backend.
>
> Goal: make using Pyronites feel as simple as `supabase-py`, with **zero cost** and clear control over what stays local vs remote.

---

## 1. Why this package exists

Pyronites (the backend) already provides:

- SQLite database
- Auth (signup / login / sessions)
- Dynamic REST API for any user table
- File storage
- API keys

What is still hard for app authors (e.g. fluffy-spork):

- Writing raw `requests` / `fetch` calls everywhere
- Remembering headers, error shapes, and URLs
- Deciding what data is local vs remote
- Wiring `.env` secrets cleanly on deploy

This package solves that. One import, a small config, then simple method calls.

---

## 2. Success criteria (done when…)

Use this as the top-level checklist.

- [ ] Installable via `pip install pyronites` (or `pip install -e .` from this repo during development)
- [ ] Reads config from environment variables (Supabase-style) and optional local config file
- [ ] Can sign up, log in, log out, and report the current user against a live Pyronites backend
- [ ] Can insert / select / update / delete rows on any table via a table API
- [ ] Can upload / list / download / delete files via storage API
- [ ] Supports a clear **local vs remote** policy (v1: everything remote by default; local is opt-in)
- [ ] Works in a real project (fluffy-spork) without that project knowing HTTP details
- [ ] Zero mandatory paid services — only needs the user’s own Pyronites URL + API key or session
- [ ] Documented with a short “5-minute client setup” section

---

## 3. Phased build plan

### Phase P1 — Core client (must ship first)

**Scope**

- Package layout and packaging (`pyproject.toml`)
- Config loading from env (and optional file)
- HTTP transport (base URL, API key header, session cookie support, uniform errors)
- Auth methods: signup, login, logout, me
- Table methods: select, insert, update, delete
- Minimal docs + one end-to-end example against a live backend

**Done when**

- [ ] `from pyronites import create_client` works
- [ ] Login + insert + select succeed against `https://pyrocore-backend.onrender.com` (or local)
- [ ] Errors are readable (not raw stack traces for expected 4xx)

**Out of scope for P1**

- Local cache / offline mode
- Realtime / websockets
- Type generation from schema
- Async client

---

### Phase P2 — Storage + ergonomics

**Scope**

- Storage: upload, list, download, delete
- Query helpers (filters, limit, order) aligned with backend capabilities
- Better error types (`AuthError`, `NotFoundError`, `ApiError`)
- Retry on transient network failures (optional, conservative)

**Done when**

- [ ] File round-trip works from the client
- [ ] Common table queries do not require raw SQL for simple cases

---

### Phase P3 — Local vs remote policy

**Scope**

- Config attributes that declare:
  - which tables (or keys) are **remote-only**
  - which may be **cached locally**
  - which are **local-only** (never sent to Pyronites)
- Simple local store (e.g. SQLite file or JSON) for cache / local-only data
- Explicit sync points (pull / push) — no magic background sync in v1 of this phase

**Done when**

- [ ] A project can mark e.g. `ping_history` as remote and a small settings blob as local
- [ ] Behaviour is documented and predictable (no silent data loss)

---

### Phase P4 — Polish & publish

**Scope**

- PyPI name reservation / publish (`pyronites`)
- Versioning and changelog
- fluffy-spork migration example (replace in-memory store)
- Optional async client if demand exists

**Done when**

- [ ] `pip install pyronites` works for a third party
- [ ] fluffy-spork can run with persistence via the package

---

## 4. Config model (checklist)

### Environment variables (deploy-time, like Supabase)

| Variable | Required | Purpose |
|----------|----------|--------|
| `PYRONITES_URL` | Yes | Backend base URL, e.g. `https://pyrocore-backend.onrender.com` |
| `PYRONITES_KEY` | Yes* | API key (`pyro_live_...`) for server-side or service access |
| `PYRONITES_ANON_KEY` | Optional | If we later split public vs service keys |

\* For pure user-session flows, key may be optional if only cookie/session auth is used; for server apps like fluffy-spork, key is the normal path.

### Optional local config file (e.g. `pyronites.toml` or attributes in project)

| Setting | Purpose |
|---------|--------|
| `url` / `key` | Override or supplement env |
| `local_tables` | Names that must never leave the device |
| `remote_tables` | Names that always go to Pyronites |
| `cache_tables` | Names that may be cached locally after remote read |
| `local_db_path` | Path for local SQLite/JSON cache |

**Rule for v1:** if a table is not listed, default = **remote**. Local is opt-in so students do not accidentally build split-brain data.

---

## 5. Public API sketch (stable target)

This is the shape apps should write toward. Implementation can grow underneath.

```text
from pyronites import create_client

client = create_client()   # reads PYRONITES_URL + PYRONITES_KEY from env

# Auth
client.auth.sign_up(email, password)
client.auth.sign_in(email, password)
client.auth.sign_out()
client.auth.user()         # current user or None

# Tables
client.table("notes").select()
client.table("notes").insert({...})
client.table("notes").update({...}).eq("id", "...")
client.table("notes").delete().eq("id", "...")

# Storage (P2)
client.storage.upload(path_or_file)
client.storage.list()
client.storage.download(file_id)
client.storage.remove(file_id)
```

No requirement for apps to know `/tables/...` or header names.

---

## 6. Relationship to the backend repo

| Location | Role |
|----------|------|
| `backend/` in Pyronites repo | Server (source of truth) |
| `package/` in Pyronites repo | Client design docs + (later) client source |
| App repos (fluffy-spork, etc.) | Depend on the published package or a path install |

The package **never** embeds the SQLite file. It only speaks HTTP to the backend the user hosts.

---

## 7. Non-goals (explicit)

Do not expand scope into these without a new plan revision:

- Replacing the dashboard
- Implementing a second database engine inside the client
- OAuth / social login in the client (backend does not offer it yet)
- Multi-tenant SaaS control plane
- Guaranteed offline-first CRDT sync

---

## 8. Working rules while building

1. **No guesswork against the live API** — match existing backend routes and error envelope (`code`, `message`).
2. **Phase gates** — finish P1 checklist before starting P2.
3. **fluffy-spork is the proving ground** — if the package cannot replace in-memory storage there, it is not done.
4. **Zero cost remains sacred** — no dependency that forces a paid cloud API.

---

## 9. Document map

| File | Use |
|------|-----|
| `package/plan.md` | This file — phases, success criteria, non-goals |
| `package/features.md` | Feature-level checklist (what the package must do) |
| `package/architect.md` | Architecture, modules, data flow, security |

Update all three when a phase decision changes.
