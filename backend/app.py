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
from backend.api.project_scoped import router as project_scoped_router
from backend.api.schemas import ErrorResponse
from backend.core.db import Database
from backend.core.migrations import get_migration_files, run_pending_migrations
from backend.core.legacy_adoption import run_legacy_adoption
from backend.core.backup import scheduled_backup_loop
from backend.core.s3_sync import load_s3_config
from backend.core.env import load_env
from backend.core.logring import install as install_logring, record_event

# Load the repo-root .env (setdefault semantics — real env always wins; the
# container/test/harness paths are kept). Runs before create_app() reads config.
load_env()

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

DEFAULT_MIGRATIONS_DIR = str(Path(__file__).parent / "migrations")

_DEFAULT_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://pyronites.vercel.app",
]


def create_app() -> FastAPI:
    db_path = os.environ.get("DATABASE_PATH", "pyrocore.db")
    migrations_dir = os.environ.get("MIGRATIONS_DIR", DEFAULT_MIGRATIONS_DIR)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info("Starting up: db=%s migrations=%s", db_path, migrations_dir)
        install_logring()

        storage_root = os.environ.get("STORAGE_ROOT", "storage_files")
        backup_dir = str(Path(db_path).parent / "backups")
        from backend.core.projects import projects_dir

        projects_data = str(projects_dir())
        for d in (os.path.dirname(db_path) or ".", storage_root, backup_dir, projects_data):
            try:
                Path(d).mkdir(parents=True, exist_ok=True)
            except OSError as e:
                logger.warning("Could not create directory %s: %s", d, e)

        s3 = load_s3_config()
        if s3 is not None:
            try:
                restored = await asyncio.to_thread(
                    s3.download_all, db_path, projects_data, storage_root
                )
                logger.info(
                    "S3 restore: %s",
                    "downloaded remote data" if restored else "no remote data / local present",
                )
            except Exception as e:
                logger.error(
                    "S3 restore error (continuing with local/empty DB): %s", e, exc_info=True
                )

        database = Database(db_path)
        database.connect()
        try:
            logger.info("Running pending migrations...")
            try:
                run_pending_migrations(database, migrations_dir)
                logger.info("Migrations complete!")
            except Exception:
                logger.error("Failed to run migrations!", exc_info=True)
                raise
            # One-time adoption: copy legacy (unscoped-plane) tables from the
            # meta DB into their owning project file(s) so the scoped
            # dashboard sees them.  Gated by LEGACY_ADOPTION_MAP + marker row
            # in the migrations table; never raises (see legacy_adoption).
            try:
                run_legacy_adoption(database)
            except Exception:
                logger.error("Legacy adoption failed (continuing)!", exc_info=True)
        finally:
            database.close()

        record_event("info", "Server started")

        backup_interval = int(os.environ.get("BACKUP_INTERVAL_SECONDS", "3600"))
        # H3/C1: after each backup, push the *consistent backup file* (not the
        # live DB) plus project DBs and storage files to the bucket.
        s3_upload = (
            (
                lambda backup_file: s3.upload_all(
                    db_path,
                    snapshot_file=str(backup_file),
                    projects_dir=projects_data,
                    storage_root=storage_root,
                )
            )
            if s3 is not None
            else None
        )
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

        yield

        logger.info("Shutting down...")
        if backup_task is not None:
            backup_task.cancel()
            try:
                await backup_task
            except (asyncio.CancelledError, Exception):
                pass
        if s3 is not None:
            try:
                from backend.core.backup import backup_now

                def _final_sync():
                    # H3: snapshot first, then push the snapshot + full data
                    # dir so the bucket never holds a torn live-file copy.
                    final_backup = backup_now(db_path, backup_dir)
                    s3.upload_all(
                        db_path,
                        snapshot_file=str(final_backup),
                        projects_dir=projects_data,
                        storage_root=storage_root,
                    )

                await asyncio.to_thread(_final_sync)
                logger.info("S3: final backup + full sync on shutdown complete")
            except Exception as e:
                logger.error("S3: final sync on shutdown failed: %s", e, exc_info=True)
        try:
            from backend.core.db import close_shared_databases

            close_shared_databases()
        except Exception as e:
            logger.warning("Closing shared DB connections failed: %s", e)

    app = FastAPI(lifespan=lifespan, title="PyroCore API")

    frontend_origins = os.environ.get("FRONTEND_ORIGIN")
    if frontend_origins:
        allow_origins = [o.strip() for o in frontend_origins.split(",") if o.strip()]
    else:
        allow_origins = list(_DEFAULT_ORIGINS)

    # C2: no wildcard origin regex by default — CORS is exact-origins only.
    # Operators can still opt in to an explicit pattern via FRONTEND_ORIGIN_REGEX.
    allow_origin_regex = os.environ.get("FRONTEND_ORIGIN_REGEX") or None

    logger.info(
        "CORS allow_origins=%s allow_origin_regex=%s",
        allow_origins,
        allow_origin_regex,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_origin_regex=allow_origin_regex or None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

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
        detail = exc.detail
        if isinstance(detail, dict) and ("code" in detail or "message" in detail):
            body = detail
        else:
            body = ErrorResponse(code="error", message=str(detail)).model_dump()
        headers = exc.headers or {}
        return JSONResponse(status_code=exc.status_code, content=body, headers=headers)

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

    # Legacy unscoped routes (Default / primary project = meta DB)
    # These are deprecated; clients should use /api/projects/{project_id}/...
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(tables_router)
    app.include_router(storage_router)
    app.include_router(sql_router)
    app.include_router(projects_router)
    app.include_router(apikeys_router)
    app.include_router(system_router)

    # Full project-scoped data plane (tables/sql/storage/keys/stats)
    app.include_router(project_scoped_router)

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    HOST = os.environ.get("HOST", "0.0.0.0")
    PORT = int(os.environ.get("PORT", "8000"))
    # proxy_headers=False: uvicorn's own XFF rewrite (which trusts loopback
    # unconditionally) would let a local client spoof request.client.host
    # BEFORE our rate limiter sees it (H2).  get_client_ip() owns XFF logic.
    uvicorn.run(app, host=HOST, port=PORT, proxy_headers=False)
