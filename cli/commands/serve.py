
import os
import sys
import asyncio
import signal
from pathlib import Path

import click
import uvicorn
from fastapi import FastAPI

from backend.api.tables import router as tables_router
from backend.core.backup import scheduled_backup_loop


def error(message, verbose=False):
    """Print an error message and exit with non-zero code."""
    click.secho(f"Error: {message}", fg="red", err=True)
    sys.exit(1)


def find_pyrocore_config():
    """Find pyrocore.toml in current or parent directories."""
    current = Path.cwd()
    while current != current.parent:
        config_path = current / "pyrocore.toml"
        if config_path.exists():
            return config_path
        current = current.parent
    error("Could not find pyrocore.toml in current or parent directories")


def read_config(config_path):
    """Read and parse pyrocore.toml."""
    config = {"database": {}, "api": {}}
    try:
        content = config_path.read_text()
        for line in content.splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key == "path":
                config["database"]["path"] = value
            elif key == "host":
                config["api"]["host"] = value
            elif key == "port":
                config["api"]["port"] = int(value)
    except Exception as e:
        error(f"Failed to read config file: {e}")
    
    # Default values
    if "path" not in config["database"]:
        config["database"]["path"] = "pyrocore.db"
    if "host" not in config["api"]:
        config["api"]["host"] = "0.0.0.0"
    if "port" not in config["api"]:
        config["api"]["port"] = 8000
    
    return config


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
        
        # Print startup summary
        click.secho("🚀 Starting PyroCore...", fg="blue", bold=True)
        click.echo()
        click.echo(f"  Project: {project_root.name}")
        click.echo(f"  Database: {db_path_abs}")
        click.echo(f"  API Base URL: http://{final_host}:{final_port}")
        click.echo(f"  Backup Interval: {backup_interval}s")
        click.echo()
        
        # Create FastAPI app
        app = FastAPI(title="PyroCore API")
        app.include_router(tables_router, prefix="/api")
        
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
        
        # Start backup loop as background task
        async def backup_task():
            try:
                await scheduled_backup_loop(str(db_path_abs), str(backup_dir), backup_interval)
            except asyncio.CancelledError:
                click.echo("  Backup loop stopped")
        
        # Start server
        config = uvicorn.Config(
            app,
            host=final_host,
            port=final_port,
            log_level="info" if verbose else "warning",
            access_log=verbose
        )
        server = uvicorn.Server(config)
        
        # Run both tasks
        async def main():
            backup_task_obj = asyncio.create_task(backup_task())
            server_task = asyncio.create_task(server.serve())
            
            # Wait for shutdown
            await shutdown_event.wait()
            
            # Cancel tasks
            backup_task_obj.cancel()
            server.should_exit = True
            
            # Wait for tasks to finish
            await asyncio.gather(backup_task_obj, server_task, return_exceptions=True)
        
        asyncio.run(main())
        
        click.secho("✅ Shutdown complete", fg="green")
        
    except Exception as e:
        if verbose:
            import traceback
            traceback.print_exc()
        error(str(e))
