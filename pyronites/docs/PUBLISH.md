# Publishing pyronites to PyPI

Releases go out through GitHub Actions: `.github/workflows/publish-pyronites.yml`
runs the client tests, builds the distributions and uploads them to PyPI.

## One-time setup

Create a PyPI API token scoped to the `pyronites` project:

1. <https://pypi.org/manage/account/token/> → "API tokens" → "Create token"
2. Scope it to the `pyronites` project only.
3. Add it to the repository as an Actions secret named `PYPI_API_TOKEN`
   (Settings → Secrets and variables → Actions → New repository secret).

## How a release happens

### 1. Bump the version

`pyronites/pyproject.toml` is the source of truth. Edit it:

```toml
version = "1.3.0"
```

The version also lives in `pyronites/pyronites/__init__.py` as `__version__`.
The release workflow keeps that file in sync with `pyproject.toml`, so a
one-file bump is enough.

To update both at once, locally:

```bash
python scripts/set_version.py --set 1.3.0
```

Useful modes:

```bash
python scripts/set_version.py            # print the current version
python scripts/set_version.py --sync     # copy pyproject.toml's version into __init__.py
python scripts/set_version.py --check    # fail if the two files disagree
```

### 2. Update the changelog

Add a section to `pyronites/CHANGELOG.md`.

### 3. Commit and push

```bash
git commit -am "Release v1.3.0"
git push
```

Pushing to `main` triggers the workflow, which tests, builds and uploads
`1.3.0` to PyPI.

## Version control during a release

The workflow takes an optional `version` input:

| Trigger | Version used | Behaviour |
|---|---|---|
| push to `main` | the version in `pyronites/pyproject.toml` | syncs `__init__.py` to match, then uploads — unless that version is already on PyPI |
| **Actions → Publish pyronites to PyPI**, `version` left empty | the version in `pyronites/pyproject.toml` | same as a push |
| **Actions → Publish pyronites to PyPI**, `version=1.4.0` | `1.4.0` | writes `1.4.0` into both files, then uploads it |

PyPI refuses to upload the same version twice. When the resolved version is
already published, the workflow **skips the upload and passes** — it does not
fail the run. The job summary says so and tells you to bump the version.

`commit_version` (default `false`) makes the workflow commit the version it
published back to the branch, so `pyronites/pyproject.toml` keeps matching what
is on PyPI.

## What the workflow does

1. Resolves the version (`scripts/set_version.py`).
2. Installs the client and runs `pytest`.
3. Asks PyPI whether that version already exists — skip if it does.
4. `python -m build` and `twine check dist/*`.
5. Uploads with `pypa/gh-action-pypi-publish` using `PYPI_API_TOKEN`.

## Manual release (fallback)

If GitHub Actions is unavailable:

```bash
cd pyronites
pip install build twine
rm -rf dist build
python -m build
twine check dist/*

export TWINE_USERNAME="__token__"
export TWINE_PASSWORD="pypi-YOUR_FULL_TOKEN"
twine upload dist/*
```

## After publish

```bash
pip install --upgrade pyronites
python -c "from pyronites import create_client, __version__; print(__version__)"
```
