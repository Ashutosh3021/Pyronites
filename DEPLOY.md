
# PyroCore Deployment Guide

This guide covers deploying PyroCore with Docker and the issues that were hit
(and fixed) while making the deploy actually work end-to-end.

**Host chosen: Render (backend) + Vercel (frontend).** The backend is a
Dockerised FastAPI/SQLite service deployed on Render via `render.yaml`; the
Next.js dashboard is deployed on Vercel via `vercel.json`. `fly.toml` is kept
for reference but is no longer the chosen host. Railway uses the same Docker
image + volume pattern — point it at the Dockerfile, mount a volume at `/data`,
and set the env vars below.

---

## 1. Environment variables (set these on the host)

Compare this list against `.env.example`. The first block is always read by the
server; the **DEPLOYMENT-ONLY** block is what you must add on the host or the
deployed app will misbehave in ways that never show up locally.

| Variable | Default | Required on host? | Notes |
|---|---|---|---|
| `DATABASE_PATH` | `pyrocore.db` | **Yes** | Must live on the mounted volume, e.g. `/data/pyrocore.db`. If it points at a container-local path, the DB is wiped on every redeploy. |
| `STORAGE_ROOT` | `storage_files` | **Yes** | Must be on the volume, e.g. `/data/storage_files`. |
| `MIGRATIONS_DIR` | bundled `backend/migrations` | No (auto) | Container sets `/app/backend/migrations`. |
| `HOST` | `0.0.0.0` | **Yes** | Must bind `0.0.0.0`, not `127.0.0.1`, or the platform's proxy can't reach it. |
| `PORT` | `8000` | **Yes (injected)** | Platforms inject `$PORT`. Do NOT hard-code a different value; the Dockerfile/uvicorn read `$PORT`. |
| `FRONTEND_ORIGIN` | `http://localhost:3000,http://127.0.0.1:3000` | **Yes (if cross-origin dashboard)** | Comma-separated origins the dashboard is served from. Without it the deployed dashboard is CORS-blocked. |
| `SESSION_COOKIE_SECURE` | `false` | **Yes (HTTPS)** | Set `true` over HTTPS. |
| `SESSION_COOKIE_SAMESITE` | `lax` | **Yes (cross-origin)** | Set `none` when the dashboard is on a different origin than the API. App forces `Secure=true` whenever this is `none`. |
| `BACKUP_INTERVAL_SECONDS` | `3600` | No | Backup loop interval. An immediate backup is taken on startup. |

> TLS/HTTPS is **terminated by the platform** (Fly `force_https`, Render's
> proxy). The app itself serves plain HTTP inside the container — do not add
> your own TLS terminator.

---

## 2. Persistent volume (the single most important thing)

If this is wrong, **every deploy wipes the database, storage, and backups.**

- Mount point must be exactly `/data` (matches `DATABASE_PATH`/`STORAGE_ROOT`).
- Fly: `fly volumes create pyrocore_data --region <region> --size 1` and
  `[mounts] source="pyrocore_data" destination="/data"` (already in `fly.toml`).
- Render: create a Disk named `pyrocore-data`, mount path `/data`.
- The container runs as **root** and pre-creates `/data/storage_files` and
  `/data/backups` on first boot, so the mounted volume is always writable.

---

## 3. Local Docker validation (do this before pushing)

> NOTE: in the environment where these fixes were developed, Docker was not
> installed, so the container was validated by running the *exact same* app
> (`uvicorn backend.app:app`) against a brand-new empty directory. That
> exercises the same first-boot path the container does (migrations, volume
> dirs, backup loop, `/health`). With Docker available, the equivalent is
> `docker build` + `docker run -v pyrocore-data:/data` against an empty volume.

What must be true on first boot against an empty volume:
1. All pending migrations apply automatically (check logs: "Running N pending migration(s)").
2. Server starts cleanly and `/health` returns `200` with `{"status":"ok"}`.
3. A backup file appears immediately in `<volume>/backups/` (proves the
   scheduled backup loop started).
4. `STORAGE_ROOT` and `backups/` exist under `/data`.

---

## 4. Known issues & fixes

These are the things that broke (or would have broken) on deploy and were fixed
so the next deploy — and other self-hosters — don't hit them blind. Each links
to the code change that resolved it.

### 4.1 Scheduled backups never ran in the container  ❌ → ✅
**Symptom:** `pyrocore backup --list` on the host shows no scheduled backups;
only the immediate start-up backup (if any) exists. Backups are created only
when you manually trigger them.

**Root cause:** `scheduled_backup_loop()` was started *only* by
`cli/commands/serve.py` (`pyrocore start`). The Docker image runs
`uvicorn backend.app:app` **directly**, so the loop never started. This is the
classic "works locally because I always use `pyrocore start`, breaks in the
container" trap.

**Fix:** The loop is now started in the app **lifespan** (`backend/app.py`) and
runs regardless of how the app is launched. `serve.py` no longer starts its own
loop (it passes the interval via `BACKUP_INTERVAL_SECONDS`). The loop takes an
immediate backup on startup, then repeats every `BACKUP_INTERVAL_SECONDS`.

**Verify:** `fly ssh console` (or Render shell) →
`ls /data/backups` shows a file dated at container start, and new ones appear
every interval. Or hit `GET /api/backups` from the dashboard Settings page.

### 4.2 Session cookie not Secure/SameSite → every authed request 401s  ❌ → ✅
**Symptom:** The dashboard loads, you can sign up, but the moment it calls an
authenticated endpoint (projects, tables, storage) you get 401 and are bounced
to login — in an infinite loop. Works perfectly on `http://localhost`.

**Root cause:** `_set_session_cookie()` set `samesite="lax"` with `Secure`
omitted. For a dashboard served from a **different origin** than the API (e.g.
Vercel frontend → Fly backend) over HTTPS, the browser only forwards the
`session_token` cookie on cross-site requests when it is `SameSite=None` **and**
`Secure`. With `Lax`+insecure, the cookie is dropped, so `resolve_auth()` never
sees a session.

**Fix:** Cookie policy is now env-driven (`backend/api/auth.py`):
`SESSION_COOKIE_SECURE` and `SESSION_COOKIE_SAMESITE`. When `samesite=none` the
app forces `Secure=true`. `logout` now clears the cookie with matching
`Secure`/`SameSite` so sign-out actually works. Defaults stay `Lax`/insecure so
local `http://localhost` dev is unaffected.

**Set on host:** `SESSION_COOKIE_SECURE=true` and `SESSION_COOKIE_SAMESITE=none`
(plus `FRONTEND_ORIGIN` for CORS).

### 4.3 Mounted volume not writable (non-root user)  ❌ → ✅
**Symptom:** First write after deploy (first upload, or migrations creating the
WAL/`backups`) fails with a permission error, or the app 500s on first request.
Works locally because the Docker *image's* `/data` was owned by the app user.

**Root cause:** The image created a non-root user (uid 1000) and `chown`ed
`/data`. On a real platform the mounted volume is a fresh empty directory owned
by **root**, which the uid-1000 process cannot write. The local image state
masked this.

**Fix:** The container now runs as **root** and pre-creates `/data/storage_files`
and `/data/backups` (mode 777) at build time. Trade-off documented in the
Dockerfile — acceptable for a single-tenant self-hosted SQLite app; harden
later by pre-chowning the volume + adding a `USER` switch.

### 4.4 Healthcheck hard-coded to :8000  ❌ → ✅
**Symptom:** On platforms that assign a non-8000 port, the container is marked
**unhealthy** even though the app is fine, because the probe hit `localhost:8000`
while the process listens on the platform-assigned `$PORT`.

**Fix:** `HEALTHCHECK` now uses `http://localhost:${PORT:-8000}/health` and a
`start-period` of 30s (margin for first-boot migrations on a cold start).

### 4.5 CORS defaults to localhost only
**Symptom:** Deployed dashboard's API calls fail with a CORS error in the
browser console.

**Root cause:** `allow_origins` defaulted to `localhost:3000/127.0.0.1:3000`.

**Fix (config, not code):** Set `FRONTEND_ORIGIN` to your dashboard's origin(s),
comma-separated. Already supported by `backend/app.py` — just set the env var.

### 4.6 Frontend `NEXT_PUBLIC_API_URL` is build-time (gotcha)
**Symptom:** Dashboard still calls `http://localhost:8000` after deploy, even
though you set the URL in the running container.

**Root cause:** Next.js inlines `NEXT_PUBLIC_*` at **build** time, not runtime.

**Fix (config):** Set `NEXT_PUBLIC_API_URL=<your-backend-url>` **before**
`next build` (see `frontend/.env.production`). Rebuild the frontend on every
backend-URL change. The API contract itself needs no change.

### 4.7 Free-tier cold starts / SQL Editor timeouts
**Symptom:** First SQL Editor run after the app has been idle for a while times
out or is very slow.

**Cause:** Free tiers spin the instance down; the first request triggers a cold
start (container boot + migrations). Migrations are tiny (5 small files) so
startup is fast, but the very first request pays the boot cost.

**Mitigation:** Keep a small always-on instance, or accept the first-hit latency.
The SQL Editor has no server-side statement timeout today; a long-running query
will tie up the single writer connection — add a wall-clock guard if users run
heavy SQL on free tiers.

---

## 5. Backup verification (step 4 of the deploy checklist)

- **Scheduled:** list files in the volume's `backups/` dir, or call
  `GET /api/backups` from the dashboard Settings → Backups. You should see a file
  stamped at container start plus one per `BACKUP_INTERVAL_SECONDS`.
- **Manual:** `POST /api/backup` (admin) triggers an immediate backup; the
  response returns the path.
- **CLI equivalent:** inside the container, `pyrocore backup --list` reads the
  same `backups/` directory (the CLI resolves `backups/` next to `DATABASE_PATH`,
  which is `/data/backups` on the host).

---

## 6. Deploy the backend to Render

`render.yaml` (repo root) drives this — Render builds the Dockerfile, binds the
injected `$PORT`, and mounts a 1 GB disk at `/data`.  Prereqs: a Render account
and the repo connected to a Render service via the blueprint.

```bash
# 1. In the Render dashboard, create a new "Blueprint" and point it at this repo.
#    Render reads render.yaml and creates the `pyrocore-backend` web service.

# 2. After the first deploy, set these secret env vars in the service's
#    Environment tab (they are `sync: false` in render.yaml so Render waits for
#    you).  PORT is injected automatically — do NOT set it.
#      FRONTEND_ORIGIN=https://<your-vercel-app>.vercel.app
#      SESSION_COOKIE_SECURE=true
#      SESSION_COOKIE_SAMESITE=none

# 3. Redeploy so the new env vars take effect.

# 4. Verify
curl https://<your-service>.onrender.com/health     # -> {"status":"ok",...}
#    (Render shell) ls /data/backups                  # -> a backup file exists
```

> **Free-tier note:** the `plan: free` service has **no persistent disk** and
> **spins down after 15 min idle**. The `/data` paths are the container's
> *ephemeral* filesystem, so `pyrocore.db`, `storage_files/`, and `backups/` are
> wiped on every cold start and redeploy — sign-ups, API keys, sessions, and
> uploads all disappear. This is fine for a throwaway/demo backend. For real
> data, either upgrade to a paid instance with a disk (see §10), or add S3/R2
> backup sync so the DB survives redeploys. There is **no shell access** on the
> free tier — verify with `GET /health` and `GET /api/backups`, not `ls`.

---

## 7. Deploy the frontend to Vercel

`vercel.json` (repo root) scopes the build to `frontend/` and ignores the
backend.  `NEXT_PUBLIC_API_URL` (read by every `fetch` in the dashboard) is
inlined at **build time**, so it must be present before `next build` runs.

```bash
# 1. In the Vercel dashboard, import the repo. Vercel auto-detects Next.js via
#    vercel.json (framework = nextjs, root = frontend).

# 2. Set the build-time env var (Project → Settings → Environment Variables):
#      NEXT_PUBLIC_API_URL=https://<your-service>.onrender.com
#    Alternatively commit frontend/.env.production with that value (already
#    templated).  Either works — both are read before `next build`.

# 3. Deploy. Vercel builds `frontend/` and serves the dashboard.

# 4. Verify the dashboard loads and an API call reaches the Render backend
#    (check the browser console — a CORS error means FRONTEND_ORIGIN on Render
#    does not list this Vercel origin, or NEXT_PUBLIC_API_URL is wrong).
```

> If you change the backend URL later, update `NEXT_PUBLIC_API_URL` AND redeploy
> the Vercel project (the value is baked into the static bundle at build time).

---

## 8. First-boot behavior (empty volume)

1. App lifespan pre-creates `/data/storage_files` and `/data/backups`.
2. Runs all pending migrations automatically (idempotent; safe to re-run).
3. Takes an immediate backup (scheduled loop).
4. Starts the API server; `/health` returns 200.

---

## 9. Backups

- Scheduled loop: immediate on startup + every `BACKUP_INTERVAL_SECONDS`
  (default 3600). Uses SQLite's online backup API (safe during live writes).
- `POST /api/backup` for a manual trigger; `GET /api/backups` to list.
- Destructive SQL (`DROP`/`DELETE`/…) via `/sql/execute` takes an automatic
  backup first (the safety guard in ARCHITECTURE.md §2).

---

## 10. Render free-tier gotchas (read before you rely on it)

The `plan: free` backend will **run** (Docker runtime is supported on free, and
`$PORT` is injected). The one hard limitation — no persistent disk — is solved in
this repo by S3/R2 sync (see §10.1); the remaining items are operational
latency / quota quirks, not data loss.

| # | Problem | Impact | Solution |
|---|---|---|---|
| 1 | **No persistent disk** | `/data` is ephemeral; `pyrocore.db`, uploads, and backups are wiped on every cold start / redeploy. | **SOLVED in-repo** via S3/R2 sync (`backend/core/s3_sync.py`): the DB is pulled from a bucket on startup and pushed after every backup. **Or** (b) upgrade to a paid instance + disk (re-add the `disk:` block in `render.yaml`, set `plan: starter`). Demo-only: accept the reset. |
| 2 | **15-min idle spin-down** | First request after idle waits ~1 min (boot + S3 restore + migrations). | Keep it awake with a free uptime pinger (e.g. UptimeRobot → `/health` every ~10 min). That burns the 750 free instance-hours/month, so it may suspend before month-end — or just accept the cold-start latency. |
| 3 | **No shell / SSH access** | You cannot `ls /data/backups` or debug via a Render shell. | Verify with `GET /health` → `{"status":"ok"}` and list backups via `GET /api/backups` from the dashboard Settings → Backups. |
| 4 | **750 free instance-hours / month** | If exhausted, the service suspends until month-end or upgrade. | Monitor in the Render dashboard; weigh against the §2 pinger. |
| 5 | **512 MB RAM / 0.1 CPU** | Fine for SQLite + uvicorn at light load; heavy `/sql/execute` can be slow. | Keep queries small on free; upgrade for heavier workloads. |

### 10.1 S3 / R2 persistence (implemented — use this on the free tier)

`backend/core/s3_sync.py` makes an S3 bucket (AWS S3 or any S3-compatible store
such as Cloudflare R2) the durable home for the SQLite DB:

- **Startup:** if the local `pyrocore.db` is missing, the latest copy is
  downloaded from the bucket **before** migrations run (so a fresh container
  resumes prior state and gets caught up by any newer migrations).
- **After every backup** (scheduled loop *and* `POST /api/backup`) the live DB is
  checkpointed (`PRAGMA wal_checkpoint(TRUNCATE)`, folding WAL into the main
  file) and uploaded — a single self-contained `.db` object, no `-wal`/`-shm`
  juggling.
- **Shutdown:** a best-effort final upload runs on `SIGTERM` so the last few
  minutes of writes survive a graceful stop.

The feature is **off unless `S3_SYNC_ENABLED=true`**, and `boto3` is imported
lazily, so non-synced deployments are completely unaffected.

**Env vars (set in the Render dashboard):**

| Variable | Example | Notes |
|---|---|---|
| `S3_SYNC_ENABLED` | `true` | Master switch. Unset = disabled. |
| `S3_BUCKET` | `pyrocore-db` | Required when enabled. |
| `S3_REGION` | `us-east-1` | AWS region (ignored by R2, but keep a value). |
| `S3_ENDPOINT_URL` | `https://<id>.r2.cloudflarestorage.com` | **R2 only.** Omit for AWS S3. |
| `S3_ACCESS_KEY_ID` | `AKIA…` / R2 API token ID | |
| `S3_SECRET_ACCESS_KEY` | `…` | |
| `S3_PREFIX` | `pyrocore/` | Bucket key prefix (trailing slash advised). |
| `BACKUP_INTERVAL_SECONDS` | `300` | Set to `300` (5 min) on free so data loss is bounded to the last upload. |

**AWS S3 setup:**
1. Create a private bucket.
2. Create an IAM user/role with `s3:GetObject`, `s3:PutObject`, `s3:ListBucket`,
   `s3:DeleteObject` on that bucket; copy its access key + secret.
3. In Render, set the `S3_*` vars above (omit `S3_ENDPOINT_URL`). Deploy.

**Cloudflare R2 setup:**
1. Create an R2 bucket; generate an API token (HMAC keys: Access Key ID + Secret).
2. Set `S3_ENDPOINT_URL` to `https://<account-id>.r2.cloudflarestorage.com`,
   `S3_REGION=auto`, and the R2 keys. Deploy. (R2 has no egress fees — cheaper
   than S3 for this use.)

> With sync enabled, the free tier is now viable for real (low-volume) use: data
> survives every redeploy and cold start. The only residual trade-off is the
> §2 spin-down latency and the §4 monthly hour budget.

**Recommended path for maximum durability (no quotas):** set `plan: starter`
(≈$7/mo) and uncomment the `disk:` block in `render.yaml` — that gives a
persistent `/data` disk and no spin-down, which is what PyroCore's SQLite design
assumes. The free tier + S3 sync is the zero-cost alternative.


