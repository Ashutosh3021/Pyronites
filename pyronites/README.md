# pyronites

Official Python client for the [Pyronites](https://github.com/Ashutosh3021/Pyronites) backend.

## Install

```bash
pip install -e ./pyronites          # development
# pip install pyronites           # later, from PyPI
```

## Quick start

```bash
export PYRONITES_URL="https://your-backend.example.com"
export PYRONITES_KEY="pyro_live_..."
```

```python
from pyronites import create_client

client = create_client()

# Tables
note = client.table("notes").insert({"title": "Hello"})
rows = list(client.table("notes").select().limit(10))
client.table("notes").update({"title": "Updated"}).eq("id", note["id"])
client.table("notes").delete().eq("id", note["id"])

# Auth (optional)
client.auth.sign_in("user@example.com", "password")
print(client.auth.user())
client.auth.sign_out()
```

See `docs/syntax.md` for the full public API contract.
