# Plan

## Guiding Principle

Ship the smallest thing that lets a student replace Supabase for a real class/personal project. Every phase should end with something usable, not just something documented.

---

## Phase 0 — Foundations (before writing app code)

- [ ] Pick project name + license (MIT or Apache 2.0 recommended)
- [ ] Set up repo structure (monorepo: `cli/`, `server/`, `dashboard/`)
- [ ] Decide REST framework for core server (e.g. FastAPI — fast, Python-native, fits CLI language)
- [ ] Decide dashboard stack (React/Next.js recommended for PWA support)

---

## Phase 1 — MVP Core (storage + API, no dashboard yet)

**Goal:** a developer can `init`, define a schema, and hit a working REST API from Next.js/Python.

- [ ] SQLite integration with WAL mode + `synchronous=NORMAL` enabled by default
- [ ] CLI: `init`, `db push` (schema → SQLite via SQL)
- [ ] Auto-generated REST API (CRUD per table)
- [ ] API key generation + auth middleware for the REST API
- [ ] Basic auth: `users` table, argon2 password hashing, session tokens (httpOnly cookies)
- [ ] CLI: `backup` / `restore` using SQLite's `.backup` API
- [ ] Scheduled auto-backup job (interval-based)
- [ ] Minimal docs: quick start, one working Next.js example, one working Python example

**Exit criteria:** a real toy project (e.g. a to-do app) can be built end-to-end using only this CLI + API, no dashboard.

---

## Phase 2 — Dashboard MVP

**Goal:** everything in Phase 1 becomes visible and manageable without touching SQL directly.

- [ ] Database explorer (browse tables/rows)
- [ ] SQL editor (raw query execution + destructive-query confirmation + auto-backup guard)
- [ ] Table creation via UI form (generates `CREATE TABLE` under the hood)
- [ ] Auth management UI (view users/sessions)
- [ ] API key management UI
- [ ] Project settings page
- [ ] Basic logs view (request/error logs)

**Exit criteria:** a non-technical-ish user can create a table, add rows, and manage API keys entirely from the browser.

---

## Phase 3 — Framework Polish + Storage

**Goal:** integration feels as smooth as Supabase's for the primary target frameworks.

- [ ] `connect` CLI command generating framework-specific config (Next.js, Python, Prisma)
- [ ] Prisma provider compatibility check/config (SQLite is natively supported by Prisma — verify and document)
- [ ] Vercel deployment guide/example
- [ ] File/object storage (local filesystem v1) + dashboard storage management page
- [ ] Docker image for "always-on" self-hosted deployment
- [ ] Deployment guide for free-tier hosts (Render/Fly.io/Railway)

**Exit criteria:** README-level "deploy this in under 10 minutes" is actually true for at least one free host.

---

## Phase 4 — Hardening & Deferred Features

Pull from this list based on real user feedback, not speculatively:

- [ ] OAuth providers (Google/GitHub login)
- [ ] Email verification, password reset flows
- [ ] Table relationship UI (reference dropdown when creating columns → visual schema diagram later)
- [ ] Logs/monitoring depth (usage stats, error tracking)
- [ ] Litestream-style continuous replication to cloud storage (optional redundancy)
- [ ] Postgres migration tool (`migrate-to-postgres`)
- [ ] Realtime subscriptions
- [ ] Background job support
- [ ] Client SDK (thin JS/Python wrapper around REST API)

---

## Explicitly Deferred (not roadmapped yet, revisit only on demand)

- Multi-region / horizontal scaling
- Row-level permissions/roles
- Enterprise-style audit logging

---

## Open Decisions (resolve before/during Phase 0–1)

1. Core server language/framework: FastAPI (Python) is the natural fit given the CLI is Python — confirm.
2. Config file format: `.toml` vs `.yaml` vs `.json` for project config.
3. Migration file format/tooling: hand-rolled vs. adopting an existing lightweight migration library.
4. License choice: MIT vs Apache 2.0.
5. Project name.

---

## Success Metric for MVP (Phases 1–2)

A student can go from `pip install` to a working authenticated CRUD API, connected to a Next.js app, viewable/manageable in a dashboard — in under 15 minutes, for $0.
