
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


def test_db_push_applies_migrations(runner):
    """Test that db push applies migrations correctly."""
    with tempfile.TemporaryDirectory() as tmpdir:
        original_cwd = os.getcwd()
        os.chdir(tmpdir)
        
        try:
            # First init a project
            runner.invoke(cli, ["init", "test-project"])
            os.chdir("test-project")
            
            # First push - should apply migrations
            result = runner.invoke(cli, ["db", "push"])
            assert result.exit_code == 0
            
            # Second push - should be up to date
            result = runner.invoke(cli, ["db", "push"])
            assert result.exit_code == 0
            assert "already up to date" in result.output
            
        finally:
            os.chdir(original_cwd)


def test_db_push_dry_run(runner):
    """Test that db push --dry-run shows what would be done without applying."""
    with tempfile.TemporaryDirectory() as tmpdir:
        original_cwd = os.getcwd()
        os.chdir(tmpdir)
        
        try:
            # First init a project
            runner.invoke(cli, ["init", "test-project"])
            os.chdir("test-project")
            
            # Dry run
            result = runner.invoke(cli, ["db", "push", "--dry-run"])
            assert result.exit_code == 0
            assert "Pending migrations" in result.output
            assert "Dry run" in result.output
            
        finally:
            os.chdir(original_cwd)
