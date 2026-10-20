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

## Conventions

**Backend**
- Endpoints live in `backend/api/`, one router per concern. Domain logic lives in `backend/auth/` or `backend/core/`. Routers must not reach into tables directly.
- All credentials are opaque `secrets.token_urlsafe(32)` tokens, stored **only** as a SHA-256 hash, returned to the client exactly once. Never log or echo a raw token.
- Env vars that tests need to override are read **at request time** through a small `_get_*()` helper, not at import.
- Schema changes go in a new numbered `backend/migrations/NNNN_*.sql`. Migrations apply lexicographically at startup.
- Error responses use `ErrorResponse(code=..., message=...)` from `backend/api/schemas.py`. The user-facing message should name the fix.

**Frontend**
- Tailwind v4, CSS-first. All tokens live in `app/globals.css`. There is no `tailwind.config.js`.
- **Border radius must never exceed 1px.** The scale is 0px with `--radius-max: 1px`. Do not introduce `rounded-lg` or larger.
- Brand orange is `--pyro-orange` (`#ff6a00`); `--accent` maps to it. Keep the sharp, angular, orange-accented look.
- Errors surface through `components/alert-banner.tsx`. Do not invent a second error mechanism.
- `next.config.mjs` currently sets `typescript.ignoreBuildErrors: true`, so type errors will **not** fail the build. Run `tsc --noEmit` explicitly.

## Verification

```bash
python -m pytest                              # backend + cli
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
