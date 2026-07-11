# Administrator Guide

## Roles

| Role | Typical access |
|------|----------------|
| Super Admin | Platform-wide, all tenants |
| Company Owner | Full tenant access |
| Administrator | Most modules except destructive platform ops |
| Branch Manager | Branch sales, stock, staff |
| Cashier | POS, limited product/customer |
| Store / Warehouse Manager | Inventory, transfers |
| Accountant | Ledger, reports, payments |
| Pharmacist | Drug stock, dispensing |
| Doctor / Nurse / Receptionist | Clinical workflows |
| Laboratory Technician | Lab orders & results |
| Auditor | Read-only audit & reports |

## Creating users

1. Register company (self-service) or seed demo tenant.
2. Assign roles via `user_roles` (API extension / Prisma Studio).
3. Grant extra permissions via `user_permissions` (grant/deny).

## Security settings

- Force password policy (min 8, upper, lower, number).
- Enable 2FA for admins: Profile → setup 2FA API.
- Review login history: `GET /api/v1/auth/login-history`.
- Revoke sessions: `POST /api/v1/auth/logout-all`.
- IP blocking table: `blocked_ips`.

## Backups

```bash
export DATABASE_URL=...
./scripts/backup.sh
```

Restore:

```bash
gunzip -c backups/enterprise_ims_YYYYMMDD.sql.gz | psql $DATABASE_URL
```

## Company settings

`GET/PUT /api/v1/company` — profile, currency, locale, branding JSON.

Configure branches and warehouses under Settings UI or API.

## Monitoring

- Winston logs: `backend/logs/combined.log`, `error.log`
- PM2: `pm2 logs eims-api`
- Health: `GET /api/v1/health`
