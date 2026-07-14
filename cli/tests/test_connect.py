
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


def test_connect_generates_configs(runner):
    """Test that connect generates framework-specific config files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        original_cwd = os.getcwd()
        os.chdir(tmpdir)
        
        try:
            # Test Next.js
            result = runner.invoke(cli, ["connect", "nextjs"])
            assert result.exit_code == 0
            assert Path(".env.local").exists()
            assert "PYROCORE_API_URL" in Path(".env.local").read_text()
            
            # Test Python
            result = runner.invoke(cli, ["connect", "python"])
            assert result.exit_code == 0
            assert Path("pyrocore_client.py").exists()
            
            # Test Prisma
            result = runner.invoke(cli, ["connect", "prisma"])
            assert result.exit_code == 0
            assert Path("schema.prisma").exists()
            
        finally:
            os.chdir(original_cwd)


def test_connect_fails_without_force(runner):
    """Test that connect fails without --force when file exists."""
    with tempfile.TemporaryDirectory() as tmpdir:
        original_cwd = os.getcwd()
        os.chdir(tmpdir)
        
        try:
            # Create a file first
            Path(".env.local").write_text("existing content")
            
            # Try to connect without force
            result = runner.invoke(cli, ["connect", "nextjs"])
            assert result.exit_code != 0
            assert "File(s) already exist" in (result.stdout + result.stderr)
            
            # Now with force
            result = runner.invoke(cli, ["connect", "nextjs", "--force"])
            assert result.exit_code == 0
            
        finally:
            os.chdir(original_cwd)
