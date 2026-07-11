import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { RoleCode } from '@prisma/client';
import { env } from '../config/env';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';
import { AuthUser } from '../types/express';
import { prisma } from '../config/database';
import { cacheGet, cacheSet } from '../config/redis';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  companyId: string | null;
  branchId: string | null;
  roles: RoleCode[];
  permissions: string[];
  type: 'access';
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const token = header.slice(7);
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;

    if (payload.type !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }

    const user: AuthUser = {
      id: payload.sub,
      email: payload.email,
      companyId: payload.companyId,
      branchId: payload.branchId,
      firstName: '',
      lastName: '',
      roles: payload.roles || [],
      permissions: payload.permissions || [],
      isSuperAdmin: (payload.roles || []).includes(RoleCode.SUPER_ADMIN),
    };

    req.user = user;
    req.companyId = user.companyId;
    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
      return;
    }
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }
  authenticate(req, _res, next);
}

/** Require one of the given roles */
export function requireRoles(...roles: RoleCode[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (req.user.isSuperAdmin) {
      next();
      return;
    }
    const hasRole = roles.some((r) => req.user!.roles.includes(r));
    if (!hasRole) {
      next(new ForbiddenError('Insufficient role privileges'));
      return;
    }
    next();
  };
}

function userHasPermission(user: NonNullable<Request['user']>, code: string): boolean {
  return (
    user.permissions.includes(code) ||
    user.permissions.includes(code.replace(/\.[^.]+$/, '.*')) ||
    user.permissions.includes('*')
  );
}

/** Require ALL permission code(s) e.g. inventory.products.create */
export function requirePermissions(...permissionCodes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (req.user.isSuperAdmin) {
      next();
      return;
    }
    // Company owners get broad access within tenant
    if (req.user.roles.includes(RoleCode.COMPANY_OWNER) || req.user.roles.includes(RoleCode.ADMINISTRATOR)) {
      next();
      return;
    }
    const hasAll = permissionCodes.every((p) => userHasPermission(req.user!, p));
    if (!hasAll) {
      next(new ForbiddenError(`Missing permission: ${permissionCodes.join(', ')}`));
      return;
    }
    next();
  };
}

/** Require ANY of the given permission codes (OR) — e.g. print with sales.read OR pos.access */
export function requireAnyPermission(...permissionCodes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (req.user.isSuperAdmin) {
      next();
      return;
    }
    if (req.user.roles.includes(RoleCode.COMPANY_OWNER) || req.user.roles.includes(RoleCode.ADMINISTRATOR)) {
      next();
      return;
    }
    const hasAny = permissionCodes.some((p) => userHasPermission(req.user!, p));
    if (!hasAny) {
      next(new ForbiddenError(`Missing permission: ${permissionCodes.join(' or ')}`));
      return;
    }
    next();
  };
}

/**
 * Refund / void / delete sales — managers only.
 * Staff (cashier, sales person, etc.) may record sales but cannot reverse them.
 */
const SALES_ADMIN_ROLES: RoleCode[] = [
  RoleCode.SUPER_ADMIN,
  RoleCode.COMPANY_OWNER,
  RoleCode.ADMINISTRATOR,
  RoleCode.BRANCH_MANAGER,
  RoleCode.STORE_MANAGER,
];

export function requireSalesAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new UnauthorizedError());
    return;
  }
  if (req.user.isSuperAdmin) {
    next();
    return;
  }
  const roles = req.user.roles || [];
  if (roles.some((r) => SALES_ADMIN_ROLES.includes(r as RoleCode))) {
    next();
    return;
  }
  // Explicit permission grant (if assigned later via admin tools)
  const perms = req.user.permissions || [];
  if (
    perms.includes('sales.refund') ||
    perms.includes('sales.delete') ||
    perms.includes('sales.void') ||
    perms.includes('*')
  ) {
    next();
    return;
  }
  next(
    new ForbiddenError(
      'Only managers can refund or delete sales. Ask your manager if a sale needs to be reversed.'
    )
  );
}

/** Ensure tenant isolation — user can only access their company data */
export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new UnauthorizedError());
    return;
  }
  if (req.user.isSuperAdmin) {
    // Super admin may pass X-Company-Id to act on behalf of a tenant
    const headerCompany = req.headers['x-company-id'] as string | undefined;
    if (headerCompany) {
      req.companyId = headerCompany;
    }
    next();
    return;
  }
  if (!req.user.companyId) {
    next(new ForbiddenError('No company associated with user'));
    return;
  }
  req.companyId = req.user.companyId;
  next();
}

export async function loadUserPermissions(userId: string): Promise<string[]> {
  const cacheKey = `perms:${userId}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return JSON.parse(cached) as string[];

  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });

  const userPerms = await prisma.userPermission.findMany({
    where: { userId },
    include: { permission: true },
  });

  const set = new Set<string>();
  for (const ur of userRoles) {
    for (const rp of ur.role.permissions) {
      set.add(rp.permission.code);
    }
  }
  for (const up of userPerms) {
    if (up.granted) set.add(up.permission.code);
    else set.delete(up.permission.code);
  }

  const list = Array.from(set);
  await cacheSet(cacheKey, JSON.stringify(list), 300);
  return list;
}
