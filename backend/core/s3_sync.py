"""
S3 / S3-compatible object storage sync for PyroCore.

Why this exists
---------------
Render's free tier has no persistent disk, so the SQLite database lives on an
ephemeral filesystem and is wiped on every cold start / redeploy.  This module
lets the backend survive that by treating an S3 bucket (AWS S3 or any
S3-compatible store such as Cloudflare R2) as the durable home for the database:

  * On startup, if the local database file is missing, the latest copy is
    downloaded from the bucket *before* migrations run, so a fresh container
    resumes the previous state instead of starting from an empty schema.
  * After every scheduled (and manual) backup, the live database is checkpointed
    (WAL folded into the main file) and uploaded to the bucket.

The module is import-safe: ``boto3`` is only imported when sync is actually
enabled, so deployments that don't set ``S3_SYNC_ENABLED`` are unaffected and
don't pay the import or dependency cost.

Env vars (all optional; sync is OFF unless S3_SYNC_ENABLED=true):
  S3_SYNC_ENABLED       "true" to enable
  S3_BUCKET             bucket name (required when enabled)
  S3_REGION             region, default "us-east-1"
  S3_ENDPOINT_URL       for S3-compatible stores
                        (R2: https://<accountid>.r2.cloudflarestorage.com)
  S3_ACCESS_KEY_ID      (required when enabled)
  S3_SECRET_ACCESS_KEY  (required when enabled)
  S3_PREFIX             key prefix, default "pyrocore/"  (trailing slash advised)
"""

import logging
import os
import sqlite3
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


def _env_enabled() -> bool:
    return os.environ.get("S3_SYNC_ENABLED", "").strip().lower() in ("1", "true", "yes")


class S3Sync:
    """Uploads/downloads the SQLite database file to/from an S3 bucket."""

    def __init__(
        self,
        bucket: str,
        region: str = "us-east-1",
        endpoint_url: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        prefix: str = "pyrocore/",
    ):
        self.bucket = bucket
        self.region = region
        self.endpoint_url = endpoint_url
        self.access_key_id = access_key_id
        self.secret_access_key = secret_access_key
        # Normalise so the key is always "<prefix><filename>".
        self.prefix = prefix if prefix.endswith("/") else prefix + "/"
        self._client = None

    # --- boto3 client (lazy) ------------------------------------------------
    def _get_client(self):
        if self._client is None:
            try:
                import boto3  # local import keeps the dependency optional
            except ImportError as e:
                raise RuntimeError(
                    "S3_SYNC_ENABLED=true but boto3 is not installed. "
                    "Add boto3 to dependencies (e.g. `pip install boto3`)."
                ) from e
            self._client = boto3.client(
                "s3",
                region_name=self.region,
                endpoint_url=self.endpoint_url or None,
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key,
            )
        return self._client

    def _object_key(self, db_path: str) -> str:
        return self.prefix + Path(db_path).name

    # --- download (restore) -------------------------------------------------
    def download(self, db_path: str) -> bool:
        """Download the DB from the bucket if the local file is missing/empty.

        Returns True if a download happened.  If the local DB already exists and
        is non-empty we leave it alone — we never overwrite live local data with
        a (possibly older) remote copy.  Callers invoke this only when the local
        DB does not yet exist (fresh ephemeral container), so the guard is just
        defensive.
        """
        local = Path(db_path)
        if local.exists() and local.stat().st_size > 0:
            logger.info("S3 restore skipped: local %s already present", db_path)
            return False

        key = self._object_key(db_path)
        client = self._get_client()
        try:
            head = client.head_object(Bucket=self.bucket, Key=key)
        except Exception as e:
            # No remote copy yet (first ever run) — start fresh locally.
            logger.info("S3 restore: no remote DB found (%s) — starting fresh", e)
            return False

        local.parent.mkdir(parents=True, exist_ok=True)
        tmp = tempfile.NamedTemporaryFile(
            suffix=".db", dir=str(local.parent), delete=False
        )
        tmp_path = Path(tmp.name)
        tmp.close()
        try:
            client.download_file(self.bucket, key, str(tmp_path))
            # Verify it's a real SQLite db before swapping it in.
            conn = sqlite3.connect(f"file:{tmp_path}?mode=ro", uri=True)
            try:
                conn.execute("SELECT 1")
            finally:
                conn.close()
            if local.exists():
                local.unlink()
            tmp_path.rename(local)
            logger.info(
                "S3 restore: downloaded %s (%s bytes) to %s",
                key,
                head.get("ContentLength"),
                db_path,
            )
            return True
        except Exception as e:
            logger.error("S3 restore failed: %s", e, exc_info=True)
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass
            return False

    # --- upload (persist) --------------------------------------------------
    def upload(self, db_path: str) -> None:
        """Checkpoint WAL into the main file and upload it to the bucket."""
        local = Path(db_path)
        if not local.exists():
            logger.warning("S3 upload skipped: %s does not exist", db_path)
            return

        # Fold any WAL into the main database so the uploaded file is
        # self-contained (no separate -wal/-shm needed on restore).
        try:
            conn = sqlite3.connect(str(local))
            try:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                conn.close()
        except sqlite3.Error as e:
            logger.warning("S3 upload: WAL checkpoint failed (%s); uploading as-is", e)

        key = self._object_key(db_path)
        try:
            self._get_client().upload_file(str(local), self.bucket, key)
            logger.info("S3 upload: pushed %s -> s3://%s/%s", db_path, self.bucket, key)
        except Exception as e:
            logger.error("S3 upload failed: %s", e, exc_info=True)
            raise


def load_s3_config() -> "S3Sync | None":
    """Build an S3Sync from environment, or None if sync is disabled."""
    if not _env_enabled():
        return None
    bucket = os.environ.get("S3_BUCKET")
    if not bucket:
        logger.warning("S3_SYNC_ENABLED=true but S3_BUCKET is unset — sync disabled")
        return None
    return S3Sync(
        bucket=bucket,
        region=os.environ.get("S3_REGION", "us-east-1"),
        endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
        access_key_id=os.environ.get("S3_ACCESS_KEY_ID"),
        secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY"),
        prefix=os.environ.get("S3_PREFIX", "pyrocore/"),
    )
