
import shutil
from pathlib import Path

import click

from backend.core.db import Database
from backend.core.migrations import (
    get_migration_files,
    get_applied_migrations,
    extract_migration_id,
)
from cli.config import find_pyrocore_config, read_config, error


def get_pending_migrations(db, migrations_dir):
    """Get list of pending migration file paths."""
    migration_files = get_migration_files(migrations_dir)
    applied_migrations = get_applied_migrations(db)
    
    pending = []
    for file_path in migration_files:
        migration_id = extract_migration_id(file_path)
        if migration_id not in applied_migrations:
            pending.append(file_path)
    
    return pending


@click.group()
def db():
    """Database management commands."""


@db.command()
@click.option("--dry-run", is_flag=True, help="Show what would be done without applying")
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose output")
def push(dry_run, verbose):
    """Run pending database migrations."""
    try:
        # Find config
        config_path = find_pyrocore_config()
        config = read_config(config_path)
        project_root = config_path.parent
        
        # Database path
        db_path = project_root / config["database"]["path"]
        
        # Migrations directory
        migrations_dir = project_root / "migrations"
        
        # If no migrations in project dir, copy from pyrocore's default migrations
        if not list(migrations_dir.glob("*.sql")):
            # Find pyrocore's built-in migrations
            pyrocore_migrations = Path(__file__).parent.parent.parent / "backend" / "migrations"
            if pyrocore_migrations.exists():
                for sql_file in pyrocore_migrations.glob("*.sql"):
                    shutil.copy(sql_file, migrations_dir / sql_file.name)
                click.secho("✓ Copied default migrations to project", fg="green")
        
        # Check pending migrations
        db = Database(str(db_path))
        db.connect()
        try:
            pending = get_pending_migrations(db, str(migrations_dir))
            
            if not pending:
                click.secho("✓ Database already up to date", fg="green")
                return
            
            # Show what's pending
            click.echo(f"Pending migrations ({len(pending)}):")
            for mig in pending:
                click.echo(f"  • {Path(mig).name}")
            
            if dry_run:
                click.secho("\nDry run: no migrations applied", fg="yellow")
                return
            
            # Apply migrations
            click.echo("\nApplying migrations...")
            
            # Import apply_migration here to avoid circular issues
            from backend.core.migrations import apply_migration
            
            for mig_path in pending:
                mig_name = Path(mig_path).name
                click.echo(f"  Applying {mig_name}...")
                apply_migration(db, mig_path)
                click.secho(f"  ✓ Applied {mig_name}", fg="green")
            
            click.secho("\n✓ All migrations applied successfully!", fg="green")
            
        finally:
            db.close()
            
    except Exception as e:
        if verbose:
            import traceback
            traceback.print_exc()
        error(str(e))
