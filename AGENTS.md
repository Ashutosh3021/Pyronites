# AGENTS.md

Guidance for coding agents working **in** this repository.

## What this repo is

Two deliverables that ship together:

| Path | Package | Ships as |
|---|---|---|
| `backend/`, `cli/` | `pyrocore` | the self-hosted backend (PyPI, private-ish) |
| `pyronites/` | `pyronites` | the client SDK (**public PyPI**) |
| `frontend/` | — | the dashboard (Next.js, Vercel) |

## The rule that matters most

**The `pyronites/` directory is package source, not an app dependency.**

When you write application or example code that talks to a Pyronites backend:

```bash
pip install pyronites      # from PyPI — always
```

Never `pip install -e pyronites/`, never add the local path to `sys.path`, never copy client code out of `pyronites/pyronites/` into an app, and never advise the user to clone this repo to wire up their own project.

To check the client's real API, introspect the **installed** package:

```bash
python -c "import pyronites, inspect, os; print(os.path.dirname(inspect.getsourcefile(pyronites)))"
```

If a user's working directory happens to be this checkout, that does not change the rule for their app's dependencies — it only means you are now working *on* Pyronites rather than *with* it.

## Before provisioning anything for a user

Ask, and never invent: the backend URL, the email, the password (via env var or prompt, not a shell command), the **`project_id`**, and whether an **`admin`-scoped** API key exists. Confirm the `project_id` back to the user before creating tables — a wrong id silently writes to the wrong database.

The dashboard exports these values as a **connection prompt** (`/connect` in the
dashboard, `GET /api/projects/{id}/connect-prompt` on the backend). It is a
block of `PYRONITES_*` lines plus wiring instructions, and it is what the
`pyronites-wiring` skill consumes. Prefer the exported prompt over hand-written
instructions — it carries the project slug, the project id and the account
email, which are exactly the values that must never be guessed.

The skill itself lives in `SKILL/SKILL.md` (mirrored to
`~/.opencode/skills/pyronites-wiring/SKILL.md`). It and the prompt template in
`backend/core/connect_prompt.py` describe the same contract — change one, change
the other.

## Conventions

**Backend**
- Endpoints live in `backend/api/`, one router per concern. Domain logic lives in `backend/auth/` or `backend/core/`. Routers must not reach into tables directly.
- All credentials are opaque `secrets.token_urlsafe(32)` tokens, stored **only** as a SHA-256 hash, returned to the client exactly once. Never log or echo a raw token.
- Env vars that tests need to override are read **at request time** through a small `_get_*()` helper, not at import.
- Schema changes go in a new numbered `backend/migrations/NNNN_*.sql`. Migrations apply lexicographically at startup.
- Error responses use `ErrorResponse(code=..., message=...)` from `backend/api/schemas.py`. The user-facing message should name the fix.
- A row is addressed by the table's **primary key**, resolved from `PRAGMA table_info` in `backend/core/rows.py`. Never hard-code a column named `id`.

**Client (`pyronites/`)**
- `create_client(..., project_id=...)` scopes every table/storage/SQL call to
  `/api/projects/{project_id}/...`. Keep the project id plumbed through —
  without it the client falls back to the legacy unscoped plane, which
  project-scoped keys are not allowed to use.
- `update()` and `delete()` address a row by the primary key. The key is
  resolved from `/tables/{name}/schema` and cached per table.

**Frontend**
- Tailwind v4, CSS-first. All tokens live in `app/globals.css`. There is no `tailwind.config.js`.
- **Border radius must never exceed 1px.** The scale is 0px with `--radius-max: 1px`. Do not introduce `rounded-lg` or larger.
- Brand orange is `--pyro-orange` (`#ff6a00`); `--accent` maps to it. Keep the sharp, angular, orange-accented look.
- Errors surface through `components/alert-banner.tsx`. Do not invent a second error mechanism.
- `next.config.mjs` currently sets `typescript.ignoreBuildErrors: true`, so type errors will **not** fail the build. Run `tsc --noEmit` explicitly.

## Verification

```bash
python -m pytest                              # backend + cli + client
cd frontend && npx tsc --noEmit && npm run build
```

`conftest.py` blanks `BREVO_API_KEY` so tests never send real email. Keep it that way.

## Releases

The `pyronites` client publishes to PyPI from `.github/workflows/publish-pyronites.yml`:
a push to `main` tests, builds and uploads the version in `pyronites/pyproject.toml`.

- `pyronites/pyproject.toml` is the source of truth for the client version. The
  workflow syncs `pyronites/pyronites/__init__.py` to match before building, so
  bumping one file is enough.
- `python scripts/set_version.py --set X.Y.Z` writes both files;
  `--sync` copies pyproject's version into `__init__.py`; `--check` fails if
  the two files drift apart.
- The workflow skips the upload when that version is already on PyPI. PyPI never
  accepts the same version twice, so every release needs a bump.
- Publishing needs the `PYPI_API_TOKEN` repository secret (a PyPI token scoped to
  the `pyronites` project). Full details in `pyronites/docs/PUBLISH.md`.
