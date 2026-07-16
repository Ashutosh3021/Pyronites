
from pathlib import Path

import click

from cli.config import error


@click.command()
@click.argument("project_name")
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose output")
def init(project_name, verbose):
    """
    Scaffold a new PyroCore project.

    PROJECT_NAME: Name of the project (and directory to create)
    """
    try:
        if not project_name or not project_name.strip():
            error("Project name must not be empty")
        project_path = Path(project_name)

        # Check if target directory exists and is not empty
        if project_path.exists():
            if any(project_path.iterdir()):
                error(f"Directory '{project_name}' already exists and is not empty")

        # Create project directory
        project_path.mkdir(parents=True, exist_ok=True)

        # Create pyrocore.toml config file
        # Using TOML because:
        # - It's human-readable and widely used in Python projects (poetry, pyproject.toml)
        # - It supports comments unlike JSON
        # - It's more structured than YAML without the complexity
        config_content = """# PyroCore Configuration
[database]
# Path to your SQLite database file
path = "pyrocore.db"

[api]
# API server configuration
host = "0.0.0.0"
port = 8000
"""
        config_path = project_path / "pyrocore.toml"
        config_path.write_text(config_content)

        # Create migrations directory
        migrations_path = project_path / "migrations"
        migrations_path.mkdir(parents=True, exist_ok=True)

        # Create .gitignore
        gitignore_content = """.gitignore
# Database files
*.db
*.db-wal
*.db-shm
*.db.old

# Backup directory
backups/

# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg
"""
        gitignore_path = project_path / ".gitignore"
        gitignore_path.write_text(gitignore_content)

        click.secho(f"✓ Successfully created PyroCore project: {project_name}", fg="green")
        click.echo()
        click.echo("Next steps:")
        click.echo(f"  1. cd {project_name}")
        click.echo("  2. pyrocore db push  # Initialize the database")
        click.echo()

    except Exception as e:
        if verbose:
            import traceback
            traceback.print_exc()
        error(str(e))
