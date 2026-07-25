# PYRO-CORE — Open Source Backend Platform for Small Projects

> A free, open-source, self-hosted backend platform for students, hobbyists, and indie developers building projects with fewer than ~100 users. No paid tiers. No hosted database bills. You own your data.

## Why this exists

Platforms like Supabase and Firebase are excellent — until you cross a free-tier limit on a college project that will never have more than a handful of users. This project exists so that a student can spin up a real backend (database, auth, storage, API) in minutes, run it on their own laptop or a free-tier VM, and never think about a pricing page.

## Core Ideas

- **SQLite as the storage engine** — a single embedded database file, zero hosting cost, ACID-compliant, SQL-native. WAL mode handles concurrent access safely out of the box.
- **CLI-first workflow** — init a project, manage schema/migrations, and connect frameworks from the terminal.
- **Dashboard (Web App / PWA)** — a Supabase-style visual layer: table explorer, SQL editor, auth management, storage, logs, and settings.
- **REST API** — auto-generated from your schema, so any framework can talk to your backend with plain HTTP calls. No mandatory SDK.
- **PostgreSQL compatibility as a future goal** — SQLite today, with a clear migration path once a project outgrows single-node scale.

## Who this is for

Students, beginners, and indie developers building personal or college projects — not production apps expecting thousands of concurrent users. If your project outgrows ~100 users or needs multi-region availability, this project's docs will point you toward migrating to Postgres.

## Status

**MVP complete** (Phases 1–4).

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Core backend (SQLite, auth, dynamic REST, API keys) | Done |
| 2 | Dashboard (tables, SQL editor, users, keys, logs) | Done |
| 3 | File storage + scheduled backups | Done |
| 4 | Docker + free-tier deploy (Render / Fly / Vercel) | Done |

See `docs/PLAN.md` for the full roadmap and `docs/ARCHITECTURE.md` for technical design.

---

## 5-minute local quick start

**Prerequisites:** Python 3.11+, Node 18+ (for the dashboard).

### 1. Backend

```bash
git clone https://github.com/Ashutosh3021/Pyronites.git
cd Pyronites

# Install
pip install -e ".[dev]"

# Start the API (creates pyrocore.db + runs migrations automatically)
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000/health — you should see `{"status":"ok","database":true}`.

### 2. Dashboard

```bash
cd frontend
npm install   # or pnpm install
npm run dev
```

Open http://localhost:3000 → sign up → create a table → start building.

### 3. Talk to the API from your app

```bash
# After signing up in the dashboard, create an API key (API Keys page).
# Then from any client:

curl -H "Authorization: Bearer pyro_live_..." \
  http://localhost:8000/tables/your_table
```

Or use plain `fetch` / `requests` against `/tables/...`, `/storage/...`, etc.

### Docker (one command)

```bash
cp .env.example .env
docker compose up --build
```

API: http://localhost:8000 — data lives in the `pyrocore-data` volume.

---

## Deploy (free tier)

Full guide: **[docs/DEPLOY.md](docs/DEPLOY.md)**

Short version:

1. **Backend → Render**  
   Connect the repo as a Blueprint (`render.yaml`). Set `FRONTEND_ORIGIN`, cookie env vars, and optionally `S3_*` for free-tier persistence.

2. **Frontend → Vercel**  
   Import the repo, set `NEXT_PUBLIC_API_URL` to your Render URL, deploy.

3. Open the Vercel URL, sign up, and use the dashboard.

For real (non-demo) data on free tier, enable **S3/R2 sync** (see docs/DEPLOY.md §10.1). On a paid Render plan, just attach a disk at `/data`.

---

## Components

| Component | Description |
|---|---|
| **CLI / Python package** | Create/manage projects, schema & migrations, connect apps |
| **Dashboard** | Table explorer, SQL editor, auth, API keys, storage, logs, settings |
| **Core engine** | SQLite (WAL) + REST API + session auth + file storage + backups |

## Design Principles

1. **Don't rebuild solved problems.** Password hashing (argon2), SQL (SQLite), containers (Docker).
2. **Zero cost by default.** No paid service required for the MVP.
3. **Data ownership.** Your data is a file you control.
4. **Honest tradeoffs.** Single-node. Docs say when to migrate to Postgres.
5. **Simple now, extensible later.**

## License

Open source (license TBD — MIT or Apache 2.0 recommended).

## Contributing

Core is stable enough for outside contributions. Open an issue or PR.
