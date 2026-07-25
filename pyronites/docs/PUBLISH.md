# Publishing pyronites to PyPI

## Preconditions

- [x] P1–P3 feature-complete
- [x] Unit tests passing
- [x] `CHANGELOG.md` updated
- [x] Version in `pyproject.toml` and `pyronites/__init__.py` match
- [ ] PyPI account + API token
- [ ] Package name `pyronites` available (or use a scoped name if taken)

## Steps

```bash
cd pyronites
pip install build twine

python -m build
twine check dist/*

# TestPyPI first (recommended)
twine upload --repository testpypi dist/*
# then
twine upload dist/*
```

## After publish

```bash
pip install pyronites
python -c "from pyronites import create_client, __version__; print(__version__)"
```

## Version bumps

1. Update `__version__` in `pyronites/__init__.py`
2. Update `version` in `pyproject.toml`
3. Add a section to `CHANGELOG.md`
4. Tag: `git tag v0.1.0 && git push --tags`
