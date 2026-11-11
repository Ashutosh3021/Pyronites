# Changelog

All notable changes to the **pyronites** client package are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/). Versioning follows [SemVer](https://semver.org/).

## [1.4.0] — 2026-11-11

### Added
- `create_client(..., project_id=...)` and the `PYRONITES_PROJECT_ID` environment variable. When a project id is set, every table, storage and SQL call is rewritten to `/api/projects/{project_id}/...`, so a project-scoped API key can never reach another project's data.
- `client.create_table(table, columns, primary_key)` and `client.drop_table(table)` — admin-scoped table management without reaching for private attributes.

### Fixed
- `update()` and `delete()` address a row by the table's **primary key**, which is not always named `id`. The key column is resolved from `/tables/{name}/schema` and the error message names the real key when the filter column does not match.
- `update()` no longer writes the primary key column, so a patch can no longer change a row's identity.
- `push()` resolves the row key the same way instead of assuming an `id` column.

## [1.2.1] — 2026-09-28

### Fixed
- Rate limiting: 429 no longer auto-retried; `Retry-After` honoured for retry timing (cap 120s), default backoff base raised to 1.0s.
- `__version__` synced with `pyproject.toml` (was stale at `1.1.0` in the `1.2.0` release).

## [1.2.0] — 2026-09-14

### Added
- Automatic retry on `429`/`502`/`503`/`504` with exponential backoff and `Retry-After` support.
- In-flight request coalescing (identical concurrent requests share one HTTP call).
- 30s cached `auth.user()` (avoids a `GET /auth/me` round-trip per call).

## [1.1.0] — 2026-08-13

### Changed
- Bumped package version from `0.1.0` to `1.1.0`.
- Added `LICENSE` (MIT) file and shipped it in both wheel and sdist builds.

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
