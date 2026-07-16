
import os
import asyncio
import signal
from pathlib import Path

import click
import uvicorn

from cli.config import find_pyrocore_config, read_config, error
from backend.app import create_app

# Re-exported for backwards compatibility with tests that import them from here.
__all__ = ["serve", "find_pyrocore_config", "read_config"]


@click.command(name="start")
@click.option("--host", help="Host to bind to (overrides config)")
@click.option("--port", type=int, help="Port to bind to (overrides config)")
@click.option("--db-path", help="Path to database file (overrides config)")
@click.option("--backup-interval", type=int, default=3600, help="Backup interval in seconds (default: 3600)")
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose output")
def serve(host, port, db_path, backup_interval, verbose):
    """
    Start the PyroCore FastAPI server and scheduled backup loop.
    """
    try:
        # Find and read config
        config_path = find_pyrocore_config()
        config = read_config(config_path)
        project_root = config_path.parent

        # Resolve final values (flags > env vars > config)
        final_host = host or os.getenv("PYROCORE_HOST") or config["api"]["host"]
        final_port = port or int(os.getenv("PYROCORE_PORT", 0)) or config["api"]["port"]
        final_db_path = db_path or os.getenv("PYROCORE_DB_PATH") or config["database"]["path"]

        # Resolve absolute DB path
        db_path_abs = (project_root / final_db_path).resolve()

        # Backup directory (sibling to DB file)
        backup_dir = db_path_abs.parent / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)

        # The scheduled backup loop now lives in the app lifespan
        # (backend/app.py) so it runs identically whether the app is launched
        # via `uvicorn backend.app:app` (container) or via this command.  Feed
        # the CLI's --backup-interval through the env var the lifespan reads so
        # the single loop honours it.
        os.environ["BACKUP_INTERVAL_SECONDS"] = str(backup_interval)

        # Normalise the resolved config into the SAME canonical env vars that the
        # application and its routers read.  This guarantees the API server and
        # the backup loop operate on the exact same database file, storage root,
        # and migrations directory — eliminating the previous drift where the
        # server used DATABASE_PATH (default "pyrocore.db") while the backup loop
        # used a separately-resolved absolute path.
        os.environ["DATABASE_PATH"] = str(db_path_abs)
        os.environ["STORAGE_ROOT"] = os.getenv(
            "STORAGE_ROOT", str(project_root / "storage_files")
        )
        project_migrations = project_root / "migrations"
        if project_migrations.exists():
            os.environ["MIGRATIONS_DIR"] = str(project_migrations)

        # Print startup summary
        click.secho("🚀 Starting PyroCore...", fg="blue", bold=True)
        click.echo()
        click.echo(f"  Project: {project_root.name}")
        click.echo(f"  Database: {db_path_abs}")
        click.echo(f"  API Base URL: http://{final_host}:{final_port}")
        click.echo(f"  Backup Interval: {backup_interval}s")
        click.echo()

        # Build the application.  create_app() is the single source of truth for
        # the API surface (routers, prefixes, migration-on-startup), shared with
        # the container entry point — so `start` can no longer serve a different
        # or partial app than the one documented in ARCHITECTURE.md.
        app = create_app()

        # Event to signal shutdown
        shutdown_event = asyncio.Event()

        # Signal handlers
        def signal_handler():
            click.echo()
            click.secho("📢 Received shutdown signal, cleaning up...", fg="yellow")
            shutdown_event.set()

        # Register signal handlers
        for sig in [signal.SIGINT, signal.SIGTERM]:
            try:
                asyncio.get_event_loop().add_signal_handler(sig, signal_handler)
            except NotImplementedError:
                # Windows doesn't support add_signal_handler
                pass

        # Start server.  The scheduled backup loop is started by the app's
        # lifespan (backend/app.py) — there is no separate backup task here.
        uvicorn_config = uvicorn.Config(
            app,
            host=final_host,
            port=final_port,
            log_level="info" if verbose else "warning",
            access_log=verbose
        )
        server = uvicorn.Server(uvicorn_config)

        # Run the server
        async def main():
            server_task = asyncio.create_task(server.serve())

            # Wait for shutdown
            await shutdown_event.wait()

            server.should_exit = True

            # Wait for the server to finish
            await asyncio.gather(server_task, return_exceptions=True)

        asyncio.run(main())

        click.secho("✅ Shutdown complete", fg="green")

    except Exception as e:
        if verbose:
            import traceback
            traceback.print_exc()
        error(str(e))
