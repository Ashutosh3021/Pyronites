# Architecture

## 1. Overview

The platform has three layers:

```
┌─────────────────────────────────────────────────┐
│                   Dashboard (Web/PWA)             │
│   Table explorer · SQL editor · Auth · Storage ·  │
│   API keys · Settings · Logs                      │
└───────────────────────┬───────────────────────────┘
                         │  REST API
┌───────────────────────┴───────────────────────────┐
│                     Core Server                    │
│   Auth service · REST API generator · Query        │
│   execution · Backup scheduler · File storage       │
└───────────────────────┬───────────────────────────┘
                         │
┌───────────────────────┴───────────────────────────┐
│              SQLite (WAL mode) — project.db         │
└─────────────────────────────────────────────────────┘

              ▲
              │  managed by
┌─────────────┴───────────────────────────────────────┐
│                    CLI (Python package)               │
│   init · db push/migrate · backup/restore · connect   │
└─────────────────────────────────────────────────────┘
```

Frameworks (Next.js, Python apps, Prisma, Vercel deployments) talk to the **Core Server's REST API** directly. The CLI is a management/config tool, not a runtime dependency of the deployed app.

---

## 2. Storage Layer

**Engine:** SQLite, `journal_mode=WAL`, `synchronous=NORMAL`.

**Why SQLite over the original Excel proposal:**

| Requirement | Excel | SQLite |
|---|---|---|
| SQL querying | Not native — requires building a query engine | Native |
| Concurrent writes | Unsafe, file-locking issues | WAL mode handles this correctly |
| Transactions / ACID | None | Built-in |
| Relationships (foreign keys) | Manual, error-prone | Native `FOREIGN KEY` support |
| Crash safety | High corruption risk | WAL + rollback journal |
| Path to Postgres | None | Well-documented migration tooling exists |
| Performance at ~100 users | Poor | Comfortably sufficient |

**Physical storage:** the entire database is a single file (`project.db`) on disk, wherever the server process runs (student's laptop, free-tier VM, college server).

**Backups:**
- Scheduled job (interval configurable, default e.g. every 15 min) calls SQLite's built-in `.backup` API to safely copy the live database to a separate location (different disk/path, ideally a cloud bucket long-term) without corrupting in-progress writes.
- Retention: keep last N (e.g. 5–10) timestamped backups, roll off older ones.
- `<cli> backup` / `<cli> restore` expose this manually as well.
- Before any destructive raw SQL command run via the dashboard's SQL editor (`DROP`, `DELETE`, `TRUNCATE`), trigger an automatic backup first.

**Known limitations (documented, not hidden):**
- Single point of failure (one file, one machine) — mitigated by backups, not eliminated.
- No built-in replication/multi-region — out of scope for v1; Litestream (open-source SQLite replication to S3-compatible storage) is a candidate for a later version.
- Single-writer concurrency ceiling — fine at ~100 users; a documented signal to migrate to Postgres if exceeded.

---

## 3. Auth

- **Password hashing:** `argon2` (via `argon2-cffi`).
- **Session model:** opaque random session tokens stored in a `sessions` table (`id`, `user_id`, `expires_at`, `created_at`), delivered via httpOnly cookies. Chosen over JWTs for v1 because revocation is a simple row delete, and there's no signing-key infrastructure to manage.
- **Tables:** `users` (id, email, password_hash, created_at, ...), `sessions`.
- **Deferred to v2:** OAuth providers (Google/GitHub), email verification, password reset flows, JWT-based stateless auth (only if a future need for cross-service auth arises).

---

## 4. REST API Layer

- Auto-generated from the schema: each table gets standard endpoints, e.g.
  - `GET /tables/:table` — list rows (with basic filter/pagination query params)
  - `GET /tables/:table/:id`
  - `POST /tables/:table`
  - `PATCH /tables/:table/:id`
  - `DELETE /tables/:table/:id`
- Auth-protected via API keys (project settings) and/or session cookies for dashboard use.
- No mandatory client SDK for v1 — any framework can call these endpoints with plain HTTP. A thin JS/Python convenience SDK is a v2+ wrapper around this same API, not a separate system.

---

## 5. Dashboard (Web App / PWA)

Pages/modules:
- **Database explorer** — browse tables/rows, runs `SELECT` queries under the hood.
- **SQL editor** — raw SQL execution against the DB, with destructive-query confirmation + auto-backup guard.
- **Auth management** — view/manage users, sessions.
- **API key management** — create/revoke keys scoped to a project.
- **Storage management** — manage uploaded files (see §7).
- **Project settings** — general config, connection details.
- **Logs & monitoring** — request logs, error logs, basic usage stats.

Table creation in the dashboard is implemented as a form that generates and runs the same `CREATE TABLE` SQL a developer could write by hand — there is one underlying mechanism, not two.

---

## 6. CLI

Planned commands (see `PLAN.md` for phased delivery):
- `init <project>` — scaffold a new project, generate config file
- `db push` — apply schema/migrations to the SQLite file
- `db migrate` — generate/apply migration files
- `connect <framework>` — generate framework-specific config (Next.js, Python, Prisma)
- `start` — run the core server + dashboard locally
- `backup` / `restore` — manual backup operations
- `keys create/revoke` — manage API keys from the terminal

---

## 7. Storage (Files/Objects)

- v1: local filesystem storage under a project directory, tracked via a `files` table (id, path, size, uploaded_at, owner).
- v2+: pluggable backend to support S3-compatible object storage for cloud deployments, without changing the API surface.

---

## 8. Deployment

- Primary target: local machine (laptop) for development/personal use — zero setup beyond the CLI.
- "Always-on" path: single Docker image bundling the core server + dashboard, deployable to free tiers (Render, Fly.io, Railway) with a persistent volume for `project.db`.
- The server is designed stateless-except-for-the-database-file, so it can move between hosts by moving one file.

---

## 9. Future / Postgres Migration Path

- Schema and query patterns will be kept close to standard SQL (avoiding SQLite-only syntax where reasonably possible) to ease a future SQLite → PostgreSQL migration.
- A dedicated `<cli> migrate-to-postgres` tool is a candidate for a later roadmap phase once demand appears (see `PLAN.md`, Phase 3+).

---

## 10. Explicit Non-Goals for v1

- Multi-region / horizontal scaling
- Real-time subscriptions
- Background job queues
- OAuth login
- Row-level permissions/roles
- Custom client SDKs beyond the raw REST API
