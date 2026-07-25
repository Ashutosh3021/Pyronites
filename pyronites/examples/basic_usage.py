#!/usr/bin/env python3
"""Minimal example against a live or local Pyronites backend.

Usage:
  export PYRONITES_URL=https://pyrocore-backend.onrender.com
  export PYRONITES_KEY=pyro_live_...
  python examples/basic_usage.py
"""

from __future__ import annotations

import os
import sys

from pyronites import ApiError, create_client


def main() -> int:
    if not os.environ.get("PYRONITES_URL"):
        print("Set PYRONITES_URL (and usually PYRONITES_KEY) first.", file=sys.stderr)
        return 1

    client = create_client()
    try:
        print("Inserting demo row into 'notes' (table must exist on backend)...")
        try:
            row = client.table("notes").insert(
                {"title": "pyronites demo", "body": "hello from examples/basic_usage.py"}
            )
            print("Inserted:", row)
            rid = row.get("id")
            if rid:
                client.table("notes").delete().eq("id", rid)
                print("Deleted:", rid)
        except ApiError as e:
            print(f"Table operation failed ({e}). Create a 'notes' table in the dashboard first.")
            return 1
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
