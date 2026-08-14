## What the 429 errors are

`429 Too Many Requests` is the HTTP status the **external PyroCore service** (`https://pyrocore-backend.onrender.com`) returns when a client exceeds its rate limit. It's not a bug in your PrepIQ code — it's PyroCore throttling your backend because too many requests were sent in a short window.

## Why it happened in your logs

Looking at the timeline in `errorlogs.md`:

1. On every authenticated request, `pyronites_auth.py` calls `users_repo.get(...)` to look up the user. That triggers `GET /tables/users/<id>` (and a fallback `GET /tables/users?filter_column=id&...`).
2. The wizard `POST /api/v1/wizard/step1` then calls `users_repo.update(...)` → `PATCH /tables/users/<id>`.
3. The log shows **6 separate GETs + 1 PATCH** to the same user within ~3 seconds (18:32:30 → 18:32:33), all returning `429`.

So a single logical action (one wizard step) fired multiple rapid calls to the same Row-Level-API endpoint, blowing past PyroCore's free-tier request quota.

## Contributing factors

- **No/shared rate limiting on the client side.** Each repository call is independent; there's no global throttle or token-bucket, so bursts aren't smoothed out.
- **Redundant lookups.** `get_by_id` first tries `t.get(id)`, and on failure falls back to `select_eq(table, "id", ...)` — that alone can double the requests per lookup.
- **External retries + keep-alive pings.** Background keep-alive pings (`/health` every 14 min) plus multiple user-request threads all hit the same shared PyroCore instance, competing for the same rate limit.
- **Free-tier capacity.** PyroCore on Render free tier has very low request limits; any moderate traffic (or overlapping requests) trips 429s quickly.

## How the code currently handles it

- `base.py` wraps calls in `_retry()` with 3 attempts + exponential backoff (`0.5s, 1.0s, 1.5s`) — helps with *transient* throttling, but **not** with a hard, persistent rate limit like yours.
- `users.update()` catches the failure, logs a warning, and returns best-effort data so the wizard doesn't 500 (this only worked after the `logger` fix).
- `pyronites_auth` similarly falls back to JWT claims when the user lookup 429s.

## Why you still see failures

Because the 429 is *sustained* (the log shows the same pattern repeating at 18:40), the bounded retries just delay the same error. The real fix is on the **PyroCore/external side**, not PrepIQ code:

1. **Upgrade PyroCore's plan / raise its rate limit** (the actual root cause).
2. **Add client-side rate limiting / request coalescing** in `base.py` (e.g., a shared throttle, caching `get_by_user` results briefly, or collapsing the `get`+`select_eq` double-call).
3. **Cache or debounce** user/profile reads within a request so one wizard step doesn't issue 6 identical GETs.

In short: the 429 is PyroCore telling your backend "slow down" because a single user action generated a burst of identical requests against a rate-limited free-tier API.

---

