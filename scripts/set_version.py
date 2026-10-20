#!/usr/bin/env python3
"""Read, set and verify the version of the `pyronites` client package.

The version is declared in two places that must never drift apart:

    pyronites/pyproject.toml          version = "1.2.1"
    pyronites/pyronites/__init__.py   __version__ = "1.2.1"

The release workflow uses this script so a single command owns both files.

Usage:
    python scripts/set_version.py                 # print the current version
    python scripts/set_version.py --set 1.3.0     # write the version to both files
    python scripts/set_version.py --check         # fail if the two files disagree
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT = ROOT / "pyronites" / "pyproject.toml"
INIT = ROOT / "pyronites" / "pyronites" / "__init__.py"

# PEP 440 public version: 1.2.1, 1.3.0rc1, 2.0.0.post1, 1.4.0.dev2
VERSION_RE = re.compile(
    r"^\d+(?:\.\d+)*"
    r"(?:(?:a|b|c|rc|alpha|beta|pre|preview)\.?\d*)?"
    r"(?:\.post\d+)?"
    r"(?:\.dev\d+)?"
    r"(?:\+[\w.]+)?$",
    re.IGNORECASE,
)


def _read(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return handle.read()


def _write(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def _pyproject_version(path: Path) -> str:
    try:
        import tomllib
    except ModuleNotFoundError:  # Python < 3.11
        tomllib = None  # type: ignore[assignment]

    if tomllib is not None:
        with path.open("rb") as handle:
            data = tomllib.load(handle)
        version = data.get("project", {}).get("version")
        if not isinstance(version, str):
            raise SystemExit(f"no [project].version in {path}")
        return version

    match = re.search(r'^version\s*=\s*"([^"]+)"', _read(path), re.MULTILINE)
    if not match:
        raise SystemExit(f"no version found in {path}")
    return match.group(1)


def _init_version(path: Path) -> str:
    match = re.search(r'^__version__\s*=\s*"([^"]+)"', _read(path), re.MULTILINE)
    if not match:
        raise SystemExit(f"no __version__ found in {path}")
    return match.group(1)


def _set_pyproject_version(path: Path, version: str) -> None:
    lines = _read(path).splitlines(keepends=True)
    out: list[str] = []
    in_project = False
    replaced = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            in_project = stripped == "[project]"
        elif in_project and not replaced and re.match(r"^version\s*=", stripped):
            newline = "\r\n" if line.endswith("\r\n") else "\n"
            out.append(f'version = "{version}"{newline}')
            replaced = True
            continue
        out.append(line)

    if not replaced:
        raise SystemExit(f"no version line under [project] in {path}")

    _write(path, "".join(out))


def _set_init_version(path: Path, version: str) -> None:
    text, count = re.subn(
        r'^__version__\s*=\s*"[^"]*"',
        f'__version__ = "{version}"',
        _read(path),
        count=1,
        flags=re.MULTILINE,
    )
    if count != 1:
        raise SystemExit(f"no __version__ line in {path}")
    _write(path, text)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Read, set or verify the pyronites package version."
    )
    parser.add_argument(
        "--set",
        dest="set_version",
        metavar="VERSION",
        help="write VERSION to pyproject.toml and __init__.py",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero when the two files hold different versions",
    )
    args = parser.parse_args(argv)

    if args.set_version:
        version = args.set_version.strip()
        if not VERSION_RE.match(version):
            raise SystemExit(f"'{version}' is not a valid PEP 440 version")
        _set_pyproject_version(PYPROJECT, version)
        _set_init_version(INIT, version)
        print(version)
        return 0

    pyproject_version = _pyproject_version(PYPROJECT)
    init_version = _init_version(INIT)

    if args.check:
        if pyproject_version != init_version:
            print(
                "version mismatch: "
                f"pyronites/pyproject.toml has {pyproject_version}, "
                f"pyronites/pyronites/__init__.py has {init_version}",
                file=sys.stderr,
            )
            return 1

    print(pyproject_version)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
