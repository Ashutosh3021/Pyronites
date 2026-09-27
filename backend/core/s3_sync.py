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
from typing import List

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
                from botocore.config import Config
            except ImportError as e:
                raise RuntimeError(
                    "S3_SYNC_ENABLED=true but boto3 is not installed. "
                    "Add boto3 to dependencies (e.g. `pip install boto3`)."
                ) from e
            # Bounded retries: a dead endpoint must not stall startup/backups
            # for tens of seconds.
            config = Config(retries={"max_attempts": 2, "mode": "standard"})
            self._client = boto3.client(
                "s3",
                region_name=self.region,
                endpoint_url=self.endpoint_url or None,
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key,
                config=config,
            )
        return self._client

    def _object_key(self, db_path: str) -> str:
        return self.prefix + Path(db_path).name

    # --- download (restore) -------------------------------------------------
    def download(self, db_path: str) -> bool:
        """Download the DB from the bucket only when the local file is absent.

        Returns True if a download happened.  We NEVER overwrite an existing
        local database with a (possibly stale) remote copy — preserving local
        data takes precedence over restoring remote state.  This prevents a
        fresh-but-present local DB (e.g. just-created from migrations, or newer
        local writes) from being clobbered by an older S3 snapshot on a warm
        restart or cold start.  Callers invoke this before migrations run, so a
        truly fresh ephemeral container (no local file) downloads the latest
        remote copy and a container that already has a DB keeps its own.
        """
        local = Path(db_path)
        if local.exists():
            logger.info(
                "S3 restore skipped: local %s already present — keeping local data",
                db_path,
            )
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
    def upload(self, db_path: str, key_name: str | None = None) -> None:
        """Checkpoint WAL into the main file and upload it to the bucket.

        ``key_name`` overrides the object name (used to publish a consistent
        backup file under the live DB's key — H3).
        """
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

        key = self.prefix + (key_name or local.name)
        try:
            self._get_client().upload_file(str(local), self.bucket, key)
            logger.info("S3 upload: pushed %s -> s3://%s/%s", db_path, self.bucket, key)
        except Exception as e:
            logger.error("S3 upload failed: %s", e, exc_info=True)
            raise

    def _upload_file(self, local: Path, key: str) -> None:
        """Upload one file under ``key`` (no checkpointing — plain copy)."""
        try:
            self._get_client().upload_file(str(local), self.bucket, key)
            logger.info("S3 upload: pushed %s -> s3://%s/%s", local, self.bucket, key)
        except Exception as e:
            logger.error("S3 upload of %s failed: %s", local, e, exc_info=True)
            raise

    def _list_keys(self, prefix: str) -> List[str]:
        client = self._get_client()
        keys: List[str] = []
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents") or []:
                k = obj.get("Key")
                if k:
                    keys.append(k)
        return keys

    # --- C1: full data-dir sync -------------------------------------------
    def upload_all(
        self,
        db_path: str,
        *,
        snapshot_file: str | None = None,
        projects_dir: str | None = None,
        storage_root: str | None = None,
    ) -> None:
        """
        Push the complete durable state to the bucket.

        * meta DB  -> ``<prefix><db filename>`` — uploaded from
          ``snapshot_file`` (a consistent ``backup_now()`` copy) when given,
          otherwise checkpointed in place (H3).
        * project DBs -> ``<prefix>projects/<file>.db`` (WAL checkpointed first)
        * storage files -> ``<prefix>storage/<relative path>``

        WAL/SHM sidecar files are never uploaded. A failure in one part logs
        and continues with the others, then re-raises if anything failed so
        callers can surface the error.
        """
        errors: List[str] = []

        # 1) meta DB (consistent snapshot preferred)
        meta_source = Path(snapshot_file) if snapshot_file else Path(db_path)
        if meta_source.exists():
            if snapshot_file:
                key = self.prefix + Path(db_path).name
                try:
                    self._upload_file(meta_source, key)
                except Exception:
                    errors.append(f"meta:{meta_source}")
            else:
                try:
                    self.upload(db_path)
                except Exception:
                    errors.append(f"meta:{db_path}")
        else:
            logger.warning("S3 sync: meta snapshot %s missing", meta_source)

        # 2) project databases
        if projects_dir:
            pdir = Path(projects_dir)
            if pdir.is_dir():
                for pdb in sorted(pdir.glob("*.db")):
                    try:
                        # Fold WAL so the file is self-contained.
                        conn = sqlite3.connect(str(pdb))
                        try:
                            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                        finally:
                            conn.close()
                        self._upload_file(pdb, self.prefix + "projects/" + pdb.name)
                    except Exception as e:
                        logger.error("S3 sync: project db %s failed: %s", pdb, e)
                        errors.append(f"projects:{pdb.name}")

        # 3) storage files
        if storage_root:
            sroot = Path(storage_root)
            if sroot.is_dir():
                for f in sorted(p for p in sroot.rglob("*") if p.is_file()):
                    try:
                        rel = f.relative_to(sroot).as_posix()
                        self._upload_file(f, self.prefix + "storage/" + rel)
                    except Exception as e:
                        logger.error("S3 sync: storage file %s failed: %s", f, e)
                        errors.append(f"storage:{f}")

        if errors:
            raise RuntimeError(f"S3 upload_all incomplete: {', '.join(errors)}")
        logger.info("S3 upload_all complete (prefix=%s)", self.prefix)

    def download_all(
        self,
        db_path: str,
        projects_dir: str | None = None,
        storage_root: str | None = None,
    ) -> bool:
        """
        Restore everything that is missing locally from the bucket (C1).

        * meta DB via :meth:`download` (never overwrites an existing local file)
        * every remote ``projects/*.db`` with no local counterpart
        * every remote ``storage/...`` file with no local counterpart

        Returns True if at least one file was downloaded.
        """
        downloaded = self.download(db_path)

        client = self._get_client()
        # project DBs
        if projects_dir:
            pdir = Path(projects_dir)
            for key in self._list_keys(self.prefix + "projects/"):
                name = key.rsplit("/", 1)[-1]
                if not name.endswith(".db") or name.endswith(("-wal", "-shm")):
                    continue
                local = pdir / name
                if local.exists():
                    continue
                pdir.mkdir(parents=True, exist_ok=True)
                if self._fetch_verified(client, key, local):
                    downloaded = True

        # storage files
        if storage_root:
            sroot = Path(storage_root)
            base = self.prefix + "storage/"
            for key in self._list_keys(base):
                rel = key[len(base):]
                if not rel or rel.endswith("/"):
                    continue
                local = (sroot / rel).resolve()
                try:
                    local.relative_to(sroot.resolve())
                except ValueError:
                    logger.warning("S3 sync: skipping unsafe remote key %s", key)
                    continue
                if local.exists():
                    continue
                local.parent.mkdir(parents=True, exist_ok=True)
                if self._fetch_verified(client, key, local, verify_sqlite=False):
                    downloaded = True

        return downloaded

    def _fetch_verified(
        self, client, key: str, local: Path, verify_sqlite: bool = True
    ) -> bool:
        """Download ``key`` to a temp file, optionally verify, then swap in."""
        local.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=str(local.parent), suffix=".part")
        os.close(fd)
        tmp_path = Path(tmp_name)
        try:
            client.download_file(self.bucket, key, str(tmp_path))
            if verify_sqlite:
                conn = sqlite3.connect(f"file:{tmp_path}?mode=ro", uri=True)
                try:
                    conn.execute("SELECT 1")
                finally:
                    conn.close()
            if local.exists():
                local.unlink()
            tmp_path.rename(local)
            logger.info("S3 restore: %s -> %s", key, local)
            return True
        except Exception as e:
            logger.error("S3 restore of %s failed: %s", key, e, exc_info=True)
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except OSError:
                pass
            return False


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
