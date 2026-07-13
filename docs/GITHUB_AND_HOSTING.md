# GitHub + free hosting guide (beginner-friendly)

This project is a **full-stack monorepo**:

| Part | Stack |
|------|--------|
| Frontend | React 19 · Vite · TypeScript · Tailwind · Capacitor (Android) |
| Backend | Node.js · Express · TypeScript · Prisma · JWT |
| Database | PostgreSQL 16 |
| Cache | Redis 7 (optional — falls back to memory) |
| Local full stack | Docker Compose · Nginx · PM2 |

Secrets live in `.env` (ignored by Git). Use `.env.example` / `.env.production.example` as templates only.

---

## Part A — Free hosting on your PC (local)

### Option 1 — Dev mode (easiest day-to-day)

You need **Node.js 20+** and **PostgreSQL** running.

```bash
# From project root
copy .env.example .env
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

- App: http://localhost:5173  
- API: http://localhost:4000/api/v1  
- Docs: http://localhost:4000/api/v1/docs  

Demo logins (after seed): use the emails/password you set in **`.env`** (`SEED_PASSWORD`, `SEED_ADMIN_EMAIL`, `SEED_SUPERADMIN_EMAIL`).  
Keep them only in gitignored files (`.env`, `docs/CREDENTIALS.local.md`). See **[CREDENTIALS.example.md](./CREDENTIALS.example.md)**.

### Option 2 — Docker (full stack like production)

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), then:

```bash
copy .env.example .env
docker compose up -d --build
```

Then migrate/seed inside the API container (when Docker is available):

```bash
docker compose exec api npx prisma migrate deploy
docker compose exec api npx tsx prisma/seed.ts
```

- Web via Nginx: http://localhost  
- Web container: http://localhost:8080  
- API: http://localhost:4000  

Stop:

```bash
docker compose down
```

---

## Part B — Put the code on GitHub

### 1. Create an empty GitHub repository

1. Sign in at [https://github.com](https://github.com)
2. Click **+** → **New repository**
3. Name it e.g. `enterprise-ims`
4. Leave **empty** (no README, no .gitignore — you already have them)
5. Click **Create repository**
6. Copy the HTTPS URL, e.g. `https://github.com/YOUR_USERNAME/enterprise-ims.git`

### 2. First commit (if not done yet)

Open PowerShell in the project folder:

```powershell
cd C:\Users\TECNO\Desktop\project

git status
# Confirm .env is NOT listed (it must stay private)

# If you still need the first commit:
git add .
git commit -m "Initial commit: Enterprise IMS monorepo"
```

### 3. Connect GitHub and push

```powershell
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/enterprise-ims.git
git push -u origin main
```

GitHub will ask you to sign in (browser or personal access token).  
**Never put your real password inside `.env` and push it.**

### 4. Later updates

```powershell
git add .
git commit -m "Describe your change"
git push
```

---

## Part C — Simplest free cloud hosting

### Recommended: **Render** (one platform for API + DB + web)

Why Render for *this* app?

- Free **Node web service** for the Express API  
- Free **PostgreSQL** (limited; fine for demos)  
- Free **static site** for the Vite frontend  
- This repo includes `render.yaml` so you can use a Blueprint deploy  

**Limits (be aware):**

- Free web services **sleep** after ~15 minutes idle (first request can take 30–60s).
- Free Postgres is **~1 GB** and typically **expires after 30 days** (upgrade or export data before then).
- No free Redis — this app uses an in-memory fallback (already configured).

#### Steps (Blueprint) — exact clicks

1. Push this repo to GitHub (already done for `Dannyparasite256/applicationinv` if you followed Part B).
2. Open [https://dashboard.render.com](https://dashboard.render.com) and sign up / log in with **GitHub**.
3. If asked, **grant Render access** to the `applicationinv` repository (or all repos).
4. Click **New +** → **Blueprint**.
5. Select **`Dannyparasite256/applicationinv`**.
6. Confirm the Blueprint path is `render.yaml` (repo root).
7. Click **Apply** / **Create resources**.
8. Wait until these three show as live (first deploy can take several minutes):

   | Resource | Type | Free? |
   |----------|------|-------|
   | `eims-postgres` | PostgreSQL | Yes (30-day free DB) |
   | `eims-api` | Web Service (Node) | Yes |
   | `eims-web` | Static Site | Yes |

9. **Copy the real URLs** from the Render dashboard (they may include a random suffix, not just `eims-api.onrender.com`):

   - API example: `https://eims-api-xxxx.onrender.com`
   - Web example: `https://eims-web-xxxx.onrender.com`

10. **Wire the frontend to the API** (required for login to work):

    - Open **eims-web** → **Environment**
    - Set `VITE_API_URL` to `https://YOUR-REAL-API-URL/api/v1`
    - **Manual Deploy** → **Clear build cache & deploy**  
      (Vite bakes this value in at build time)

11. **Tighten API CORS** (recommended after web URL is known):

    - Open **eims-api** → **Environment**
    - Set:
      - `CORS_ORIGINS` = `https://YOUR-REAL-WEB-URL`
      - `APP_URL` = `https://YOUR-REAL-WEB-URL`
      - `API_URL` = `https://YOUR-REAL-API-URL`
    - Save → redeploy API if it does not auto-redeploy

12. **(Optional) Seed demo users** — open **eims-api** → **Shell**:

    ```bash
    npm run db:seed -w backend
    ```

    Demo logins after seed:

    Demo / super-admin credentials: set via `SEED_PASSWORD` in `.env` (never commit).  
    See `docs/CREDENTIALS.example.md`.

13. Open the **eims-web** URL in your browser. First load may be slow while the free API wakes up.

#### Health checks

- API health: `https://YOUR-API-URL/api/v1/health`
- API docs: `https://YOUR-API-URL/api/v1/docs`

#### If Blueprint is blocked / requires a card

Some workspaces ask for billing verification even for free resources. If Blueprint fails:

1. **New + → PostgreSQL** → name `eims-postgres` → plan **Free** → create  
2. **New + → Web Service** → connect `applicationinv`  
   - Name: `eims-api`  
   - Runtime: Node  
   - Plan: **Free**  
   - Build: `npm install --include=dev && npm run db:generate -w backend && npm run build -w backend`  
   - Start: `npm run db:migrate:deploy -w backend && npm run start -w backend`  
   - Health check path: `/api/v1/health`  
   - Env: copy from `render.yaml` / `.env.production.example`  
   - `DATABASE_URL` → link the free Postgres  
3. **New + → Static Site** → same repo  
   - Name: `eims-web`  
   - Build: `npm install --include=dev && npm run build -w frontend`  
   - Publish directory: `frontend/dist`  
   - Env: `VITE_API_URL=https://YOUR-API/api/v1`  
   - Add rewrite `/*` → `/index.html` for SPA routing

### Alternative A: GitHub only (no cloud app host)

Keep code on GitHub; run only on your PC with `npm run dev` or Docker.  
Cost: **$0**. Best while learning.

### Alternative B: GitHub + Vercel (frontend only)

`vercel.json` is included for the **React frontend**.

1. Deploy backend + Postgres elsewhere (Render or Railway).
2. [Vercel](https://vercel.com) → Import GitHub repo.
3. Set env:

   ```text
   VITE_API_URL=https://YOUR-API-URL/api/v1
   ```

4. Vercel builds `frontend/dist` automatically via `vercel.json`.

Vercel alone **cannot** run this Express + Prisma + Postgres API for free in a simple way. Use it only for the UI.

### Alternative C: Free Postgres elsewhere

If Render’s free DB is unavailable:

1. Create a free database on [Neon](https://neon.tech) or [Supabase](https://supabase.com).
2. Copy the connection string into `DATABASE_URL` on your API host.
3. Keep the same migrate command: `npm run db:migrate:deploy -w backend`.

---

## What not to upload

Already ignored by `.gitignore` (safe):

- `.env` and secrets  
- `node_modules/`  
- build output (`dist/`, Android `build/`)  
- logs, uploads, PDFs  

Always double-check before the first push:

```powershell
git status
```

If you see `.env`, run:

```powershell
git rm --cached .env
```

---

## Quick decision guide

| Goal | Do this |
|------|---------|
| Learn / demo on my PC | `npm run dev` + local Postgres |
| Full stack on my PC “like production” | Docker Compose |
| Put code online for backup/sharing | GitHub only |
| Put a working URL online for free | **Render** (`render.yaml`) |
| Fastest pretty frontend URL | Vercel frontend + Render API |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `git` says not a repository | `cd` into the project folder first |
| Push rejected / auth failed | Sign in to GitHub; use a [Personal Access Token](https://github.com/settings/tokens) as password for HTTPS |
| API works, website cannot login | Set `VITE_API_URL` and rebuild frontend; set `CORS_ORIGINS` on API |
| Prisma P1001 | Wrong/missing `DATABASE_URL` |
| Free site is slow first load | Render free tier cold start — wait 30–60s |
| Redis errors | Safe to ignore on free tier (in-memory fallback) |
