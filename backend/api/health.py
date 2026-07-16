"""
Health-check endpoint.

Returns HTTP 200 when the database is reachable, HTTP 503 when it is not.
This lets load balancers and container orchestrators (Docker healthcheck,
Kubernetes liveness probe) automatically remove a degraded instance from
rotation rather than continuing to route traffic to it.

Response shape
--------------
::

    {
        "status": "ok" | "degraded",
        "database": true | false
    }
"""
import os
import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from backend.core.db import Database

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])


def _get_db() -> Database:
    """Open a short-lived DB connection just for the health check."""
    db = Database(os.environ.get("DATABASE_PATH", "pyrocore.db"))
    db.connect()
    return db


@router.get(
    "/health",
    summary="Health check",
    description=(
        "Returns 200 + ``{status: 'ok'}`` when the database is reachable. "
        "Returns 503 + ``{status: 'degraded'}`` otherwise so that "
        "load balancers can remove the instance from rotation."
    ),
    responses={
        200: {"description": "Service healthy"},
        503: {"description": "Database unreachable"},
    },
)
async def health() -> JSONResponse:
    """
    Verify that the API process is alive **and** the database is reachable.

    A 200 with ``database: false`` is intentionally not possible — if the DB
    is down we return 503, not 200, so infrastructure-level health checks work
    correctly without having to inspect the response body.
    """
    db_ok = False
    db = None
    try:
        db = _get_db()
        cursor = db.execute("SELECT 1")
        cursor.fetchone()
        db_ok = True
    except Exception:
        logger.error("Health check failed: database unreachable", exc_info=True)
    finally:
        if db is not None:
            db.close()

    payload = {"status": "ok" if db_ok else "degraded", "database": db_ok}
    status_code = 200 if db_ok else 503
    return JSONResponse(content=payload, status_code=status_code)
