
from pathlib import Path

import click

from backend.core.backup import backup_now, restore_from_backup, list_backups
from cli.config import find_pyrocore_config, read_config, error


@click.group()
def backup():
    """Database backup and restore commands."""


@backup.command(name="create")
@click.option("--backup-dir", help="Directory to store backups (defaults to 'backups' next to DB file)")
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose output")
def backup_create(backup_dir, verbose):
    """Create a backup of the database."""
    try:
        # Find config
        config_path = find_pyrocore_config()
        config = read_config(config_path)
        project_root = config_path.parent
        
        # Resolve DB path
        db_path = (project_root / config["database"]["path"]).resolve()
        
        # Resolve backup dir
        if backup_dir:
            backup_path = Path(backup_dir).resolve()
        else:
            backup_path = db_path.parent / "backups"
        
        backup_path.mkdir(parents=True, exist_ok=True)
        
        click.echo(f"Creating backup of {db_path}...")
        result = backup_now(str(db_path), str(backup_path))
        
        click.secho(f"✅ Backup created: {result}", fg="green")
        
    except Exception as e:
        if verbose:
            import traceback
            traceback.print_exc()
        error(str(e))


@backup.command(name="list")
@click.option("--backup-dir", help="Directory to list backups from (defaults to 'backups' next to DB file)")
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose output")
def backup_list(backup_dir, verbose):
    """List all database backups."""
    try:
        # Find config
        config_path = find_pyrocore_config()
        config = read_config(config_path)
        project_root = config_path.parent
        
        # Resolve DB path
        db_path = (project_root / config["database"]["path"]).resolve()
        
        # Resolve backup dir
        if backup_dir:
            backup_path = Path(backup_dir).resolve()
        else:
            backup_path = db_path.parent / "backups"
        
        if not backup_path.exists():
            click.echo("No backups found.")
            return
        
        backups = list_backups(str(backup_path))
        
        if not backups:
            click.echo("No backups found.")
            return
        
        # Print table
        click.echo()
        click.secho("📋 Backups:", fg="blue", bold=True)
        click.echo()
        click.echo("  Date                      Size       Path")
        click.echo("  " + "-"*70)
        
        for b in backups:
            size_str = f"{b.size_bytes / 1024:.1f} KB"
            date_str = b.created_at.strftime("%Y-%m-%d %H:%M:%S UTC")
            click.echo(f"  {date_str:25} {size_str:10} {b.path.name}")
        
        click.echo()
        
    except Exception as e:
        if verbose:
            import traceback
            traceback.print_exc()
        error(str(e))


@backup.command(name="restore")
@click.argument("backup_file")
@click.option("--yes", is_flag=True, help="Skip confirmation prompt")
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose output")
def backup_restore(backup_file, yes, verbose):
    """Restore the database from a backup file."""
    try:
        # Find config
        config_path = find_pyrocore_config()
        config = read_config(config_path)
        project_root = config_path.parent
        
        # Resolve paths
        backup_path = Path(backup_file).resolve()
        db_path = (project_root / config["database"]["path"]).resolve()
        
        if not backup_path.exists():
            error(f"Backup file not found: {backup_file}")
        
        # Confirmation prompt
        if not yes:
            click.secho("⚠️  WARNING: This will overwrite the live database!", fg="yellow", bold=True)
            click.echo(f"  Live DB: {db_path}")
            click.echo(f"  Backup:  {backup_path}")
            click.echo()
            confirm = click.confirm("Are you sure you want to proceed?", default=False)
            if not confirm:
                click.echo("Restore cancelled.")
                sys.exit(0)
        
        click.echo("Restoring database...")
        restore_from_backup(str(backup_path), str(db_path))
        
        click.secho("✅ Database restored successfully!", fg="green")
        
    except Exception as e:
        if verbose:
            import traceback
            traceback.print_exc()
        error(str(e))
