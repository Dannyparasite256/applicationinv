# Installation Guide

## System requirements

- CPU: 2+ cores recommended
- RAM: 4 GB minimum (8 GB+ for production)
- Disk: 20 GB+
- OS: Linux, Windows (WSL2), or macOS
- Node.js 20 LTS
- PostgreSQL 16
- Redis 7 (recommended)
- Docker 24+ (optional)

## Development install

1. Install Node.js 20+ and PostgreSQL.
2. Copy environment file:

   ```bash
   cp .env.example .env
   ```

3. Create database:

   ```sql
   CREATE USER ims WITH PASSWORD 'ims_secret';
   CREATE DATABASE enterprise_ims OWNER ims;
   ```

4. Install dependencies from monorepo root:

   ```bash
   npm install
   ```

5. Migrate & seed:

   ```bash
   cd backend
   npx prisma migrate dev --name init
   npm run db:seed
   ```

6. Start apps:

   ```bash
   cd ..
   npm run dev
   ```

## Docker install

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec api npx prisma migrate deploy
docker compose exec api npx tsx prisma/seed.ts
```

Access http://localhost (nginx) or http://localhost:8080 (web).

## Production checklist

- [ ] Change all secrets in `.env`
- [ ] Set `NODE_ENV=production`
- [ ] Configure TLS certificates on reverse proxy
- [ ] Enable SMTP (`EMAIL_ENABLED=true`)
- [ ] Schedule `scripts/backup.sh` via cron
- [ ] Restrict CORS origins
- [ ] Set rate limits appropriately
- [ ] Run only migrations deploy (not `migrate dev`)

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Prisma P1001 | PostgreSQL not reachable — check `DATABASE_URL` |
| Redis errors | App falls back to memory; start Redis for production |
| CORS blocked | Add frontend origin to `CORS_ORIGINS` |
| 401 on API | Token expired — refresh via `/auth/refresh` |
