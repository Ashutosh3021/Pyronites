# Package layout (canonical)

```
pyronites/                 # installable root → pip install -e ./pyronites
├── docs/
│   ├── architect.md
│   ├── features.md
│   ├── plan.md
│   └── syntax.md
├── pyproject.toml
├── README.md
├── pyronites/             # importable Python package
│   ├── __init__.py
│   ├── client.py
│   ├── config.py
│   ├── http.py
│   ├── errors.py
│   ├── auth.py
│   ├── table.py
│   └── …                  # storage.py (P2), local.py (P3)
└── tests/
```

Install: `pip install -e ./pyronites`  
Import: `from pyronites import create_client`
