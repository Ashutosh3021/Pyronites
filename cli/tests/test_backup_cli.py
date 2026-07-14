
import os
import tempfile
import shutil
from pathlib import Path

import pytest
from click.testing import CliRunner

from cli.main import cli


@pytest.fixture
def runner():
    """Fixture for Click test runner."""
    return CliRunner()


@pytest.fixture
def temp_project():
    """Fixture for a temporary PyroCore project."""
    with tempfile.TemporaryDirectory() as tmpdir:
        original_cwd = os.getcwd()
        os.chdir(tmpdir)
        
        # Create a basic project
        project_dir = Path("test-project")
        project_dir.mkdir()
        
        # Create pyrocore.toml
        (project_dir / "pyrocore.toml").write_text("""
[database]
path = "test.db"

[api]
host = "127.0.0.1"
port = 8765
""")
        
        # Create migrations dir
        (project_dir / "migrations").mkdir()
        
        # Copy default migrations
        pyrocore_migrations = Path(__file__).parent.parent.parent / "backend" / "migrations"
        for f in pyrocore_migrations.glob("*.sql"):
            shutil.copy(f, project_dir / "migrations" / f.name)
        
        os.chdir(project_dir)
        
        # Run db push to create DB
        from cli.commands.db import push
        push.callback(dry_run=False, verbose=False)
        
        yield Path.cwd()
        
        os.chdir(original_cwd)


def test_backup_create(temp_project, runner):
    """Test backup create command works."""
    result = runner.invoke(cli, ["backup", "create"])
    assert result.exit_code == 0
    assert "Backup created" in result.output


def test_backup_list(temp_project, runner):
    """Test backup list command works."""
    # First create a backup
    runner.invoke(cli, ["backup", "create"])
    
    # Then list
    result = runner.invoke(cli, ["backup", "list"])
    assert result.exit_code == 0
    assert "Backups" in result.output


def test_backup_restore_requires_confirmation(temp_project, runner):
    """Test restore requires confirmation without --yes."""
    # First create a backup
    runner.invoke(cli, ["backup", "create"])
    
    # Get the backup file path
    backup_dir = temp_project / "backups"
    backup_files = list(backup_dir.glob("*.db"))
    assert len(backup_files) > 0
    
    # Try restore without --yes (should fail because we can't confirm in test)
    result = runner.invoke(cli, ["backup", "restore", str(backup_files[0])], input="n\n")
    assert "Restore cancelled" in result.output


def test_backup_restore_with_yes(temp_project, runner):
    """Test restore works with --yes."""
    # First create a backup
    runner.invoke(cli, ["backup", "create"])
    
    # Get the backup file path
    backup_dir = temp_project / "backups"
    backup_files = list(backup_dir.glob("*.db"))
    assert len(backup_files) > 0
    
    # Restore with --yes
    result = runner.invoke(cli, ["backup", "restore", str(backup_files[0]), "--yes"])
    assert result.exit_code == 0
    assert "Database restored" in result.output
