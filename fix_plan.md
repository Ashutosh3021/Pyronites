# PyroCore Fix Plan — Production Readiness

**Target:** `PyroCore` backend (FastAPI, SQLite/WAL, port 8000) + Dashboard (Next.js, port 3000) + CLI (`pyrocore`) + `pyronites` Python client (PyPI).
**Source of truth:** `C:\Users\ashut\Downloads\Pyronites` (live backend on `localhost:8000`, frontend on `localhost:3000`).
**Principle:** Do **not** assume behavior. Every fix MUST be verified by running live `curl` commands against `localhost:8000` and by loading the dashboard on `localhost:3000`. The agent may start the backend (`uvicorn backend.app:app --port 8000`) and frontend (`npm run dev`) itself to reproduce.

---

## 1. Analysis of `powershell.log`

The log is mostly **successful** happy-path traffic. Only **two** genuine failures appear, plus the test harness masked a feature that was never truly verified.

| # | Lines | Symptom | Verdict |
|---|-------|---------|---------|
| E1 | 24–26 | `POST /sql/execute` with a `read`+`write` API key returns `{"code":"forbidden","message":"Insufficient permissions"}` | **Real app bug / design gap.** `backend/api/project_scoped.py:execute_sql` (line 693) requires `{"admin"}` scope, but API keys created via the dashboard/CLI are typically granted only `read`/`write`. SQL execution is unusable for normal API-key clients. |
| E2 | 30–37 | `curl.exe ... -o downloaded.txt` fails with `A value that is not valid (downloaded.txt) was specified for the outputFormat parameter` | **Test harness + endpoint confusion.** Two problems: (a) the command used the literal `{id}` placeholder and PowerShell's `curl` alias (`Invoke-WebRequest`) hijacked `curl.exe`, so the download was **never actually performed**; (b) the path `/storage/{id}` hits `get_file_metadata` (returns JSON metadata), NOT the file bytes — actual download is `/storage/{id}/download` (or project-scoped `/api/projects/{id}/storage/{id}/download`). The download path is therefore **unverified** in the log. |
| — | 16–21 | Table `items` created, row inserted, `SELECT * FROM items` returns the row | Confirms legacy (unscoped) `/tables` + `/sql/execute` operate on the **meta DB** (`pyrocore.db`) for the Default project. This is the seed of the data-persistence/frontend-sync confusion (see §3). |

No backend tracebacks, no 500s, no DB corruption errors are present in this log. The three "known issues" are therefore **architectural / systemic**, not single-line crashes.

---

## 2. Architecture Overview (for context)

- **Meta DB** (`pyrocore.db`, `DATABASE_PATH`): `users`, `sessions`, `projects`, `api_keys`, `migrations`.
- **Per-project data DB**: `data/projects/{project_uuid}.db` for every non-Default project. The **Default** project ("legacy") may keep using the meta DB when no dedicated file exists (`backend/api/project_deps.py:_is_legacy_default`, `open_data_db_for_project`).
- **Connection model:** A fresh `Database` connection is opened **per request** in `get_project_context` / `get_db` and closed in the dependency `finally` (`project_deps.py:128-184`). The single shared `Database` opened in `app.py` lifespan is **closed immediately after migrations** (`app.py:81`) and is NOT reused by request handlers.
- **Backups:** A background asyncio loop (`scheduled_backup_loop`) opens the DB file with a *separate* raw `sqlite3.connect` in a worker thread every `BACKUP_INTERVAL_SECONDS` and writes `backups/pyrocore_*.db` (WAL + SQLite online backup API). Backups are also pushed to S3/R2 when `S3_SYNC_ENABLED=true`.
- **Frontend data plane:** `frontend/lib/api.ts:apiUrl()` rewrites `/tables`, `/storage`, `/sql`, `/api/keys`, `/api/stats` to `/api/projects/{stored_id}/...` **only when** a project id is present in `localStorage` (`getStoredProjectId()`). Otherwise it falls back to the unscoped legacy routes (meta DB).
- **CLI:** `cli/main.py` exposes `pyrocore` (`init`, `db`, `connect`, `serve`, `backup`, `keys`). Packaged as the `pyrocore` console script in `pyproject.toml`.

---

## 3. Root-Cause Analysis → the 3 Known Issues

### 3.1 Data Persistence — "data erased automatically / fails to save"
- **RCA-1 (project-context split):** Because Default uses the meta DB while every other project uses a separate file, *where the data is written depends entirely on which endpoint the client hits*. The dashboard's `apiUrl()` chooses the target from `localStorage`, not from the server. If the stored project id is missing/stale, writes land in the meta DB while reads (with a different/empty id) hit a project file — the data appears **erased**. This is the single biggest cause of perceived data loss.
- **RCA-2 (S3 sync clobber on cold start):** `s3_sync.py:download` only skips when the local file is non-empty (`st_size > 0`). A freshly started container with an **empty-but-present** file (e.g. just-created `pyrocore.db` from migrations) will be **overwritten** by a possibly-stale remote snapshot. There is no version/epoch guard, so an older S3 copy silently replaces newer local data.
- **RCA-3 (restore while server holds open connections):** `backup.py:restore_from_backup` renames/replaces the live `.db` file on disk. On Windows the running server may still hold an open handle/connection to the old file; a concurrent request can then read a half-replaced image → "database disk image is malformed" / lost writes. The restore path is reachable from the CLI while the server is live.
- **RCA-4 (migrations run per-request):** `open_data_db_for_project` calls `run_pending_migrations` **on every request** that touches a project DB (`project_deps.py:86-92`). This serializes every request behind a migration/lock check and can contend with the backup loop. While not directly destructive, it is a stability and consistency risk and can mask partial-migration states.
- **RCA-5 (WAL not checkpointed before some operations):** `synchronous=NORMAL` is fine for durability, but the scheduled backup / S3 upload rely on `wal_checkpoint(TRUNCATE)` only inside `s3_sync.upload`. The local backup loop (`backup_now`) opens the source `file:...?mode=ro` and uses the online backup API (correct), **but** if a previous process crashed with an un-checkpointed WAL, the `-wal`/`-shm` sidecars are not folded, so a "backup" can exclude the most recent transactions.

### 3.2 Frontend Synchronization — "data intermittently fails to display"
- **RCA-6 (localStorage project binding):** `apiUrl()` trusts `getStoredProjectId()` (`api.ts:33-36, 67-92`). There is no authoritative "current project" resolved from the server after login. If `localStorage` is empty (fresh browser, private mode, cleared storage) the UI talks to the legacy meta DB; if it holds a stale id, it talks to a different project file. Both produce **empty/partial tables** that look like data loss.
- **RCA-7 (no revalidation after writes):** `frontend/app/database/page.tsx` loads tables/rows on mount and on `PROJECT_CHANGE_EVENT` only (`database/page.tsx:83-93`). The create/insert/update/delete handlers must explicitly re-call `loadTables()`/`loadTable()`; any code path that forgets this (or that writes via one project context while reading another) leaves the grid **stale** until a manual refresh — the "intermittent display" symptom.
- **RCA-8 (silent empty states):** On `!res.ok` the pages set an error *string* but many also collapse to `setTables([])` / `setRows([])` (`database/page.tsx:45-55, 72-77`), so a 403/404 (e.g. scope or project mismatch) renders identically to "no data." Users cannot distinguish "empty" from "broken," reinforcing the data-loss perception.
- **RCA-9 (logs/stats poll, data doesn't):** `/api/logs` polls every 3s but table/storage views do not, so external writes (another tab, the API, the SQL editor) are not reflected until a refresh.

### 3.3 General Stability
- **RCA-10 (API-key SQL scope — E1):** `execute_sql` requires `{"admin"}`; API keys are almost never created with `admin`. Normal key-authenticated clients **cannot run SQL at all**, contradicting the documented "REST API … plain HTTP" workflow.
- **RCA-11 (storage download path confusion — E2):** `/storage/{id}` returns metadata; bytes live at `/storage/{id}/download`. The contract is undocumented and the log never verified a real download.
- **RCA-12 (mixed autocommit + explicit transactions):** `Database.execute()` auto-commits; `Database.transaction()` issues `BEGIN TRANSACTION` manually. Used consistently today, but there is no `PRAGMA busy_timeout` safeguard beyond the 30s connect timeout, so rare lock contention (backup loop vs request) can surface as `database is locked` under load.
- **RCA-13 (CORS/version drift):** CORS allow-origins and the package version are hand-maintained; regressions here break the dashboard silently.

---

## 4. Fix Plan (ordered, actionable)

### Task 1 — Unify the project-context source of truth (fixes RCA-1, RCA-6)
**Files:** `frontend/lib/api.ts`, `frontend/app/database/page.tsx`, `frontend/app/storage/page.tsx`, `frontend/app/sql-editor/page.tsx`, `frontend/app/api-keys/page.tsx`, `backend/api/auth.py` (`/auth/me`), `backend/api/projects.py`.
1. Add a `GET /api/me-project` (or extend `/auth/me`) that returns the **active project id** the server considers current for the session (derive from `ensure_default_project` / most-recently-used project column). Backend: `backend/api/auth.py`.
2. In `api.ts`, replace reliance on bare `localStorage` with a resolved context:
   - On app load and after login/signup, call the new endpoint; fall back to `fetchProjects()` and pick the first `active` project; persist via `setStoredProject`.
   - Emit `PROJECT_CHANGE_EVENT` whenever the resolved id changes so **every** data hook re-fetches (`database/page.tsx:91` pattern, applied to all pages).
3. Ensure `setStoredProject` is called whenever the user creates/selects a project (`new-project/page.tsx`, project switcher).
**Verify (curl):**
```bash
curl -s -X POST localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpassword123"}' -c cookies.txt
curl -s localhost:8000/auth/me -b cookies.txt   # confirm returns active project id
```

### Task 2 — Make writes and reads always target the same DB (fixes RCA-1, RCA-7)
**Files:** `frontend/lib/api.ts`, all dashboard data pages.
1. Guarantee `apiUrl()` never silently falls back to the legacy route when a project *should* be active. If a project id is expected but missing, **fail loud** (redirect to project picker) instead of hitting the meta DB.
2. After every successful create/insert/update/delete (tables, storage, SQL, keys), **force a re-fetch** of the affected view. Add a small `invalidateProjectData()` helper in `api.ts` that bumps a counter the pages subscribe to.

### Task 3 — Add an authoritative "current project" to the session (fixes RCA-6/7 backend side)
**Files:** `backend/core/projects.py` (`ensure_default_project`), `backend/api/auth.py`, DB schema (`backend/migrations/`).
1. Add `last_project_id` to the `users` (or a `sessions`) table via a new migration `0003_...sql`. Update it on project create/select/switch.
2. `/auth/me` returns `last_project_id`; frontend uses it as the default resolved project.

### Task 4 — Fix S3 restore to never clobber newer local data (fixes RCA-2)
**Files:** `backend/core/s3_sync.py` (`download`).
1. Compare **modification/version metadata**, not just `st_size > 0`. Options (choose one, implement both client + simplest):
   - Store a `pyrocore-manifest.json` (or S3 object tag) with `last_write_epoch` updated on every upload (`upload` already checkpoints + uploads). On `download`, only replace local if remote epoch is **newer** than local file mtime/recorded epoch.
   - Or: skip download entirely unless the local DB is **absent** (`not local.exists()`), never when it exists — the current `st_size>0` guard is insufficient.
2. Add a startup log line showing source-of-truth decision ("using local" vs "restored from S3 epoch=X").

### Task 5 — Coordinate backup/restore with open connections (fixes RCA-3, RCA-5)
**Files:** `backend/core/backup.py` (`restore_from_backup`, `backup_now`, `scheduled_backup_loop`), `backend/api/backups` (restore endpoint), `cli/commands/backup.py`.
1. Before replacing the live file, attempt a `PRAGMA wal_checkpoint(TRUNCATE)` on the running connection and a graceful close of *server-managed* connections. For the CLI restore case, require the server to be stopped OR add a `POST /api/backup/restore` that restores **into a fresh file and re-opens connections**, rather than the CLI overwriting a file the server has open.
2. In `backup_now`, capture the WAL by opening the source in WAL mode and running `wal_checkpoint(TRUNCATE)` (or pass `sqlite3.connect` with the same file) before `source_conn.backup()` so un-checkpointed transactions are included.
3. Add an integration curl test that creates a row, triggers a backup, restores it, and confirms the row persists.

### Task 6 — Run migrations once at startup, not per request (fixes RCA-4)
**Files:** `backend/api/project_deps.py` (`open_data_db_for_project`), `backend/app.py`.
1. Move project-DB migration to startup: when a project is created (`core/projects.py:create_project`) and once in `app.py` lifespan, open & migrate all known project DBs up front, OR cache a per-path `Database` (singleton keyed by path) and migrate only on first open.
2. Keep `run_pending_migrations` idempotent (already is) but stop calling it on the hot path of every request.

### Task 7 — Fix API-key SQL scope (fixes RCA-10 / E1)
**Files:** `backend/api/project_scoped.py:execute_sql` (line 693), `backend/api/sql_editor.py`, `backend/auth/api_keys.py`, docs.
1. Decide and document the contract: SQL execution requires `admin` OR `write`? Recommended: allow `write` (and `admin`) for SQL, since SQL is inherently a write-capable surface; reserve an explicit `admin`-only flag for DDL if desired. Align **both** the project-scoped (`/sql/execute`) and legacy (`/sql/execute`) routes to the same rule.
2. Re-run the log's exact failing call and confirm it now succeeds with a `read`+`write` key.
**Verify (curl) — reproduce E1 then confirm fixed:**
```bash
KEY=$(curl -s -X POST localhost:8000/api/keys -b cookies.txt -H "Content-Type: application/json" \
  -d '{"name":"fix-test","scopes":["read","write"]}' | python -c "import sys,json;print(json.load(sys.stdin)['key'])")
curl -s -X POST localhost:8000/sql/execute -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" -d '{"sql":"SELECT 1"}'
# Expect row results, NOT {"code":"forbidden",...}
```

### Task 8 — Clarify & verify storage download (fixes RCA-11 / E2)
**Files:** `backend/api/storage.py`, `backend/api/project_scoped.py` (download routes), README, `checklist.md`.
1. Document the contract explicitly: `/storage/{id}` → JSON metadata; `/storage/{id}/download` → file bytes (and project-scoped equivalents).
2. Add a **real** download verification to the test checklist using a real file id and a correct invocation (avoid the PowerShell `curl` alias; use `curl.exe --output out.bin` or `Invoke-WebRequest -OutFile`):
```powershell
# upload
$ID = (curl.exe -s -X POST localhost:8000/storage/upload -b cookies.txt -F "file=@test.txt" | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
# download bytes (use --output, NOT -o alias confusion; force exe)
curl.exe -s localhost:8000/storage/$ID/download -b cookies.txt --output downloaded.bin
# verify
Compare-Object (Get-Content test.txt -Raw) (Get-Content downloaded.bin -Raw)
```
3. Confirm the project-scoped download returns bytes (not 404/metadata) for a file uploaded under that project.

### Task 9 — Harden connection locking & error surfacing (fixes RCA-8, RCA-12)
**Files:** `backend/core/db.py`, all dashboard pages.
1. Add `PRAGMA busy_timeout=30000` in `connect()` next to the existing PRAGMAs so lock contention degrades to a wait instead of an immediate `database is locked` error.
2. In the frontend, distinguish `!res.ok` (show the server `message`/`code`) from a genuine empty result so users see "permission denied / project mismatch" instead of a blank grid.

### Task 10 — Add automated regression coverage (so fixes stick)
**Files:** `backend/tests/`, `checklist.md`.
1. Add/extend pytest cases that, against a live or test DB, assert: (a) SQL works with `read`+`write` API key; (b) storage download returns bytes; (c) project-scoped write+read round-trip; (d) S3 download skips when local is newer (mock S3).
2. Extend `checklist.md` with the corrected download + API-key SQL commands from Tasks 7–8.

---

## 5. CLI, PyPI, and Version Requirements (must preserve)

- **Do NOT change or remove the `pyrocore` console script.** Keep `cli/main.py` entry point and all subcommands (`init`, `db`, `connect`, `serve`, `backup`, `keys`) working (`pyproject.toml:[project.scripts]`).
- **Do NOT change the PyPI package layout.** Keep `pyronites` as a separately-published client; keep `hatchling` wheel packages = `["cli", "backend"]` (`pyproject.toml:[tool.hatch.build.targets.wheel]`).
- After all fixes pass, **increment the version** in `pyproject.toml`:
  - Current: `version = "0.1.0"`
  - New: `version = "0.2.0"` (minor bump — new behavior: project-context unification, API-key SQL scope, S3 safety). Update the changelog/README "Status" if present.
- Run `pip install -e ".[dev]"` and `pytest` to confirm the wheel still builds and tests pass before publish.

---

## 6. Verification / Acceptance Test Plan (runnable)

Execute in order; **do not skip the curl checks** (backend assumed on `localhost:8000`, frontend on `localhost:3000`):

1. **Health & auth**
   ```bash
   curl -s localhost:8000/health                # {"status":"ok","database":true}
   curl -s -X POST localhost:8000/auth/signup -H "Content-Type: application/json" -d '{"email":"a@b.com","password":"testpassword123"}'
   curl -s -X POST localhost:8000/auth/login  -H "Content-Type: application/json" -d '{"email":"a@b.com","password":"testpassword123"}' -c c.txt
   curl -s localhost:8000/auth/me -b c.txt      # must include active project id
   ```
2. **Project round-trip (persistence)**
   ```bash
   curl -s -X POST localhost:8000/api/projects -b c.txt -H "Content-Type: application/json" -d '{"project_id":"p2","project_name":"P2"}'
   PID=$(curl -s localhost:8000/api/projects -b c.txt | python -c "import sys,json;print([p['id'] for p in json.load(sys.stdin)['projects'] if p['project_id']=='p2'][0])")
   curl -s -X POST localhost:8000/api/projects/$PID/tables -b c.txt -H "Content-Type: application/json" -d '{"table":"t","columns":[{"name":"id","type":"INTEGER"},{"name":"v","type":"TEXT"}],"primary_key":"id"}'
   curl -s -X POST localhost:8000/api/projects/$PID/tables/t -b c.txt -H "Content-Type: application/json" -d '{"v":"hello"}'
   curl -s "localhost:8000/api/projects/$PID/tables/t" -b c.txt   # must return the row
   ```
3. **API-key SQL (E1 fixed)**
   ```bash
   KEY=$(curl -s -X POST localhost:8000/api/projects/$PID/api/keys -b c.txt -H "Content-Type: application/json" -d '{"name":"k","scopes":["read","write"]}' | python -c "import sys,json;print(json.load(sys.stdin)['key'])")
   curl -s -X POST localhost:8000/api/projects/$PID/sql/execute -H "Content-Type: application/json" -H "Authorization: Bearer $KEY" -d '{"sql":"SELECT * FROM t"}'   # must return rows
   ```
4. **Storage download (E2 fixed)** — use the PowerShell-correct command from Task 8.
5. **Frontend** — open `localhost:3000`, sign in, create a table, insert a row, **switch projects and back**, confirm the row still displays (validates RCA-6/7). Confirm storage download works in the UI.
6. **Tests & build**
   ```bash
   pytest                                   # all suites green
   pip install -e ".[dev]"                  # wheel builds, CLI present
   pyrocore --help                          # CLI intact
   ```

**Acceptance criteria:** E1 and E2 no longer reproduce; project-scoped writes are always readable in the same project; S3 restore never overwrites newer local data; the full curl suite + `pytest` pass; `pyrocore` CLI and `pyronites` package structure are unchanged; `pyproject.toml` version is `0.2.0`.

---

## 7. Out of Scope (note for the agent)
- PostgreSQL migration path (future goal, not a bug here).
- 429 rate-limit behavior on external hosts (`report.md`) — that is a hosting-quota issue, not fixed by code here.
- Auth UI copy/translation polish beyond error surfacing.