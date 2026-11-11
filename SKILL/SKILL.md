---
name: pyronites-wiring
description: End-to-end setup and wiring of Pyronites (PyroCore), the self-hosted Python backend plus the `pyronites` client package. Use this skill whenever the user mentions Pyronites or PyroCore, or wants to install the `pyronites` package, start or check the backend, sign up or log in, create an API key, create tables, set PYRONITES_URL / PYRONITES_KEY, or integrate the client into a project — even if they only say "connect my app to Pyronites", "get me an API key", "make a notes table", or paste a Pyronites connection prompt. Also use it to debug a failing Pyronites setup (401/403/404/409/429 errors, missing key, backend not reachable, data going to the wrong project).
---

# Pyronites setup and wireup

Goal: take the user from "nothing" to a **verified** client call against a running
backend, wired to **their** project, with secrets handled safely.

The user drives this by exporting a **connection prompt** from the PyroCore
dashboard and pasting it here. That prompt is the single source of truth for the
backend URL, the account, the project, and the API key. Never invent any of
those values.

---

## Hard rules (read before anything else)

1. **Never clone, read, or `pip install -e` the Pyronites repository.** Do not
   read `docs/syntax.md`, do not browse GitHub for the source, do not look for a
   local checkout. This skill is complete on its own. If some checkout happens
   to be on disk, ignore it — reading it is a bug, not diligence.
2. **Install the client from PyPI only:** `pip install pyronites`. That is the
   entire dependency story for app code.
3. **Verify the API against the installed package,** not against any repo:
   ```bash
   python -c "import pyronites, inspect, os; print(os.path.dirname(inspect.getsourcefile(pyronites)))"
   ```
   If a call looks unfamiliar, read the file that command prints. That is the
   only source of truth.
4. **Never invent credentials.** No URLs, no emails, no passwords, no keys, no
   project ids. Everything comes from the exported prompt or from the user.
5. **Never echo, log, or commit a password or raw API key.** Put secrets in
   `.env` (git-ignored) or a secrets manager — never in source, never in chat.
6. **Never write to the wrong project.** Every table, file and row operation
   must carry the project id from the prompt. A silent write to another
   project's database is worse than no write.

---

## Step 0 — Get the connection prompt

The dashboard exports the prompt: **Connect → copy prompt** (sidebar). It is a
block of `KEY=value` lines followed by the wiring instructions.

**If the user pasted the prompt, parse it. If they did not, ask for it** — in
one short message: *"Paste the connection prompt from PyroCore → Connect, or
give me the backend URL, your email, the project slug and project id, and an
API key."* Do not proceed on invented values.

| Field in the prompt | Meaning | Required |
|---|---|---|
| `PYRONITES_URL` | base URL of the user's own backend | yes |
| `PYRONITES_EMAIL` | the account that owns the project | yes (for login flows) |
| `PYRONITES_PROJECT_NAME` | human-readable project name | no |
| `PYRONITES_PROJECT_SLUG` | project slug — accepted by the API as the project id | yes |
| `PYRONITES_PROJECT_ID` | canonical project UUID | yes |
| `PYRONITES_API_KEY` | project-scoped API key | yes for app code |

The API key in the prompt is **project-scoped**: it can only reach the project
named in the prompt. If the key field is empty, say so and ask the user to fill
it in (dashboard → Connect → paste or generate a key) — do not mint one
yourself and do not proceed without a working credential.

**State the plan back before writing anything:** the backend URL, the project
slug + id, and the key's scopes. A wrong project id silently targets the wrong
database, so this confirmation is mandatory.

---

## Step 1 — Confirm the backend is reachable

```bash
curl -s -w "\n%{http_code}\n" "$PYRONITES_URL/health"   # expect 200 and {"status":"ok"}
```

If it is not running, ask the user how they run it. Offer these, in order:

```bash
docker compose up --build        # if they have the repo checked out
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000   # if running from a checkout
```

**Do not clone the repository yourself** — the user owns their deployment. If
they have not deployed anything yet, ask whether they want to; do not assume.

If `/health` works but later endpoints 404, the path layout may differ by
version. Check `$PYRONITES_URL/openapi.json` (or `/docs`) and trust it over
this document.

---

## Step 2 — Install the client and check its capabilities

```bash
pip install -U pyronites
python -c "import pyronites; print(pyronites.__version__)"
python -c "import inspect, pyronites; print('project_id' in inspect.signature(pyronites.create_client).parameters)"
```

`pyronites >= 1.4.0` supports `create_client(..., project_id=...)`, which is
what scopes every call to the right project. If the installed client is older,
either ask the user to upgrade (`pip install -U pyronites`), or skip the
client entirely and talk to the project-scoped API over plain HTTP — see
[Fallback: no client](#fallback-no-client). Both paths reach the same
endpoints; the client is the nicer one.

---

## Step 3 — Configure the app

Write these into the app's `.env` (create it if the project has no env loader
yet). Never print the key back to the user.

```dotenv
PYRONITES_URL=<from the prompt>
PYRONITES_KEY=<from the prompt: PYRONITES_API_KEY>
PYRONITES_PROJECT_ID=<from the prompt: PYRONITES_PROJECT_ID>
```

1. Make sure `.env` is in `.gitignore` (append if missing).
2. Load it with `python-dotenv` (`load_dotenv()`) or the framework's own
   mechanism — do not add a second env loader to a project that already has
   one.
3. Tell the user where the key was saved. Do not print it back. If they lose
   it, create a new one — it cannot be retrieved.

---

## Step 4 — Build the client, project-scoped

```python
import os
from pyronites import create_client, ApiError, AuthError, NotFoundError

client = create_client(
    url=os.environ["PYRONITES_URL"],
    key=os.environ["PYRONITES_KEY"],
    project_id=os.environ["PYRONITES_PROJECT_ID"],
)
```

Build it **once** and pass it around (a module-level client, a FastAPI
dependency, a Django service object). Do not create a client per request —
each one opens its own connection pool.

With `project_id` set, every table, storage and SQL call is rewritten to
`/api/projects/{project_id}/...`, so the client cannot reach another
project's data even if the key were reused.

### Client API cheat sheet

Verify anything surprising against the installed package (hard rule 3).

```python
# Tables — Supabase-style chainable queries
client.table("notes").insert({"title": "Hello", "body": "World"})   # returns inserted row
client.table("notes").select().limit(10)                             # iterable of dicts
client.table("notes").select().eq("id", 1).order("created_at", desc=True)
client.table("notes").update({"title": "Updated"}).eq("id", 1)
client.table("notes").delete().eq("id", 1)
client.tables()                                                      # table names + row counts
client.table("notes").schema()                                       # columns, types, primary key

# Tables — admin scope
client.create_table("notes", columns=[{"name": "id", "type": "TEXT"}], primary_key="id")
client.drop_table("notes")

# Auth
client.auth.sign_in("user@example.com", "password")
client.auth.sign_out()
client.auth.user()

# Storage
meta = client.storage.upload("photo.jpg")   # returns dict with "id"
data = client.storage.download(meta["id"])

# Errors
from pyronites import ApiError, AuthError, NotFoundError
```

Use `list(...)` when you need a materialized list; the query builder is lazy.

**Primary keys are not always named `id`.** `update()` and `delete()` address a
row by the table's primary key. If the client rejects the filter column, read
`client.table(name).schema()` — the column with `pk: true` is the right one,
and the error message names it.

---

## Step 5 — Tables the app needs

Creating tables needs the `admin` scope. If the key in the prompt has only
`read`/`write`, tell the user and ask whether they want an admin key — do not
silently escalate.

Only create tables the app actually needs. First list what exists:

```python
print(client.tables())
```

Then create what is missing (skip this if the user has no admin key and the
table already exists):

```python
from pyronites import ApiError

try:
    client.create_table(
        "notes",
        columns=[
            {"name": "id", "type": "TEXT"},
            {"name": "title", "type": "TEXT"},
            {"name": "body", "type": "TEXT"},
            {"name": "created_at", "type": "DATETIME"},
        ],
        primary_key="id",
    )
except ApiError as e:
    if e.status_code != 409:
        raise
```

Rules:
- Column types: `TEXT INTEGER REAL BLOB NUMERIC BOOLEAN DATETIME DATE JSON`.
- Table names match `^[A-Za-z_][A-Za-z0-9_]*$` and must not be reserved:
  `users sessions api_keys migrations projects storage_files
  password_reset_tokens oauth_identities`.
- If the table already exists, show the user the existing schema instead of
  recreating it.

---

## Step 6 — Verify (do not declare success without this)

Run the checks yourself. A verification that was skipped is a verification that
failed.

1. **Health** — `GET {url}/health` returns `{"status": "ok"}`.
2. **Auth** — the client is accepted (a `401`/`403` here means the key or the
   project id is wrong, not that the code is).
3. **Read** — `client.tables()` lists the project's tables, and a select
   against one of them returns without error.
4. **Write round-trip** — insert a probe row, read it back, delete it again.
   Resolve the key column first, because it is not always named `id`:

   ```python
   columns = client.table("notes").schema()
   key = next(c["name"] for c in columns if c.get("pk"))

   row = client.table("notes").insert({"title": "pyronites-wiring-probe"})
   assert row["title"] == "pyronites-wiring-probe"

   found = list(client.table("notes").select().eq(key, row[key]))
   assert found, "probe row not found after insert"

   client.table("notes").delete().eq(key, row[key])
   ```

   If the table has no primary key at all, create the probe in a table that
   has one — a table without a key cannot address a single row, and the
   backend says so with a `400` that names the fix.
5. **App path** — the application's own read/write code goes through the same
   client. Open the file that does the data access and check it uses the
   configured client rather than a hardcoded URL or key.
6. **Isolation** — confirm the client is scoped: the requests in the logs or
   the server's request log should show `/api/projects/{project_id}/...`.

Clean up the probe row. If any check fails, fix it and re-run — do not report
a partial result as success.

Then report a checklist, marking each line done / skipped / failed:

- [ ] `/health` returns ok
- [ ] `pyronites` installed, version and capabilities checked
- [ ] Project slug + id confirmed with the user
- [ ] Key saved to `.env` (not committed), `.env` git-ignored
- [ ] App reads config from the environment, not from literals
- [ ] Client built once, with `project_id`, and used by the app
- [ ] Requested tables exist in the confirmed project
- [ ] Read verified
- [ ] Write round-trip verified (insert → read → delete)
- [ ] Probe row cleaned up

---

## Step 7 — Report

State plainly what is wired, which project it points at, and what you verified.
Include the file paths you changed. If anything was skipped, say which and
why. Never claim a check passed that you did not run.

---

## Stop and ask when…

Do not guess. Pause and ask the user whenever:

- The prompt is missing a value (URL, email, project id, or key).
- The backend URL does not answer `/health`.
- The key is rejected (401/403) — ask whether it belongs to this project
  rather than retrying.
- A request succeeds but against a **different project** than the prompt names.
  Re-check the project id before anything else; this is almost always the
  cause.
- The tables the app needs are ambiguous, or their columns are unclear.
- You cannot find where in the codebase the database should be used.
- The app already has its own client, ORM or data layer and the integration
  would replace or conflict with it.

Ask **one** focused question at a time. Do the parts you are sure of first,
then ask.

---

## Errors: what to do

| Symptom | Likely cause → action |
|---|---|
| Connection refused / timeout | Backend not running or wrong URL → step 1 |
| 409 on signup | Account exists → log in instead |
| 401 | Bad credentials, expired session, or bad key → re-login or recreate key |
| 403 "not valid for this project" | Key belongs to another project → check the prompt's project id |
| 403 "belongs to a project-scoped endpoint" | Scoped key used on a legacy unscoped path → use `/api/projects/{id}/...` |
| 403 "Insufficient permissions" | Key lacks the scope → create a key with the needed scope |
| 404 `table_not_found` | Create the table or fix the name |
| 404 on a route | Path differs by version, or wrong `project_id` → check `/openapi.json` |
| 429 | Rate limited → wait for the `Retry-After` header, then retry once |
| Data missing from the app but present in the dashboard | Wrong plane: the client is hitting the legacy unscoped route → set `project_id` |

Always show the user `code` and `message` from the error body; they usually
name the exact fix.

---

## Fallback: no client

If the project cannot take a new dependency, or the installed client is older
than `1.4.0` and the user does not want to upgrade, talk to the API directly.
**Always use the project-scoped paths** — the unscoped ones are the legacy
plane and are rejected for project-scoped keys.

```bash
pip install requests   # if it is not already a dependency
```

```python
import os, requests

base = os.environ["PYRONITES_URL"].rstrip("/")
pid = os.environ["PYRONITES_PROJECT_ID"]
key = os.environ["PYRONITES_KEY"]
headers = {"Authorization": f"Bearer {key}"}

r = requests.get(f"{base}/api/projects/{pid}/tables", headers=headers, timeout=30)
r.raise_for_status()
print(r.json())
```

Run the same verification checklist as in step 6 — health, read, write
round-trip — through these calls. The rules are identical: project-scoped
paths only, the row key comes from `/schema`, and the probe row is cleaned up.

| Action | Project-scoped path | Auth |
|---|---|---|
| Health | `GET /health` | none |
| Tables | `GET /api/projects/{pid}/tables` | read |
| Schema | `GET /api/projects/{pid}/tables/{name}/schema` | read |
| Rows | `GET`/`POST`/`PATCH`/`DELETE /api/projects/{pid}/tables/{name}` | read / write |
| One row | `GET`/`PATCH`/`DELETE /api/projects/{pid}/tables/{name}/{id}` | read / write |
| Storage | `/api/projects/{pid}/storage/...` | read / write |
| SQL | `POST /api/projects/{pid}/sql/execute` | write |
| Keys | `GET`/`POST`/`DELETE /api/projects/{pid}/api/keys` | read / admin |
| Connection prompt | `GET /api/projects/{pid}/connect-prompt` | read |

`{id}` is the value of the table's **primary key** — read it from
`/schema` (`pk: true`), it is not always `id`.

---

## Security rules

- Never invent credentials, URLs, or project ids; never log, echo, or commit a
  password or raw key.
- Least privilege for keys that ship in apps: `read`/`write`. Keep `admin` keys
  out of deployed code.
- Secrets live in `.env` or a secrets manager, not in source.
- The project id is not a secret, but treat the prompt as sensitive anyway: it
  contains a credential.
