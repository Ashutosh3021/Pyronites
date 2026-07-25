# Changelog

All notable changes to the **pyronites** client package are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/). Versioning follows [SemVer](https://semver.org/).

## [0.1.0] — 2026-07-25

### Added

#### Phase P1 — Core client
- `create_client()` with `PYRONITES_URL` / `PYRONITES_KEY` config
- HTTP transport (`httpx`) with Bearer auth and typed errors
- Auth: `sign_up`, `sign_in`, `sign_out`, `user`
- Tables: `select`, `insert`, `update().eq("id", ...)`, `delete().eq("id", ...)`, `get`, `sql`
- Errors: `ApiError`, `AuthError`, `NotFoundError`

#### Phase P2 — Storage
- `client.storage.upload` / `list` / `get` / `download` / `remove`

#### Phase P3 — Local vs remote policy
- `local_tables`, `cache_tables`, `remote_tables`, `local_db_path`
- SQLite local store
- `pull` / `push` / `sync` (v1 conflict policy: remote wins)

#### Phase P4 — Polish
- Changelog, expanded README, example script
- PyPI-ready `pyproject.toml` metadata

### Notes
- Default table policy is **remote**
- Minimum Python: 3.10
- Runtime dependency: `httpx>=0.27.0`
