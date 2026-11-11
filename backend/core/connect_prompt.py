"""
The connection prompt the dashboard exports for wiring an app to Pyronites.

The prompt is the contract between the dashboard and the ``pyronites-wiring``
skill.  It carries everything an agent needs — backend URL, account email,
project slug, project id and a single API key field — in a shape that is both
readable by a human and parseable by a machine (``KEY=value`` lines).

The API key is deliberately left blank: the dashboard shows the raw key exactly
once, and the user pastes it into the prompt.  The prompt never carries a
credential the user did not explicitly provide.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from backend.core.db import Database

# Placeholder left in the rendered prompt where the user pastes their key.
API_KEY_PLACEHOLDER = "PYRONITES_API_KEY="


def user_email(db: Database, user_id: Optional[str]) -> Optional[str]:
    """Return the email of ``user_id``, or None when it cannot be resolved."""
    if not user_id:
        return None
    try:
        cursor = db.execute("SELECT email FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
    except Exception:
        return None
    if row and row[0]:
        return str(row[0])
    return None


def build_connect_prompt(
    *,
    backend_url: str,
    email: Optional[str],
    project_name: str,
    project_slug: str,
    project_id: str,
    api_key: str = "",
) -> str:
    """
    Render the project-scoped connection prompt.

    Args:
        backend_url: Base URL of the Pyronites backend.
        email: Account email of the signed-in owner.
        project_name: Human-readable project name.
        project_slug: Project slug (also accepted by the API as the project id).
        project_id: Canonical project UUID.
        api_key: Raw API key. Empty by default — the user fills this in.
    """
    base = (backend_url or "").rstrip("/")
    return f"""# Pyronites (PyroCore) — connect this project to the database
#
# These credentials are PROJECT-SCOPED: the API key below can only reach the
# project named below. Never reuse it for a different project.

PYRONITES_URL={base}
PYRONITES_EMAIL={email or ''}
PYRONITES_PROJECT_NAME={project_name}
PYRONITES_PROJECT_SLUG={project_slug}
PYRONITES_PROJECT_ID={project_id}
{API_KEY_PLACEHOLDER}{api_key}

--- What to do with this -----------------------------------------------

1. Install the client (this is the only dependency the app needs):

       pip install pyronites

2. Put the values above in the app's .env file (never in source control, and
   make sure .env is git-ignored). The API key belongs in PYRONITES_KEY:

       PYRONITES_URL={base}
       PYRONITES_KEY=<the key from PYRONITES_API_KEY>
       PYRONITES_PROJECT_ID={project_id}

3. Build the client once, with the project id so every call is project-scoped:

       import os
       from pyronites import create_client

       client = create_client(
           url=os.environ["PYRONITES_URL"],
           key=os.environ["PYRONITES_KEY"],
           project_id=os.environ["PYRONITES_PROJECT_ID"],
       )

4. Use it from the app code:

       client.table("notes").insert({{"title": "Hello"}})
       client.table("notes").select().limit(10)
       client.table("notes").delete().eq("id", 1)

5. Verify the wiring end to end before reporting success:
   - GET {base}/health returns {{"status": "ok"}}
   - client.tables() lists the tables of THIS project only
   - a probe row can be inserted, read back, and deleted again
   - the app's own read/write path uses the same client

6. If anything is ambiguous — which tables the app needs, what the columns
   should be, where in the codebase the client belongs — STOP and ask.
   Never guess a schema, a table name, or a credential.

Account email: {email or '(unknown)'}
Project: {project_name} (slug: {project_slug}, id: {project_id})
"""
