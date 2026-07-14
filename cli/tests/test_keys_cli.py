
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


def test_keys_create(temp_project, runner):
    """Test keys create command works and prints raw key once."""
    result = runner.invoke(cli, ["keys", "create", "--name", "test-key", "--scope", "read", "--scope", "write"])
    assert result.exit_code == 0
    assert "API Key:" in result.output
    assert "WARNING" in result.output
    # Verify it prints the key exactly once
    assert result.output.count("pyro_live_") == 1


def test_keys_list_no_raw_keys(temp_project, runner):
    """Test keys list doesn't print raw keys."""
    # First create a key
    runner.invoke(cli, ["keys", "create", "--name", "test-key", "--scope", "read"])
    
    # Then list
    result = runner.invoke(cli, ["keys", "list"])
    assert result.exit_code == 0
    # Check no raw keys are in list output
    assert "pyro_live_" not in result.output


def test_keys_revoke(temp_project, runner):
    """Test keys revoke command works."""
    # First create a key, capture the output to get the ID
    create_result = runner.invoke(cli, ["keys", "create", "--name", "test-key", "--scope", "read"])
    assert create_result.exit_code == 0
    
    # Extract the key ID from the output
    key_id = None
    for line in create_result.output.splitlines():
        if line.strip().startswith("ID:"):
            key_id = line.strip().split(":")[1].strip()
            break
    assert key_id is not None
    
    # Revoke it (with --yes to skip confirmation)
    revoke_result = runner.invoke(cli, ["keys", "revoke", key_id, "--yes"])
    assert revoke_result.exit_code == 0
    assert "API key revoked" in revoke_result.output
    
    # List keys - it shouldn't be there
    list_result = runner.invoke(cli, ["keys", "list"])
    assert key_id not in list_result.output
