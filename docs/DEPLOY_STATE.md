# PyroCore Deploy State Discovery

> **Status: VERIFIED** — Last updated 2026-08-13 via live introspection of the
> production backend at `https://pyrocore-backend.onrender.com` (authenticated
> admin session). This supersedes the earlier "hypothetical" draft, which
> contained speculative claims that are now corrected below.

## Scope of this document

Captures the **actual** state of the production deployment so future work does
not operate on assumptions. Covers: DB config, core schema (from migrations),
runtime app-level tables (discovered live), applied migrations, and the
corrections to previously-misstated "critical" issues.

## Database Configuration (Production)

- **Host**: Render — `https://pyrocore-backend.onrender.com`
- **DB path**: `/data/pyrocore.db` (Render persistent volume)
- **Storage root**: `/data/storage_files`
- **Backups path**: `/data/backups`
- **Pragmas** (verified live): `journal_mode=wal`, `synchronous=1 (NORMAL)`,
  `foreign_keys=1 (ON)`
- **Scheduled backups**: running (automated backups observed at ~3-min
  intervals during verification)

## Core Schema (from migrations 0001–0007)

These tables are created by the migration chain and exist in every deployment
(fresh or production). All 7 migrations are applied in every environment.

| Table | Purpose |
|-------|---------|
| `migrations` | Migration tracking (id, name, applied_at) |
| `users` | Auth users (id, email, password_hash, is_active, timestamps) |
| `sessions` | Session tokens (id, user_id→users, token, expires_at) |
| `api_keys` | API keys (id, project_id, name, scopes, **key_hash**, created_at, last_used_at, is_revoked) |
| `storage_files` | Uploaded files (id, original_filename, content_type, size_bytes, uploaded_at, project_id) |
| `projects` | Project registry (id, project_id, project_name, owner_id, status, slug, storage_location, backup_interval, enable_public_api, timestamps) |
| `password_reset_tokens` | Reset tokens (id, user_id→users, token_hash, expires_at, used_at, created_at) |

> **Correction (old draft was wrong):** the `api_keys` table stores
> `key_hash` (never the raw key). The older DEPLOY_STATE draft mistakenly
> listed a `key` column — that is incorrect.

## App-Level Tables (discovered live in production)

These 9 tables exist **only in the running production data DB**. They were
created at runtime via `POST /tables` / `POST /sql/execute` by the deployed
application (an exam-prediction / study-assistant product). They are
**project data, not platform schema**, and are intentionally NOT part of the
repo migration files — this is by design, not a gap.

| Table | Columns (name:type) |
|-------|---------------------|
| `subjects` | id:TEXT, user_id:TEXT, name:TEXT, code:TEXT, semester:INTEGER, academic_year:TEXT, total_marks:INTEGER, exam_date:TEXT, exam_duration_minutes:INTEGER, syllabus_json:JSON, papers_uploaded:INTEGER, predictions_generated:INTEGER, mock_tests_created:INTEGER, created_at:TEXT, updated_at:TEXT, exam_type:TEXT, exam_name:TEXT, university_name:TEXT |
| `questions` | id:TEXT, paper_id:TEXT, subject_id:TEXT, question_text:TEXT, question_number:INTEGER, marks:INTEGER, unit_name:TEXT, question_type:TEXT, difficulty:TEXT, correct_answer:TEXT, topics_json:JSON, text_length:INTEGER, created_at:TEXT, tagged_unit:TEXT, tagging_confidence:REAL |
| `question_papers` | id:TEXT, subject_id:TEXT, file_name:TEXT, file_path:TEXT, file_size_bytes:INTEGER, exam_year:INTEGER, exam_semester:TEXT, total_marks:INTEGER, duration_minutes:INTEGER, raw_text:TEXT, metadata_json:JSON, extraction_confidence:REAL, extraction_method:TEXT, processing_status:TEXT, error_message:TEXT, processed_at:TEXT, created_at:TEXT, updated_at:TEXT |
| `syllabus` | id:TEXT, subject_id:TEXT, raw_pdf_ref:TEXT, extracted_taxonomy:JSON, extracted_at:TEXT, created_at:TEXT, updated_at:TEXT |
| `unit_features` | id:TEXT, subject_id:TEXT, unit_name:TEXT, recurrence_count:INTEGER, recency_weight:REAL, marks_trend:REAL, last_asked_gap:INTEGER, computed_at:TEXT, created_at:TEXT, updated_at:TEXT |
| `predictions` | id:TEXT, user_id:TEXT, subject_id:TEXT, predicted_questions_json:JSON, total_questions:INTEGER, total_predicted_marks:INTEGER, unit_coverage_json:JSON, ml_analysis_json:JSON, prediction_accuracy_score:REAL, created_at:TEXT, updated_at:TEXT |
| `mock_tests` | id:TEXT, user_id:TEXT, subject_id:TEXT, total_questions:INTEGER, total_marks:INTEGER, duration_minutes:INTEGER, difficulty_level:TEXT, questions_json:JSON, start_time:TEXT, end_time:TEXT, is_completed:BOOLEAN, user_answers_json:JSON, score:REAL, percentage:REAL, correct_count:INTEGER, incorrect_count:INTEGER, skipped_count:INTEGER, weak_topics_json:JSON, strong_topics_json:JSON, created_at:TEXT |
| `exam_context_cache` | id:TEXT, exam_name:TEXT, context_summary:TEXT, fetched_at:TEXT, created_at:TEXT, updated_at:TEXT |
| `items` | id:INTEGER, name:TEXT (a scratch/test table created during API verification) |

## Applied Migrations (verified live)

All 7 core migrations are applied in production:

```
0001_init, 0002_add_api_keys, 0003_add_storage_table,
0004_add_is_active_to_users, 0005_add_projects,
0006_multi_project, 0007_password_reset_tokens
```

## Corrections to the previous (stale) draft

1. **"App-Level Schema Gap" is NOT a defect.** The draft called the absence of
   app-level tables from repo migrations "CRITICAL / blocking." In reality,
   app-level tables are **runtime-created project data** (the product's own
   tables). A fresh deployment correctly starts with only the 7 core tables
   and creates app tables on demand. No migration files should be added for
   them. This is working-as-intended, confirmed by the live production DB.
2. **`pyrocore.db-wal` is NOT tracked in git.** `git ls-files` shows no `*.db`,
   `*.db-wal`, or `*.db-shm` files. `.gitignore` already ignores `*.db`,
   `*.db-shm`, `*.db-wal`. The earlier "Issue 3" claim is stale/false.
3. **The "JSON decode error" was a test-client artifact, not a backend bug.**
   The earlier draft labeled
   `{"code":"validation_error","message":"body.1: JSON decode error"}` as
   CRITICAL. During verification, real `POST /auth/signup` and `POST /auth/login`
   calls (with correctly-formed JSON) succeeded. The error only appeared when
   the shell mangled the JSON body quoting — i.e. a client-side invocation
   mistake, not a server defect. All auth + CRUD endpoints work end-to-end.

## Deployment Safety (verified)

A fresh database (`DATABASE_PATH` pointed at a new file) with `run_pending_migrations`
applies all 7 migrations and yields exactly the 7 core tables. App-level tables
are created at runtime. This satisfies the "fresh deployment produces a complete,
working schema" success metric.

## Open items (non-blocking)

- **Phase 7 (repo migration files for app tables):** Not applicable — app-level
  tables are runtime data. No migration files should be added.
- **Phase 8 (JSON decode):** Resolved — was a client quoting artifact.
- **Phase 9 (git history cleanup):** No sensitive data is currently tracked;
  `.gitignore` is correct. No `git filter-repo` action required unless a
  secret was historically committed (none detected in current tree).
- **Phase 10 (test suite):** All 128 backend tests pass after fixing the
  `test_tables.py` migration-dir path bug (`parent.parent.parent` →
  `parent.parent`). The previously-reported `test_critical_journey.py` failure
  no longer reproduces.
- **Phase 11 (docs):** This document and `checklist.md` updated to reflect
  verified state.
