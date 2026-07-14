
import os
import sys
from pathlib import Path

import click

from backend.core.db import Database
from backend.auth.api_keys import create_api_key, revoke_api_key, list_api_keys


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
    config = {"database": {}}
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
    except Exception as e:
        error(f"Failed to read config file: {e}")
    
    # Default values
    if "path" not in config["database"]:
        config["database"]["path"] = "pyrocore.db"
    
    return config


@click.group()
def keys():
    """API key management commands."""


@keys.command(name="create")
@click.option("--name", required=True, help="Name for the API key")
@click.option("--scope", multiple=True, required=True, help="Scopes for the API key (read, write, admin)")
@click.option("--project-id", default="default", help="Project ID for the API key")
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose output")
def keys_create(name, scope, project_id, verbose):
    """Create a new API key."""
    try:
        # Find config
        config_path = find_pyrocore_config()
        config = read_config(config_path)
        project_root = config_path.parent
        
        # Resolve DB path
        db_path = (project_root / config["database"]["path"]).resolve()
        
        # Connect to DB
        db = Database(str(db_path))
        db.connect()
        
        try:
            raw_key, key_obj = create_api_key(db, project_id, name, list(scope))
            
            click.secho("✅ API key created!", fg="green")
            click.echo()
            click.secho("⚠️  WARNING: This key will only be shown once!", fg="yellow", bold=True)
            click.echo()
            click.secho(f"API Key: {raw_key}", fg="cyan", bold=True)
            click.echo()
            click.echo(f"  ID: {key_obj.id}")
            click.echo(f"  Name: {key_obj.name}")
            click.echo(f"  Scopes: {', '.join(key_obj.scopes)}")
            click.echo()
            
        finally:
            db.close()
        
    except Exception as e:
        if verbose:
            import traceback
            traceback.print_exc()
        error(str(e))


@keys.command(name="revoke")
@click.argument("key_id")
@click.option("--yes", is_flag=True, help="Skip confirmation prompt")
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose output")
def keys_revoke(key_id, yes, verbose):
    """Revoke an API key."""
    try:
        # Find config
        config_path = find_pyrocore_config()
        config = read_config(config_path)
        project_root = config_path.parent
        
        # Resolve DB path
        db_path = (project_root / config["database"]["path"]).resolve()
        
        # Connect to DB
        db = Database(str(db_path))
        db.connect()
        
        try:
            # Confirmation prompt
            if not yes:
                click.secho("⚠️  WARNING: This will revoke the API key permanently!", fg="yellow", bold=True)
                click.echo(f"  Key ID: {key_id}")
                click.echo()
                confirm = click.confirm("Are you sure you want to proceed?", default=False)
                if not confirm:
                    click.echo("Revoke cancelled.")
                    sys.exit(0)
            
            revoke_api_key(db, key_id)
            
            click.secho("✅ API key revoked!", fg="green")
            
        finally:
            db.close()
        
    except Exception as e:
        if verbose:
            import traceback
            traceback.print_exc()
        error(str(e))


@keys.command(name="list")
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose output")
def keys_list(verbose):
    """List all API keys."""
    try:
        # Find config
        config_path = find_pyrocore_config()
        config = read_config(config_path)
        project_root = config_path.parent
        
        # Resolve DB path
        db_path = (project_root / config["database"]["path"]).resolve()
        
        # Connect to DB
        db = Database(str(db_path))
        db.connect()
        
        try:
            keys = list_api_keys(db)
            
            if not keys:
                click.echo("No API keys found.")
                return
            
            # Print table
            click.echo()
            click.secho("📋 API Keys:", fg="blue", bold=True)
            click.echo()
            click.echo("  ID                      Name                 Scopes               Created")
            click.echo("  " + "-"*85)
            
            for k in keys:
                scope_str = ", ".join(k.scopes)
                date_str = k.created_at.strftime("%Y-%m-%d %H:%M")
                click.echo(f"  {k.id:25} {k.name:20} {scope_str:20} {date_str}")
            
            click.echo()
            
        finally:
            db.close()
        
    except Exception as e:
        if verbose:
            import traceback
            traceback.print_exc()
        error(str(e))
