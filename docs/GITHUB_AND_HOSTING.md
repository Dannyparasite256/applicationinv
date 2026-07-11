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

Demo logins (after seed):

| Role | Email | Password |
|------|-------|----------|
| Company Owner | `admin@demo.local` | `Admin@123` |
| Super Admin | `superadmin@ims.local` | `Admin@123` |

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

**Limits (be aware):** free services **sleep** after idle time (first request can be slow). Free Postgres may have size/time limits — fine for learning and demos, not heavy production.

#### Steps (Blueprint)

1. Push this repo to GitHub (Part B).
2. Go to [https://render.com](https://render.com) → sign up with GitHub.
3. **New** → **Blueprint** → select your repo.
4. Render reads `render.yaml` and creates:
   - `eims-postgres`
   - `eims-api`
   - `eims-web`
5. After the API is live, open its URL (e.g. `https://eims-api.onrender.com`).
6. In the **eims-web** service env, set:

   ```text
   VITE_API_URL=https://eims-api.onrender.com/api/v1
   ```

   Then **Manual Deploy → Clear build cache & deploy**.
7. In the **eims-api** service env, set:

   ```text
   CORS_ORIGINS=https://eims-web.onrender.com
   APP_URL=https://eims-web.onrender.com
   API_URL=https://eims-api.onrender.com
   ```

   Replace hostnames with your real ones, then redeploy the API.
8. (Optional) Seed demo data: Render dashboard → API service → **Shell**:

   ```bash
   npm run db:seed -w backend
   ```

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
