# PyroCore — Easy Deploy Guide

Deploy PyroCore in ~10 minutes:

- **Backend** → Render (free tier OK, with an optional S3 bucket so data survives redeploys)
- **Frontend** → Vercel (the Next.js dashboard)

Everything is already wired up in the repo (`Dockerfile`, `render.yaml`, `vercel.json`).
You just connect your accounts, set a few variables, and deploy.

---

## What you need (sign up for free)

1. A **GitHub** account with this repo pushed to it.
2. A **Render** account → https://render.com
3. A **Vercel** account → https://vercel.com
4. *(Optional, only for free-tier data persistence)* an **S3 or Cloudflare R2** bucket.

---

## Step 1 — Deploy the Backend (Render)

1. Go to Render → **New → Blueprint**.
2. Connect your GitHub repo. Render reads `render.yaml` and creates a service called `pyrocore-backend`.
3. Click **Deploy**. The first build takes a few minutes.
4. After the first deploy finishes, open the service → **Environment** and set these secret variables:

   | Key | Value | Why |
   |---|---|---|
   | `FRONTEND_ORIGIN` | *(optional)* | **No longer required.** The backend now allows any origin by default, so a cross-origin dashboard works without it. If you DO set it, it must be the *exact* Vercel URL (e.g. `https://pyronites.vercel.app`) — a wrong value will re-break CORS. Leave it **unset** unless you want to lock the API to one origin. |
   | `SESSION_COOKIE_SECURE` | *(optional)* | Auto-detected from HTTPS now. Only set to force a value. |
   | `SESSION_COOKIE_SAMESITE` | *(optional)* | Auto-detected (`none` over HTTPS, `lax` on localhost). Only set to force a value. |

   > Leave `PORT` alone — Render sets it automatically.

5. Click **Deploy** again so the new variables take effect.
6. Note your backend URL: `https://<your-service>.onrender.com`
   (You can rename it later under **Settings → Custom Domain**.)

### ✅ Verify the backend
```bash
curl https://<your-service>.onrender.com/health
# -> {"status":"ok",...}
```

### (Recommended) Keep your data on the free tier
Render's free tier has **no disk** — the database resets on every restart unless you add an S3/R2 bucket. Set these in the same **Environment** tab:

| Key | Example |
|---|---|
| `S3_SYNC_ENABLED` | `true` |
| `S3_BUCKET` | `pyrocore-db` |
| `S3_REGION` | `us-east-1` (or `auto` for R2) |
| `S3_ENDPOINT_URL` | `https://<id>.r2.cloudflarestorage.com` *(R2 only; omit for AWS S3)* |
| `S3_ACCESS_KEY_ID` | `…` |
| `S3_SECRET_ACCESS_KEY` | `…` |
| `S3_PREFIX` | `pyrocore/` |

Redeploy. Now your DB is pulled from the bucket on startup and pushed after every backup.

> Prefer zero config? Upgrade to a paid plan (`starter`, ~$7/mo) and uncomment the
> `disk:` block at the bottom of `render.yaml` for a real persistent disk.

---

## Step 2 — Deploy the Frontend (Vercel)

1. Go to Vercel → **Add New → Project** → import this GitHub repo.
2. Vercel auto-detects the `frontend/` folder (via `vercel.json`).
3. Before deploying, add one **build-time** environment variable
   (**Settings → Environment Variables**):

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<your-service>.onrender.com` *(from Step 1)* |

4. Click **Deploy**.

> `NEXT_PUBLIC_API_URL` is baked into the build. If you ever change the backend
> URL, update this value **and redeploy** the Vercel project.

### ✅ Verify the frontend
Open your Vercel URL (`https://<your-vercel-app>.vercel.app`). The dashboard
should load and you should be able to sign up / log in.

---

## Step 3 — Connect the two (double-check)

| Where | Variable | Must point to |
|---|---|---|
| Render (backend) | `FRONTEND_ORIGIN` | your Vercel URL |
| Vercel (frontend) | `NEXT_PUBLIC_API_URL` | your Render URL |

If the dashboard loads but **every API call fails with a CORS error**, the
`FRONTEND_ORIGIN` on Render doesn't list your Vercel URL — fix and redeploy
Render.

---

## Quick troubleshooting

| Symptom | Fix |
|---|---|
| Dashboard loads, but you get bounced to login on every action (401 loop) | On Render set `SESSION_COOKIE_SECURE=true` + `SESSION_COOKIE_SAMESITE=none`, redeploy. |
| CORS error in browser console | `FRONTEND_ORIGIN` on Render must list your exact Vercel URL. |
| Frontend still calls `localhost:8000` | `NEXT_PUBLIC_API_URL` was missing at build time — set it and **redeploy Vercel**. |
| `/health` works but data disappears after a restart | Free tier has no disk. Add the S3/R2 vars (Step 1) or upgrade to a paid plan. |
| Backend shows "unhealthy" / won't start | Wait — first boot runs migrations. Check **Logs** in Render. |

---

## Local dev (optional)

```bash
# Backend
python -m venv .venv && .venv\Scripts\activate   # (Windows) or: source .venv/bin/activate
pip install -e .
uvicorn backend.app:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev      # http://localhost:3000
```

That's it. For the deep-dive on every gotcha (cookies, volumes, backups, S3 sync),
see the full `DEPLOY.md`.
