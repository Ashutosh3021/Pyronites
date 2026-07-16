
"""
Shared CLI configuration and helpers.

Previously every command module (serve, db, backup, keys, connect, init)
re-declared its own copy of ``find_pyrocore_config``, ``read_config`` and
``error``.  Duplicated config parsing is a classic drift hazard: a change to
the config format in one copy silently fails to land in the others.  This
module is the single implementation all commands import.
"""

import os
import sys
from pathlib import Path

import click


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
    """
    Read and parse pyrocore.toml.

    A deliberately small, dependency-free parser (consistent with the format
    written by ``pyrocore init``): it ignores ``[section]`` headers and only
    reads ``key = value`` lines for the keys it understands.
    """
    config = {"database": {}, "api": {}}
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
            elif key == "host":
                config["api"]["host"] = value
            elif key == "port":
                config["api"]["port"] = int(value)
    except Exception as e:
        error(f"Failed to read config file: {e}")

    # Default values
    if "path" not in config["database"]:
        config["database"]["path"] = "pyrocore.db"
    if "host" not in config["api"]:
        config["api"]["host"] = "0.0.0.0"
    if "port" not in config["api"]:
        config["api"]["port"] = 8000

    return config
