### Entry point
| Method | Notes |
|--------|--------|
| `create_client(url?, key?, timeout?, local_tables?, remote_tables?, cache_tables?, local_db_path?)` | Factory → `PyronitesClient` |

---

### `PyronitesClient`
| Method | Maps to / does |
|--------|----------------|
| `table(name)` | Returns `TableQuery` for that table |
| `tables()` | `GET /tables` — list tables + row counts |
| `sql(query)` | `POST /sql/execute` (admin key) |
| `pull(table)` | Fetch remote rows → replace local copy |
| `push(table)` | Push local rows to remote |
| `sync(table)` | Same as `pull` (remote wins) |
| `close()` | Close HTTP + local store |
| `__enter__` / `__exit__` | Context manager |

**Sub-clients:** `client.auth`, `client.storage`

---

### `client.auth` (`AuthClient`)
| Method | Backend |
|--------|---------|
| `sign_up(email, password)` | `POST /auth/signup` |
| `sign_in(email, password)` | `POST /auth/login` |
| `sign_out()` | `POST /auth/logout` |
| `user()` | `GET /auth/me` (30s cache) |

---

### `client.table("name")` (`TableQuery`)
| Method | Backend / behavior |
|--------|---------------------|
| `select()` | Start select query |
| `eq(column, value)` | Equality filter (on update/delete runs immediately) |
| `limit(n)` | Limit rows |
| `offset(n)` | Offset rows |
| `insert(row)` / `insert([rows])` | `POST /tables/{name}` |
| `update(data)` | Start update (needs `.eq("id", …)`) |
| `delete()` | Start delete (needs `.eq("id", …)`) |
| `get(row_id)` | `GET /tables/{name}/{id}` |
| `schema()` | `GET /tables/{name}/schema` |
| `single()` | Select + require exactly one row |
| `execute()` | Run pending select/update/delete |
| `__iter__` | Iterate select results |
| `__call__` | Same as `execute()` |

---

### `client.storage` (`StorageClient`)
| Method | Backend |
|--------|---------|
| `upload(source, filename?, content_type?)` | `POST /storage/upload` |
| `list(prefix?, limit?, offset?)` | `GET /storage` |
| `get(file_id)` | `GET /storage/{id}` |
| `download(file_id, path?)` | `GET /storage/{id}/download` |
| `remove(file_id)` | `DELETE /storage/{id}` |

---

### Errors (public)
- `ApiError`
- `AuthError` (401/403)
- `NotFoundError` (404)

Here’s the full **backend HTTP API** — every route, method, and path.

---

### Health
| Method | Path | What it does |
|--------|------|----------------|
| **GET** | `/health` | Health check (DB up?) |

---

### Auth (`/auth`)
| Method | Path | What it does |
|--------|------|----------------|
| **POST** | `/auth/signup` | Create account |
| **POST** | `/auth/login` | Log in (sets session cookie) |
| **POST** | `/auth/logout` | Log out |
| **GET** | `/auth/me` | Current user + `last_project_id` |
| **POST** | `/auth/forgot-password` | Request password reset email |
| **POST** | `/auth/reset-password` | Reset password with token |
| **DELETE** | `/auth/account` | Delete own account (password required) |

---

### Tables — unscoped / Default / meta DB (`/tables`)
| Method | Path | What it does |
|--------|------|----------------|
| **GET** | `/tables` | List tables + row counts |
| **POST** | `/tables` | Create table (admin) |
| **GET** | `/tables/{table}` | List rows (limit/offset/filter) |
| **POST** | `/tables/{table}` | Insert row |
| **GET** | `/tables/{table}/schema` | Column schema |
| **GET** | `/tables/{table}/{id}` | Get one row |
| **PATCH** | `/tables/{table}/{id}` | Update row |
| **DELETE** | `/tables/{table}/{id}` | Delete row |
| **DELETE** | `/tables/{table}` | Drop table (admin + name confirm) |

---

### Storage — unscoped (`/storage`)
| Method | Path | What it does |
|--------|------|----------------|
| **POST** | `/storage/upload` | Upload file |
| **GET** | `/storage` | List files |
| **GET** | `/storage/{file_id}` | File metadata |
| **GET** | `/storage/{file_id}/download` | Download file bytes |
| **DELETE** | `/storage/{file_id}` | Delete file |

---

### SQL — unscoped
| Method | Path | What it does |
|--------|------|----------------|
| **POST** | `/sql/execute` | Run raw SQL (auto-backup on writes) |

---

### Projects (`/api/projects`)
| Method | Path | What it does |
|--------|------|----------------|
| **GET** | `/api/projects` | List your projects |
| **POST** | `/api/projects` | Create project |
| **GET** | `/api/projects/{project_id}` | Get one project |
| **PATCH** | `/api/projects/{project_id}` | Update project |
| **POST** | `/api/projects/{project_id}/select` | Set as last/active project |
| **POST** | `/api/projects/{project_id}/archive` | Archive project |
| **POST** | `/api/projects/{project_id}/restore` | Restore archived project |
| **DELETE** | `/api/projects/{project_id}` | Hard-delete project (name confirm) |

---

### API keys — unscoped (`/api/keys`)
| Method | Path | What it does |
|--------|------|----------------|
| **GET** | `/api/keys` | List keys |
| **POST** | `/api/keys` | Create key (returns raw key once) |
| **DELETE** | `/api/keys/{key_id}` | Revoke key |

---

### System / dashboard (`/api`)
| Method | Path | What it does |
|--------|------|----------------|
| **GET** | `/api/stats` | Overview stats |
| **GET** | `/api/logs` | Recent event log |
| **GET** | `/api/backups` | List backups |
| **POST** | `/api/backup` | Trigger backup now |
| **POST** | `/api/backup/restore` | Restore from backup path |
| **GET** | `/api/users` | List users |
| **PATCH** | `/api/users/{user_id}` | Enable/disable user |
| **DELETE** | `/api/users/{user_id}` | Delete user |
| **GET** | `/api/sessions` | List sessions |
| **DELETE** | `/api/sessions/{session_id}` | Revoke session |

---

### Project-scoped data plane  
Prefix: `/api/projects/{project_id}/…`  
(hits that project’s SQLite file, not meta)

| Method | Path | What it does |
|--------|------|----------------|
| **GET** | `…/tables` | List tables |
| **POST** | `…/tables` | Create table |
| **GET** | `…/tables/{table}` | List rows |
| **POST** | `…/tables/{table}` | Insert row |
| **GET** | `…/tables/{table}/schema` | Schema |
| **GET** | `…/tables/{table}/{id}` | Get row |
| **PATCH** | `…/tables/{table}/{id}` | Update row |
| **DELETE** | `…/tables/{table}/{id}` | Delete row |
| **DELETE** | `…/tables/{table}` | Drop table |
| **POST** | `…/storage/upload` | Upload |
| **GET** | `…/storage` | List files |
| **GET** | `…/storage/{file_id}` | Metadata |
| **GET** | `…/storage/{file_id}/download` | Download |
| **DELETE** | `…/storage/{file_id}` | Delete file |
| **POST** | `…/sql/execute` | Raw SQL |
| **GET** | `…/api/keys` | List keys for this project |
| **POST** | `…/api/keys` | Create key for this project |
| **DELETE** | `…/api/keys/{key_id}` | Revoke key |
| **GET** | `…/stats` | Project stats |

---

**Auth:** session cookie and/or `Authorization: Bearer pyro_live_…`  
**Scopes:** `read` / `write` / `admin` (per route)
