# DEBUG_LOG — Pyronites / PyroCore (read-only audit)

## Environment Inventory

### SQLite files found

| Path | Tracked in git? | Notes |
|------|-----------------|-------|
| `pyrocore.db` (+ `.db-shm`, `.db-wal`) | **Yes** (untracked in Phase 5) | Primary / meta DB at repo root. Empty of app data. |
| `backups/pyrocore_2026-07-16T14-42-13-582702.db` | **Yes** (untracked in Phase 5) | Snapshot dated 2026-07-16. |

`.gitignore` now excludes `*.db`, `*.db-shm`, `*.db-wal`, `backups/`.

### Migrations

0001–0005 applied on committed snapshot; 0006/0007 pending until startup `run_pending_migrations`.

## Confirmed Issues (status after Phases 1–5)

1. Identifier 404 — **Resolved** (`table_not_found` / `column_not_found`)
2. CREATE TABLE body validation undocumented — **Confirmed** (docs gap)
3. `users` reserved — **Resolved** (auth-only by design)
4. Nested JSON on JSON column → 500 — **Resolved** (serialize/deserialize)
5. PATCH same JSON problem — **Resolved**
6. Multi-field insert partial success — **Resolved** (atomic; documented)
7. Error shape — **Resolved** (`{code, message}`)
8. App-level tables no migrations — **Resolved** (none in inventory)
9. Cascade/orphans — **Resolved** (documented in ARCHITECTURE §4b)
10. Filter API single equality — **Open** (recommendation)

## Newly Discovered (status)

1. DB missing 0006/0007 — **Resolved** (migrate-on-start)
2. `password_reset_tokens` not reserved — **Resolved**
3. SQL multi-statement not transactional — **Resolved**
4. `*.db` in git — **Resolved** (gitignore + untrack; history purge recommended later)
5. Dual router mount — **Open** (should-fix)
6. CreateTableBody no FK/NOT NULL — **Open** (should-fix)
7. api_keys no FK — **Open** (cosmetic)
8. Docs typo files — **Open** (cosmetic)

## Phase Status

Phase 5: complete — all phases done. See full log in prior commits / local audit artifacts.
