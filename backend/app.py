import asyncio
import os
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.health import router as health_router
from backend.api.tables import router as tables_router
from backend.api.storage import router as storage_router
from backend.api.sql_editor import router as sql_router
from backend.api.auth import router as auth_router
from backend.api.projects import router as projects_router
from backend.api.apikeys import router as apikeys_router
from backend.api.system import router as system_router
from backend.api.schemas import ErrorResponse
from backend.core.db import Database
from backend.core.migrations import get_migration_files, run_pending_migrations
from backend.core.backup import scheduled_backup_loop
from backend.core.s3_sync import load_s3_config
from backend.core.logring import install as install_logring, record_event

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

DEFAULT_MIGRATIONS_DIR = str(Path(__file__).parent / "migrations")


def create_app() -> FastAPI:
    """
    Build the PyroCore FastAPI application.

    This is the single source of truth for the API surface.  Both the container
    entry point (``backend.app:app``) and the CLI ``pyrocore start`` command use
    it, so they can never drift apart (routers, prefixes, or middleware).
    """
    db_path = os.environ.get("DATABASE_PATH", "pyrocore.db")
    migrations_dir = os.environ.get("MIGRATIONS_DIR", DEFAULT_MIGRATIONS_DIR)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info("Starting up: db=%s migrations=%s", db_path, migrations_dir)
        # Begin capturing application events into the in-memory log ring so the
        # dashboard Logs page has something to show even before any user action.
        install_logring()

        # Ensure the on-disk layout for the persistent volume exists before
        # anything touches it.  On a brand-new deploy the platform mounts an
        # empty volume at /data; if these dirs are missing the first upload or
        # backup would 500.  Creating them here (and running as a user that can
        # write the mount) avoids the "worked locally because the dir already
        # existed" trap.
        storage_root = os.environ.get("STORAGE_ROOT", "storage_files")
        backup_dir = str(Path(db_path).parent / "backups")
        for d in (os.path.dirname(db_path) or ".", storage_root, backup_dir):
            try:
                Path(d).mkdir(parents=True, exist_ok=True)
            except OSError as e:
                logger.warning("Could not create directory %s: %s", d, e)

        # ── S3 / object-storage sync (free-tier persistence) ──────────────────
        # On platforms with no persistent disk (Render free tier), the DB lives
        # on an ephemeral filesystem.  If sync is enabled, pull the latest copy
        # from the bucket *before* migrations so a fresh container resumes the
        # previous state instead of starting from an empty schema — and so any
        # newer migrations are applied to the restored file.  `s3` is None when
        # S3_SYNC_ENABLED is unset, so this whole block is a no-op in that case.
        s3 = load_s3_config()
        if s3 is not None:
            try:
                restored = await asyncio.to_thread(s3.download, db_path)
                logger.info(
                    "S3 restore: %s",
                    "downloaded latest DB" if restored else "no remote DB / local present",
                )
            except Exception as e:
                logger.error(
                    "S3 restore error (continuing with local/empty DB): %s", e, exc_info=True
                )

        logger.info("Running pending migrations...")
        db = Database(db_path)
        db.connect()
        try:
            run_pending_migrations(db, migrations_dir)
            logger.info("Migrations complete!")
        except Exception as e:
            logger.error("Failed to run migrations!", exc_info=True)
            raise
        finally:
            db.close()

        record_event("info", "Server started")

        # ── Scheduled backup loop ──────────────────────────────────────────────
        # Started here (not in the CLI) so it runs no matter how the app is
        # launched — directly via `uvicorn backend.app:app` in the Docker image,
        # or via `pyrocore start`.  Without this, the containerised deploy would
        # never create backups.  Takes an immediate backup on startup, then
        # repeats every BACKUP_INTERVAL_SECONDS (default 3600 = 1h).  When S3
        # sync is enabled, each backup is also pushed to the bucket (on_backup).
        backup_interval = int(os.environ.get("BACKUP_INTERVAL_SECONDS", "3600"))
        s3_upload = (lambda p: s3.upload(p)) if s3 is not None else None
        backup_task = None
        try:
            backup_task = asyncio.create_task(
                scheduled_backup_loop(
                    db_path, backup_dir, backup_interval, on_backup=s3_upload
                )
            )
            logger.info("Scheduled backup loop started (interval=%ss)", backup_interval)
        except Exception as e:
            logger.error("Failed to start backup loop: %s", e, exc_info=True)

        yield  # App runs here

        logger.info("Shutting down...")
        if s3 is not None:
            # Best-effort final push so the last few minutes of writes survive
            # a graceful shutdown (SIGTERM) even between scheduled backups.
            try:
                await asyncio.to_thread(s3.upload, db_path)
                logger.info("S3: final upload on shutdown complete")
            except Exception as e:
                logger.error("S3: final upload on shutdown failed: %s", e, exc_info=True)
        if backup_task is not None:
            backup_task.cancel()
            try:
                await backup_task
            except (asyncio.CancelledError, Exception):
                pass

    app = FastAPI(lifespan=lifespan, title="PyroCore API")

    # ── CORS ────────────────────────────────────────────────────────────────
    # The Next.js dashboard dev server (default :3000) calls this API (:8000)
    # from the browser with credentials:'include' (session cookie).  That is a
    # cross-origin request, so we must explicitly allow the dashboard origin
    # AND allow credentials — otherwise the browser blocks the calls and never
    # sends the cookie.  Origins are configurable via FRONTEND_ORIGIN (comma
    # separated) for non-default deployments.
    frontend_origins = os.environ.get("FRONTEND_ORIGIN")
    if frontend_origins:
        allow_origins = [o.strip() for o in frontend_origins.split(",") if o.strip()]
    else:
        # No explicit origin configured — allow any origin.  PyroCore is a
        # self-hosted, single-tenant tool, so a cross-origin dashboard (e.g.
        # Vercel frontend -> Render backend) works out of the box without manual
        # env config.  Set FRONTEND_ORIGIN to a comma-separated list to lock this
        # down to specific origins in production.
        allow_origins = ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # --- Uniform error handling ---------------------------------------------
    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(p) for p in first.get("loc", []))
        message = first.get("msg", "Request validation failed")
        if loc:
            message = f"{loc}: {message}"
        return JSONResponse(
            status_code=422,
            content=ErrorResponse(code="validation_error", message=message).model_dump(),
        )

    @app.exception_handler(HTTPException)
    async def _http_exception_handler(
        request: Request, exc: HTTPException
    ) -> JSONResponse:
        # FastAPI wraps ``HTTPException(detail=<dict>)`` as ``{"detail": <dict>}``.
        # Our routers raise with ``detail=ErrorResponse(...).model_dump()``, so we
        # unwrap it to a top-level ``{"code", "message"}`` envelope that matches the
        # JSONResponse-based handlers (validation_error, etc.) and what the
        # frontend's ``body?.message`` reads.  This keeps every error shape
        # consistent across the whole API instead of mixing ``detail``-wrapped and
        # flat envelopes.
        detail = exc.detail
        if isinstance(detail, dict) and ("code" in detail or "message" in detail):
            body = detail
        else:
            body = ErrorResponse(code="error", message=str(detail)).model_dump()
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.exception_handler(Exception)
    async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "Unhandled exception on %s %s: %s",
            request.method,
            request.url.path,
            type(exc).__name__,
            exc_info=True,
        )
        record_event("error", f"{request.method} {request.url.path} failed: {type(exc).__name__}")
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                code="internal_error", message="Internal server error"
            ).model_dump(),
        )

    # Include routers — note: no global "/api" prefix.  The documented REST
    # contract (see ARCHITECTURE.md §4) is /tables, /storage, /health, /sql.
    # The newer dashboard-facing routers (auth/projects/keys/system) use their
    # own /api or /auth prefixes to match the frontend's call sites.
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(tables_router)
    app.include_router(storage_router)
    app.include_router(sql_router)
    app.include_router(projects_router)
    app.include_router(apikeys_router)
    app.include_router(system_router)

    return app


# Module-level app used by `python -m uvicorn backend.app:app` and the Dockerfile.
app = create_app()


if __name__ == "__main__":
    import uvicorn

    HOST = os.environ.get("HOST", "0.0.0.0")
    PORT = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host=HOST, port=PORT)
