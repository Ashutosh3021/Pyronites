# Publishing a new version of `pyronites` to PyPI

Use this whenever you change the package and want a new version on PyPI (e.g. `0.1.1`, `0.2.0`).

---

## Rules (read once)

1. **Never re-upload the same version.** PyPI rejects replacing `0.1.0` with another `0.1.0`. Always bump the version.
2. **Version must match in two places:**
   - `pyronites/__init__.py` → `__version__ = "..."`
   - `pyproject.toml` → `version = "..."`
3. **Semantic versioning (recommended):**
   - `0.1.1` — bugfix (patch)
   - `0.2.0` — new features, backward compatible (minor)
   - `1.0.0` — stable / breaking changes (major)
4. Work from the **package root**: the folder that contains `pyproject.toml`  
   (path looks like `.../Pyronites/pyronites/`).

---

## Full process for every new release

### 1. Finish and test your changes

- Implement the code changes.
- Run tests:

```bash
cd path/to/Pyronites/pyronites
source .venv/bin/activate   # or Windows: .venv\Scripts\activate
pytest
```

- Fix failures before releasing.

---

### 2. Bump the version

Edit **both**:

**A. `pyronites/__init__.py`**
```python
__version__ = "0.1.1"   # example
```

**B. `pyproject.toml`**
```toml
version = "0.1.1"
```

They must be identical.

---

### 3. Update the changelog

In `CHANGELOG.md`, add a section at the top:

```markdown
## [0.1.1] — YYYY-MM-DD

### Fixed
- …

### Added
- …

### Changed
- …
```

Use only sections that apply.

---

### 4. Commit and tag in Git (recommended)

```bash
git add -A
git commit -m "Release v0.1.1"
git tag v0.1.1
git push
git push --tags
```

---

### 5. Clean old builds

Old files in `dist/` can confuse uploads. Remove them:

```bash
# macOS / Linux
rm -rf dist/ build/ *.egg-info

# Windows (PowerShell)
Remove-Item -Recurse -Force dist, build -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force *.egg-info -ErrorAction SilentlyContinue
```

---

### 6. Build

With venv active, from the package root:

```bash
python -m build
```

Confirm `dist/` has:

- `pyronites-0.1.1.tar.gz`
- `pyronites-0.1.1-py3-none-any.whl`

(version numbers match what you set)

---

### 7. Check the build

```bash
twine check dist/*
```

Must pass with no errors.

---

### 8. Upload to PyPI

**Preferred (no password paste issues):**

```bash
# macOS / Linux
export TWINE_USERNAME="__token__"
export TWINE_PASSWORD="pypi-YOUR_FULL_TOKEN"
twine upload dist/*

# Windows PowerShell
$env:TWINE_USERNAME = "__token__"
$env:TWINE_PASSWORD = "pypi-YOUR_FULL_TOKEN"
twine upload dist/*
```

- Username is always `__token__` (not your PyPI username).
- Password is the full API token starting with `pypi-`.

Or interactive:

```bash
twine upload dist/*
```

---

### 9. Verify

1. Page: https://pypi.org/project/pyronites/  
   New version should appear.
2. Install:

```bash
pip install --upgrade pyronites
```

3. Check version:

```bash
python -c "from pyronites import __version__; print(__version__)"
```

Should print the new version (e.g. `0.1.1`).

---

## Short checklist (copy for each release)

- [ ] Code done + `pytest` green  
- [ ] Version bumped in `__init__.py` and `pyproject.toml` (same)  
- [ ] `CHANGELOG.md` updated  
- [ ] Git commit + tag (optional but good)  
- [ ] Delete old `dist/` / `build/`  
- [ ] `python -m build`  
- [ ] `twine check dist/*`  
- [ ] `twine upload dist/*` (with token)  
- [ ] Confirm on PyPI + `pip install --upgrade pyronites`  

---

## Common mistakes

| Mistake | What happens |
|--------|----------------|
| Same version as last release | Upload rejected |
| Version only changed in one file | Confusing / inconsistent package |
| Uploading from wrong directory | Wrong or incomplete package |
| Leaving old files in `dist/` | Might upload wrong version |
| Using PyPI username instead of `__token__` | Auth fails |
| Incomplete token (missing `pypi-`) | Auth fails |

---

## Token tips

- Create/manage tokens: https://pypi.org/manage/account/token/
- After first publish, you can scope a token to **only** the `pyronites` project.
- If a token is leaked, delete it on PyPI and create a new one.

---

## Optional: TestPyPI before real PyPI

If you want a dry run:

1. Account: https://test.pypi.org  
2. Token from TestPyPI account settings  
3. Upload:

```bash
twine upload --repository testpypi dist/*
```

4. Test install:

```bash
pip install -i https://test.pypi.org/simple/ --upgrade pyronites
```

Then upload the same `dist/` to real PyPI as in step 8.

---

That is the full process for every future version. Same steps each time; only the version number and changelog content change.