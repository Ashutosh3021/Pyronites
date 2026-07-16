
# PyroCore Deployment Guide

This guide covers deploying PyroCore with Docker and the issues that were hit
(and fixed) while making the deploy actually work end-to-end.

**Host chosen: Fly.io.** The `fly` CLI was available in the build environment,
so `fly.toml` is provided. Render is also covered (it was the first documented
target). Railway uses the same Docker image + volume pattern — point it at the
Dockerfile, mount a volume at `/data`, and set the env vars below.

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

## 6. Deploy to Fly.io (chosen host)

Prereqs: `fly auth login` (interactive, needs a browser).

```bash
# 1. App + volume (region must match primary_region in fly.toml)
fly apps create pyrocore
fly volumes create pyrocore_data --region iad --size 1

# 2. Set secrets/env. PORT is injected automatically — do NOT set it.
fly secrets set \
  DATABASE_PATH=/data/pyrocore.db \
  STORAGE_ROOT=/data/storage_files \
  MIGRATIONS_DIR=/app/backend/migrations \
  FRONTEND_ORIGIN=https://your-frontend.example.com \
  SESSION_COOKIE_SECURE=true \
  SESSION_COOKIE_SAMESITE=none \
  BACKUP_INTERVAL_SECONDS=3600

# 3. Deploy (builds the Docker image remotely using fly.toml)
fly deploy

# 4. Verify
curl https://<your-app>.fly.dev/health          # -> {"status":"ok",...}
fly ssh console -C "ls -la /data/backups"        # -> a backup file exists
```

Edit `fly.toml`: replace `primary_region` and `FRONTEND_ORIGIN` with your values.
Add more origins to `FRONTEND_ORIGIN` as a comma-separated list.

---

## 7. Deploy to Render (free tier) — original target

1. Create a **Web Service** → Runtime **Docker** → connect the repo → branch `main`.
2. Add a **Disk**: name `pyrocore-data`, mount path `/data`, size 1 GB.
3. Set the same env vars as §6 (omit `PORT` — Render injects it).
4. Create the service. The `/data` disk persists `pyrocore.db`, `storage_files/`,
   and `backups/` across deploys and restarts.
5. Verify `/health` and `ls /data/backups` (via Render shell) as above.

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
