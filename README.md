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

| User | Email | Password |
|------|-------|----------|
| Company Owner | `admin@demo.local` | `Admin@123` |
| Super Admin | `superadmin@ims.local` | `Admin@123` |

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
