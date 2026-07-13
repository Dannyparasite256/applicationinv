# Local credentials template (safe to commit)

Copy this file to **`docs/CREDENTIALS.local.md`** (or `credentials.local.md` in the project root) and fill in real values.

**`CREDENTIALS.local.md` is gitignored — never commit it.**

Also put the same secrets in **`.env`** (gitignored) so `npm run db:seed` can use them.

## Environment variables (`.env`)

```env
# Seed / demo accounts (used by backend/prisma/seed.ts)
SEED_PASSWORD=choose-a-strong-password-here
SEED_ADMIN_EMAIL=admin@demo.local
SEED_SUPERADMIN_EMAIL=superadmin@ims.local

# Optional: platform bootstrap on API start (same password is fine for local)
SUPERADMIN_EMAIL=superadmin@ims.local
SUPERADMIN_PASSWORD=choose-a-strong-password-here

# App secrets (min 32 characters each)
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
ENCRYPTION_KEY=
DATABASE_URL=
```

## After seeding

| Role | Email | Password |
|------|-------|----------|
| Company Owner | value of `SEED_ADMIN_EMAIL` | value of `SEED_PASSWORD` |
| Super Admin | value of `SEED_SUPERADMIN_EMAIL` | value of `SEED_PASSWORD` |

## Production

- Never use seed/demo passwords in production.
- Create the super admin once with a unique password and store it only in a password manager.
- Rotate any password that was ever committed to Git history.
