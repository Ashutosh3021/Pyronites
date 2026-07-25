# pyronites — Client Package Features

> Feature checklist. Status: `[ ]` not started · `[~]` partial · `[x]` done

Install: `pip install -e ./pyronites`

---

## F0 — Packaging & project layout

- [x] Package name: `pyronites`
- [x] Installable: `pip install -e ./pyronites`
- [x] `pyproject.toml` with minimal deps (`httpx`)
- [x] Public import: `from pyronites import create_client`
- [x] Version string (`pyronites.__version__`)
- [ ] License aligned with main repo when chosen

---

## F1 — Configuration

- [x] `PYRONITES_URL` / `PYRONITES_KEY`
- [x] `create_client(url=..., key=...)` overrides env
- [x] Clear error if URL missing
- [ ] Local vs remote policy config (P3)

---

## F2 — HTTP transport

- [x] Single internal client
- [x] Bearer API key header
- [x] Parse `{code, message}` into typed errors
- [x] Configurable timeout
- [x] Does not log secrets

---

## F3 — Auth

- [x] `sign_up` / `sign_in` / `sign_out` / `user`
- [x] Works with API-key-only mode

---

## F4 — Tables

- [x] `select` / `insert` / `update().eq("id", ...)` / `delete().eq("id", ...)`
- [x] Simple `.eq()` filter on select
- [x] Returns dicts/lists; raises typed errors
- [x] `client.sql(query)` escape hatch

---

## F5 — Storage (P2)

- [ ] upload / list / download / remove

---

## F6 — Local vs remote (P3)

- [ ] local_tables / remote_tables / cache_tables

---

## F7 — DX

- [x] Short README
- [x] Type hints + docstrings on public API
- [ ] Example script against live backend
- [ ] Changelog when versioning starts

---

## F8 — Safety & quality

- [x] No secrets in exception messages
- [x] Unit tests (mocked HTTP)
- [x] Python 3.10+
- [ ] Integration test path documented
