# PYRO-CORE — Open Source Backend Platform for Small Projects

> A free, open-source, self-hosted backend platform for students, hobbyists, and indie developers building projects with fewer than ~100 users. No paid tiers. No hosted database bills. You own your data.

## Why this exists

Platforms like Supabase and Firebase are excellent — until you cross a free-tier limit on a college project that will never have more than a handful of users. This project exists so that a student can spin up a real backend (database, auth, storage, API) in minutes, run it on their own laptop or a free-tier VM, and never think about a pricing page.

## Core Ideas

- **SQLite as the storage engine** — a single embedded database file, zero hosting cost, ACID-compliant, SQL-native. WAL mode handles concurrent access safely out of the box.
- **CLI-first workflow** — init a project, manage schema/migrations, and connect frameworks (Next.js, Python, Prisma, Vercel) from the terminal.
- **Dashboard (Web App / PWA)** — a Supabase-style visual layer: table explorer, SQL editor, auth management, storage, logs, and settings.
- **REST API** — auto-generated from your schema, so any framework can talk to your backend with plain HTTP calls. No mandatory SDK.
- **PostgreSQL compatibility as a future goal** — SQLite today, with a clear migration path once a project outgrows single-node scale.

## Who this is for

Students, beginners, and indie developers building personal or college projects — not production apps expecting thousands of concurrent users. If your project outgrows ~100 users or needs multi-region availability, this project's docs will point you toward migrating to Postgres.

## Components

| Component | Description |
|---|---|
| **CLI / Python package** | Create/manage projects, generate config files, manage schema & migrations, connect apps to the backend |
| **Dashboard** | Database explorer, SQL editor, auth management, user management, API key management, storage management, project settings, logs & monitoring |
| **Core engine** | SQLite (WAL mode) + REST API layer + session-based auth |

## Quick Start (planned CLI flow)

```bash
pip install <package-name>

# create a new backend project
<cli> init my-project

# push your schema (from a schema file, or via SQL directly)
<cli> db push

# start the local server (REST API + dashboard)
<cli> start

# back up your database
<cli> backup
```

Your app (Next.js, Python, etc.) then talks to the local REST API just like it would talk to Supabase — `fetch`/`requests` calls against auto-generated table endpoints.

## Design Principles

1. **Don't rebuild solved problems.** Password hashing (argon2), SQL execution (SQLite), containerization (Docker) — use battle-tested tools, not custom implementations.
2. **Zero cost by default.** No component in the MVP requires a paid service.
3. **Data ownership.** Your data lives in a file you control, not a vendor's cloud.
4. **Honest tradeoffs.** This is a single-node, self-hosted tool. It won't pretend to be infinitely scalable — the docs will say plainly when it's time to migrate to Postgres.
5. **Simple now, extensible later.** MVP scope is deliberately small; see `PLAN.md` for what's in v1 vs. deferred.

## Status

Early planning / pre-MVP. See `PLAN.md` for roadmap and `ARCHITECTURE.md` for technical design.

## License

Open source (license TBD — MIT or Apache 2.0 recommended for maximum adoption).

## Contributing

Not yet open for contributions — MVP is being scoped and built first. This will be updated once the core is stable enough for outside contributors.
