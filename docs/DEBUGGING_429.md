# Debugging 429 Too Many Requests

When your app calls PyroCore and gets HTTP 429, this guide tells you exactly why and how to fix it.

---

## Quick Diagnosis

Run this from your terminal to test PyroCore directly:

```bash
curl -v -X POST https://your-pyrocore.onrender.com/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test12345"}'
```

Check the response:

| Response | Meaning |
|----------|---------|
| `200` / `201` | PyroCore is fine. Your backend's retry logic is the problem. |
| `429` with `Retry-After` header | PyroCore is rate-limiting you. Read the header and wait. |
| `429` with no headers | Old PyroCore version. Upgrade or contact support. |
| `401` | Missing or invalid API key. |
| `404` | Wrong endpoint URL. |

---

## PyroCore Rate Limits

| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| `POST /auth/signup` | 20 | per minute | per IP |
| `POST /auth/login` | 20 | per minute | per IP |
| `POST /auth/forgot-password` | 5 | per hour | per IP + email |

These are **application-level** limits on the PyroCore server. They are separate from hosting-level limits (Render, Fly.io, etc.).

---

## What the Headers Mean

Every 429 response from PyroCore includes these headers:

```
Retry-After: 60
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1789547153
```

| Header | Meaning |
|--------|---------|
| `Retry-After` | Seconds to wait before retrying. **Sleep this long.** |
| `X-RateLimit-Limit` | Max requests allowed in the window (e.g. 20) |
| `X-RateLimit-Remaining` | Requests left in current window (0 = blocked) |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |

---

## Common Causes

### 1. Retry Storm (Most Common)

Your code retries immediately on 429, creating more 429s:

```
Request 1 → 429 → retry in 0.3s → Request 2 → 429 → retry in 0.6s → Request 3 → 429
```

One user signup becomes 3-9 requests to PyroCore. If 10 users sign up, that's30-90 requests — way over the 20/min limit.

**Fix:** Respect `Retry-After`. Don't retry immediately.

### 2. Concurrent Requests

Your backend fires multiple parallel requests to PyroCore for a single user action:

```
User clicks "Sign Up"
  → POST /auth/signup (attempt 1)
  → POST /auth/signup (attempt 2, parallel)
  → POST /auth/signup (attempt 3, parallel)
```

**Fix:** Serialize retries. One request at a time.

### 3. Shared IP on Render

Free-tier Render apps share egress IPs. Other apps on the same IP may consume part of your rate limit.

**Fix:** Upgrade to a paid Render plan (dedicated IP), or add caching to reduce outbound calls.

### 4. No Caching of Auth State

Your app calls `GET /auth/me` on every page load, even when the user just logged in.

**Fix:** Cache the auth response for 5-10 minutes client-side.

---

## How to Fix Your Code

### Python (httpx)

```python
import httpx
import time

def call_pyrocore(method, url, payload=None, max_retries=3):
    for attempt in range(max_retries):
        response = httpx.request(method, url, json=payload)

        if response.status_code == 429:
            retry_after = int(response.headers.get("Retry-After", 60))
            remaining = response.headers.get("X-RateLimit-Remaining", "?")
            limit = response.headers.get("X-RateLimit-Limit", "?")
            print(f"Rate limited. Remaining: {remaining}/{limit}. Sleeping {retry_after}s.")
            time.sleep(retry_after)
            continue

        return response

    raise Exception("Rate limited after all retries")
```

### JavaScript (fetch)

```javascript
async function callPyrocore(method, url, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
      console.warn(`Rate limited. Sleeping ${retryAfter}s.`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    return response;
  }
  throw new Error('Rate limited after all retries');
}
```

### Pyronites Python Client

The official `pyronites` client (v1.2.0+) handles this automatically:

```python
from pyronites import create_client

client = create_client()
# Client reads Retry-After header and backs off automatically
# No manual retry logic needed
```

If you're using an older version:
```bash
pip install pyronites --upgrade
```

---

## Monitoring Your Rate

Add this to your backend to track outbound PyroCore calls:

```python
import logging

logger = logging.getLogger(__name__)

def log_rate_info(response, endpoint):
    """Log rate limit headers from every PyroCore response."""
    remaining = response.headers.get("X-RateLimit-Remaining")
    limit = response.headers.get("X-RateLimit-Limit")
    if remaining is not None:
        logger.info(
            "PyroCore %s | %s/%s remaining",
            endpoint, remaining, limit,
        )
    if response.status_code == 429:
        retry_after = response.headers.get("Retry-After", "?")
        logger.warning(
            "PyroCore 429 on %s | Retry-After=%s | Limit=%s | Remaining=%s",
            endpoint, retry_after, limit, remaining,
        )
```

---

## Checklist

Before contacting PyroCore support, confirm:

- [ ] You're using `pyronites>=1.2.0` (proper Retry-After handling)
- [ ] You're NOT firing concurrent retries (serialize them)
- [ ] You're respecting `Retry-After` header (sleeping that long)
- [ ] You're logging `X-RateLimit-*` headers
- [ ] You've tested with `curl` from a different machine
- [ ] You know your outbound request rate (requests/min to PyroCore)

---

## If Nothing Works

If you're still getting 429s after fixing your code:

1. **Check PyroCore health:** `curl https://your-pyrocore.onrender.com/health`
2. **Test from a different IP:** Use a VPN or different machine
3. **Contact support** with:
   - Your API key ID (first 8 chars only)
   - Timestamp range of the 429s
   - The exact endpoints hit
   - Your Render egress IP
   - The `X-RateLimit-*` header values from the 429 response
