
import os
import logging
from pathlib import Path

from fastapi import FastAPI
from contextlib import asynccontextmanager

from backend.api.health import router as health_router
from backend.api.tables import router as tables_router
from backend.api.storage import router as storage_router
from backend.core.db import Database
from backend.core.migrations import get_migration_files, run_pending_migrations

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

DB_PATH = os.environ.get("DATABASE_PATH", "pyrocore.db")
MIGRATIONS_DIR = os.environ.get("MIGRATIONS_DIR", str(Path(__file__).parent / "migrations"))
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: run pending migrations
    logger.info("Starting up, running migrations...")
    db = Database(DB_PATH)
    db.connect()
    try:
        run_pending_migrations(db, MIGRATIONS_DIR)
        logger.info("Migrations complete!")
    except Exception as e:
        logger.error("Failed to run migrations!", exc_info=True)
        raise
    finally:
        db.close()
    
    yield  # App runs here
    
    # Shutdown
    logger.info("Shutting down...")


app = FastAPI(lifespan=lifespan, title="PyroCore API")

# Include routers
app.include_router(health_router)
app.include_router(tables_router)
app.include_router(storage_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
