# PYRO-CORE — Open Source Backend Platform for Small Projects
<img src="docs\frame_000140.jpg" alt="App Preview">

> A free, open-source, self-hosted backend platform for students, hobbyists, and indie developers building projects with fewer than ~100 users. No paid tiers. No hosted database bills. You own your data.

## Why this exists

Platforms like Supabase and Firebase are excellent — until you cross a free-tier limit on a college project that will never have more than a handful of users. This project exists so that a student can spin up a real backend (database, auth, storage, API) in minutes, run it on their own laptop or a free-tier VM, and never think about a pricing page.

## Core Ideas

- **SQLite as the storage engine** — a single embedded database file, zero hosting cost, ACID-compliant, SQL-native. WAL mode handles concurrent access safely out of the box.
- **CLI-first workflow** — init a project, manage schema/migrations, and connect frameworks from the terminal.
- **Dashboard (Web App / PWA)** — a Supabase-style visual layer: table explorer, SQL editor, auth management, storage, logs, and settings.
- **REST API** — auto-generated from your schema, so any framework can talk to your backend with plain HTTP calls. No mandatory SDK.
- **Official Python client** — `pip install pyronites` for a Supabase-style API against your backend.
- **PostgreSQL compatibility as a future goal** — SQLite today, with a clear migration path once a project outgrows single-node scale.

## Who this is for

Students, beginners, and indie developers building personal or college projects — not production apps expecting thousands of concurrent users. If your project outgrows ~100 users or needs multi-region availability, this project's docs will point you toward migrating to Postgres.

## Status

**MVP complete** (Phases 1–4). **Python client published** on PyPI.

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Core backend (SQLite, auth, dynamic REST, API keys) | Done |
| 2 | Dashboard (tables, SQL editor, users, keys, logs) | Done |
| 3 | File storage + scheduled backups | Done |
| 4 | Docker + free-tier deploy (Render / Fly / Vercel) | Done |
| Client | Official `pyronites` package on PyPI | Done |

See `docs/PLAN.md` for the full roadmap and `docs/ARCHITECTURE.md` for technical design.

---

## Official Python client (`pyronites`)

Install from PyPI:

```bash
pip install pyronites
```

Configure:

```bash
export PYRONITES_URL="https://your-backend.example.com"   # or http://localhost:8000
export PYRONITES_KEY="pyro_live_..."                      # from the dashboard API Keys page
```

Minimal usage:

```python
from pyronites import create_client

client = create_client()

# Tables
note = client.table("notes").insert({"title": "Hello", "body": "World"})
for row in client.table("notes").select().limit(10):
    print(row)
client.table("notes").update({"title": "Updated"}).eq("id", note["id"])
client.table("notes").delete().eq("id", note["id"])

# Auth (optional)
client.auth.sign_in("user@example.com", "password")
print(client.auth.user())

# Storage
meta = client.storage.upload("photo.jpg")
data = client.storage.download(meta["id"])

# Optional local / cache tables
client = create_client(
    local_tables=["settings"],
    cache_tables=["catalog"],
    local_db_path="./.pyronites_local.db",
)
```

Package docs and API contract: [`pyronites/README.md`](pyronites/README.md) and [`pyronites/docs/syntax.md`](pyronites/docs/syntax.md).

PyPI: https://pypi.org/project/pyronites/

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

**Option A — Python client (recommended)**

```bash
pip install pyronites
export PYRONITES_URL="http://localhost:8000"
export PYRONITES_KEY="pyro_live_..."
```

```python
from pyronites import create_client
client = create_client()
print(list(client.table("your_table").select().limit(10)))
```

**Option B — plain HTTP**

```bash
curl -H "Authorization: Bearer pyro_live_..." \
  http://localhost:8000/tables/your_table
```

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
| **Python client** | `pip install pyronites` — tables, auth, storage, local/cache policy |
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
