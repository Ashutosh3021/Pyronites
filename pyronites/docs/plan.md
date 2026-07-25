# pyronites — Client Package Plan

> Reference & checklist for building the official Python client that talks to a self-hosted PyroCore / Pyronites backend.
>
> Goal: make using Pyronites feel as simple as `supabase-py`, with **zero cost** and clear control over what stays local vs remote.

---

## Document map

| File | Use |
|------|-----|
| `docs/plan.md` | This file — phases, success criteria, non-goals |
| `docs/features.md` | Feature-level checklist |
| `docs/architect.md` | Architecture, modules, data flow, security |
| `docs/syntax.md` | Public API contract & usage examples |

Install: `pip install -e ./pyronites`

---

## Phases (summary)

- **P1** Core client (config, http, auth, table) — done
- **P2** Storage + ergonomics
- **P3** Local vs remote policy
- **P4** Polish & publish

See the full plan history in git; this file is the living checklist. Update when phase decisions change.
