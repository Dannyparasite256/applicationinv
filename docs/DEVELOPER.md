# Developer Guide

## Architecture

Clean layered design:

```
Routes → Middleware (auth, validate, audit) → Controllers → Services → Prisma
```

- **Controllers**: HTTP only, call services, return standard envelopes.
- **Services**: Business rules, transactions, multi-tenant scoping.
- **Validators**: Zod schemas for body/query/params.
- **Middleware**: JWT, RBAC, tenant, rate limit, audit.

## Adding a module

1. Extend `prisma/schema.prisma` with models (always include `companyId` for tenant data).
2. `npx prisma migrate dev --name add_module_x`
3. Create `validators/x.validator.ts`, `services/x.service.ts`, `controllers/x.controller.ts`.
4. Register routes in `routes/index.ts` with `authenticate`, `requireTenant`, `requirePermissions`.
5. Add permission codes to seed `PERMISSIONS` array.
6. Add frontend page + sidebar entry.

## Response format

```json
{
  "success": true,
  "message": "Success",
  "data": {},
  "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
}
```

Errors:

```json
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": []
}
```

## Tenant rules

- Never query tenant tables without `companyId` filter.
- Soft deletes: filter `deletedAt: null`.
- Super admin: optional header `X-Company-Id`.

## Testing

Unit tests live in `backend/src/__tests__` (Vitest).

```bash
cd backend && npm test
```

Integration tests can use Supertest against `createApp()` with a test database.

## Frontend conventions

- API client: `src/lib/api.ts` (Axios + token refresh).
- Auth state: Zustand persist `eims-auth`.
- Server state: React Query.
- Forms: React Hook Form + Zod.
- POS offline: `posStore.offlineQueue` + PWA cache.

## Path aliases

Backend: `@/*` → `src/*` (tsconfig; use relative imports if tsc-alias not run).  
Frontend: `@/*` → `src/*` (Vite).
