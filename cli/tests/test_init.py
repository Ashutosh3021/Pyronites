
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


def test_init_creates_project_structure(runner):
    """Test that init creates the expected project structure."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Change to temp directory
        original_cwd = os.getcwd()
        os.chdir(tmpdir)
        
        try:
            # Run init command
            result = runner.invoke(cli, ["init", "test-project"])
            assert result.exit_code == 0
            
            # Check project directory exists
            project_path = Path("test-project")
            assert project_path.exists()
            assert project_path.is_dir()
            
            # Check files exist
            assert (project_path / "pyrocore.toml").exists()
            assert (project_path / "migrations").exists()
            assert (project_path / ".gitignore").exists()
            
            # Check .gitignore has expected entries
            gitignore_content = (project_path / ".gitignore").read_text()
            assert "*.db" in gitignore_content
            assert "backups/" in gitignore_content
            
        finally:
            os.chdir(original_cwd)


def test_init_fails_on_existing_non_empty_dir(runner):
    """Test that init fails when target directory exists and is not empty."""
    with tempfile.TemporaryDirectory() as tmpdir:
        original_cwd = os.getcwd()
        os.chdir(tmpdir)
        
        try:
            # Create a non-empty directory
            project_path = Path("test-project")
            project_path.mkdir()
            (project_path / "some-file.txt").write_text("test")
            
            # Try to init on it
            result = runner.invoke(cli, ["init", "test-project"])
            assert result.exit_code != 0
            assert "already exists" in result.output
            
        finally:
            os.chdir(original_cwd)
