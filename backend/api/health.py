
import os
import logging

from fastapi import APIRouter, Depends
from backend.core.db import Database

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])

DB_PATH = os.environ.get("DATABASE_PATH", "pyrocore.db")


def get_db() -> Database:
    db = Database(DB_PATH)
    db.connect()
    try:
        yield db
    finally:
        db.close()


@router.get("/health")
async def health(db: Database = Depends(get_db)):
    """Simple health check that also verifies database connectivity."""
    try:
        # Verify DB is connected with a simple query
        cursor = db.execute("SELECT 1")
        cursor.fetchone()
        db_ok = True
    except Exception as e:
        logger.error("Health check failed: database not connected", exc_info=True)
        db_ok = False
    
    return {"status": "ok" if db_ok else "degraded", "database": db_ok}
