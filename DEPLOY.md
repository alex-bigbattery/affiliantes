# Deploy — Frontend on Vercel, Backend on Render

Architecture:
- **Frontend** (React + Vite) → **Vercel**
- **Backend** (Express API + 30-min AffiliateWP→Supabase sync) → **Render**
- **Database** → **Supabase** (shared with the commission system)

The frontend calls the backend via `VITE_API_URL`. The backend allows the
frontend's origin via `ALLOWED_ORIGINS`. Deploy the backend first so you have
its URL for the frontend.

---

## 1. Push to a new GitHub repo

This folder is already a git repo with an initial commit. Create an empty repo
on GitHub (no README), then:

```bash
cd E:\commission-automation\affiliate-dashboard
git remote add origin https://github.com/<you>/bigbattery-affiliate-dashboard.git
git push -u origin main
```

Or with the GitHub CLI:

```bash
gh repo create bigbattery-affiliate-dashboard --private --source=. --remote=origin --push
```

> `.env` is gitignored and will NOT be pushed. Secrets are set in the Render/Vercel dashboards.

---

## 2. Backend → Render

1. Render dashboard → **New → Blueprint** → connect the GitHub repo.
   It reads `render.yaml` and creates the `affiliate-dashboard-api` web service.
   (Or **New → Web Service**: runtime **Node**, build `npm install`, start `node server.js`.)
2. Set the secret env vars (marked `sync: false`) under the service → **Environment**:
   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | your Supabase Postgres connection string |
   | `AFFWP_PUBLIC_KEY` | AffiliateWP public key |
   | `AFFWP_TOKEN` | AffiliateWP token |
   | `AFFWP_SECRET_KEY` | AffiliateWP secret key |
   | `ALLOWED_ORIGINS` | *(leave blank for now — fill in step 4)* |

   `SUPABASE_URL`, `SYNC_INTERVAL_MINUTES`, `NODE_VERSION` come from `render.yaml`.
3. Deploy. Confirm health: `https://<service>.onrender.com/api/health` → `{"ok":true}`.
4. Copy the service URL, e.g. `https://affiliate-dashboard-api.onrender.com`.

---

## 3. Frontend → Vercel

1. Vercel → **Add New → Project** → import the same repo.
   Framework preset auto-detects **Vite** (build `npm run build`, output `dist` — from `vercel.json`).
2. Add an environment variable:
   | Key | Value |
   |-----|-------|
   | `VITE_API_URL` | `https://affiliate-dashboard-api.onrender.com` (your Render URL, no trailing slash) |
3. Deploy. Copy the Vercel URL, e.g. `https://bigbattery-affiliate-dashboard.vercel.app`.

> `VITE_API_URL` is read at **build time**. If you change it later, redeploy the frontend.

---

## 4. Connect them (CORS)

1. Back in Render → service → **Environment**, set:
   - `ALLOWED_ORIGINS` = your Vercel URL (e.g. `https://bigbattery-affiliate-dashboard.vercel.app`)
   - For multiple, comma-separate them.
2. Render redeploys. Open the Vercel URL — the dashboard should load live data.

---

## Notes

- **Free Render tier sleeps** after ~15 min idle. The first request after sleep takes
  ~30–60s (cold start), and the 30-min auto-sync pauses while asleep. Reads still work
  (data lives in Supabase); they're just slow on the first hit. To avoid this: use a
  paid plan, or ping `/api/health` on a schedule to keep it awake.
- **Local dev** is unchanged: leave `VITE_API_URL` empty in your local `.env` and run
  `npm run dev` — Vite proxies `/api` to `localhost:3001`.
- The backend runs an initial sync on every boot, then every `SYNC_INTERVAL_MINUTES`.
