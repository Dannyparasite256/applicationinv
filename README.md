# Enterprise Inventory Management System (EIMS)

Production-ready, multi-tenant ERP platform for **retail, wholesale, pharmacy, hospital/clinic, warehouse, and general business** operations.

## Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js · Express · TypeScript · Prisma · PostgreSQL · Redis |
| Auth | JWT access + refresh · RBAC · 2FA (TOTP) · bcrypt · sessions/devices |
| Frontend | React 19 · Vite · TypeScript · Tailwind · React Query · Zustand · Recharts · PWA |
| Ops | Docker Compose · Nginx · PM2 · GitHub Actions · Winston |

## Features

- **Multi-tenant** isolation (company-scoped data, branches, warehouses)
- **Auth**: login, register, forgot/reset password, email verification, 2FA, device & login history
- **RBAC**: 18 roles, granular permissions, permission middleware
- **Inventory**: products, categories, brands, batches, serials, barcodes, stock levels, transfers, adjustments, low-stock & expiry
- **POS**: barcode scan, keyboard shortcuts (F2/F9), shifts, multi-pay methods, offline queue (PWA)
- **Sales & Purchases**: sales orders, GRN/receiving, suppliers
- **CRM**: customers, loyalty points hooks, suppliers
- **Accounting**: chart of accounts seed, ledger foundation
- **Hospital**: patients, appointments, prescriptions, vitals, admissions models
- **Pharmacy & Lab**: drug products, Rx flags, lab orders/results
- **HR**: employees, attendance, leave models
- **Dashboard**: KPIs, sales charts, top products/customers, branch performance
- **Security**: Helmet, CORS, rate limit, Zod validation, audit logs, soft deletes
- **API docs**: Swagger at `/api/v1/docs`

## Android app (native)

The React UI ships as a **native Android app** via [Capacitor](https://capacitorjs.com/).

```bash
cd frontend
npm install
npm run build
npx cap add android    # first time only
npx cap sync android
npx cap open android   # Android Studio → Run
```

See **[docs/ANDROID.md](docs/ANDROID.md)** for emulator vs phone API URLs, release APK, and troubleshooting.

App ID: `com.enterprise.ims`

## Quick start (local)

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Redis (optional; falls back to in-memory)

### 1. Clone & configure

```bash
cp .env.example .env
# Edit DATABASE_URL / JWT secrets if needed
```

### 2. Install

```bash
npm install
```

### 3. Database

```bash
# Start Postgres (example with Docker)
docker compose up -d postgres redis

cd backend
npx prisma migrate dev --name init
npm run db:seed
```

### 4. Run

```bash
# From repo root
npm run dev
```

- **Frontend**: http://localhost:5173  
- **API**: http://localhost:4000/api/v1  
- **Swagger**: http://localhost:4000/api/v1/docs  

### Demo credentials

Demo / super-admin passwords are **not stored in this repo**.

1. Copy `docs/CREDENTIALS.example.md` → `docs/CREDENTIALS.local.md` (gitignored)
2. Set `SEED_PASSWORD` (and optional emails) in `.env`
3. Run `npm run db:seed`

See **[docs/CREDENTIALS.example.md](docs/CREDENTIALS.example.md)**.

## Docker (full stack)

```bash
docker compose up -d --build
```

- Web (via nginx): http://localhost  
- API direct: http://localhost:4000  
- Web container: http://localhost:8080  

## GitHub & free hosting

Beginner guide (push to GitHub, local free hosting, Render/Vercel):

→ **[docs/GITHUB_AND_HOSTING.md](docs/GITHUB_AND_HOSTING.md)**

| Goal | Simplest option |
|------|-----------------|
| Code backup / sharing | GitHub only |
| Working free public URL | **Render** (`render.yaml` Blueprint) |
| Frontend-only CDN | Vercel (`vercel.json`) + API elsewhere |
| Run free on your PC | `npm run dev` or Docker Compose |

### Deploy to Render (free)

1. Push to GitHub: https://github.com/Dannyparasite256/applicationinv  
2. [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint** → select that repo  
3. Apply `render.yaml` (creates free Postgres + `eims-api` + `eims-web`)  
4. After deploy, set real URLs (see guide):
   - **eims-web** env: `VITE_API_URL=https://YOUR-API.onrender.com/api/v1` → rebuild web  
   - **eims-api** env: `CORS_ORIGINS` / `APP_URL` / `API_URL` to match real hosts  
5. Optional seed (API Shell): `npm run db:seed -w backend`  

## Project structure

```
├── backend/
│   ├── prisma/          # Schema, migrations, seed
│   └── src/
│       ├── config/      # env, db, redis, swagger
│       ├── controllers/
│       ├── services/
│       ├── middleware/  # auth, RBAC, audit, rate limit
│       ├── routes/
│       ├── validators/  # Zod DTOs
│       ├── utils/
│       └── __tests__/
├── frontend/
│   └── src/
│       ├── components/
│       ├── pages/       # auth, dashboard, POS, modules
│       ├── stores/      # auth, theme, POS offline cart
│       ├── services/
│       └── lib/
├── docs/                # Guides & schema notes
├── nginx/
├── scripts/backup.sh
└── docker-compose.yml
```

## API overview

Base path: `/api/v1`

| Area | Endpoints |
|------|-----------|
| Auth | `POST /auth/register`, `/login`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password`, `/verify-email`, `/2fa/*`, `GET /auth/me` |
| Products | `GET/POST /products`, `GET /products/:id`, `GET /products/barcode/:code`, low-stock, expiring, categories, brands |
| Sales / POS | `GET/POST /sales`, shifts open/close |
| Purchases | `GET/POST /purchases`, `POST /purchases/:id/receive` |
| CRM | `/customers`, `/suppliers` |
| Hospital | `/patients`, `/appointments`, `/prescriptions`, `/lab-orders` |
| Company | `/company`, `/branches`, `/warehouses`, `/accounts`, `/employees` |
| Dashboard | `GET /dashboard` |

All list endpoints support: `page`, `limit`, `search`, `sortBy`, `sortOrder`.

Authenticated requests: `Authorization: Bearer <accessToken>`.

## Multi-tenancy

Every business record is scoped by `companyId`. Middleware `requireTenant` binds the JWT company context. Super admins may pass `X-Company-Id` to act on a tenant.

## Production notes

1. Set strong `JWT_*_SECRET` and `ENCRYPTION_KEY` (32+ chars).
2. Enable HTTPS (terminate at Nginx / load balancer).
3. Run migrations: `npx prisma migrate deploy`.
4. Process manager: `pm2 start ecosystem.config.cjs`.
5. Backups: `scripts/backup.sh` (pg_dump + retention).
6. Configure SMTP for email; SMS provider for SMS.

## Testing

```bash
cd backend
npm test
```

## Documentation

- [Installation Guide](docs/INSTALLATION.md)
- [Developer Guide](docs/DEVELOPER.md)
- [Administrator Guide](docs/ADMIN.md)
- [User Manual](docs/USER_MANUAL.md)
- [Database Schema](docs/DATABASE.md)
- [API](http://localhost:4000/api/v1/docs) (when running)

## License

Proprietary / All rights reserved — customize for your organization.
