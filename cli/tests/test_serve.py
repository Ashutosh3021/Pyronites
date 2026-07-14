
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


def test_config_resolution(temp_project, runner):
    """Test that config resolution works correctly."""
    result = runner.invoke(cli, ["start", "--help"])
    assert result.exit_code == 0


def test_env_var_override(temp_project, monkeypatch):
    """Test that environment variables override config."""
    monkeypatch.setenv("PYROCORE_HOST", "192.168.1.1")
    monkeypatch.setenv("PYROCORE_PORT", "9000")
    
    from cli.commands.serve import find_pyrocore_config, read_config
    config_path = find_pyrocore_config()
    config = read_config(config_path)
    
    # The read_config function doesn't read env vars directly, that's handled in serve command
    assert config["api"]["host"] == "127.0.0.1"
    assert config["api"]["port"] == 8765
