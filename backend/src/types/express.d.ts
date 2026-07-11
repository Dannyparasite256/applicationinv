import { RoleCode } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  companyId: string | null;
  branchId: string | null;
  firstName: string;
  lastName: string;
  roles: RoleCode[];
  permissions: string[];
  isSuperAdmin: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      companyId?: string | null;
      requestId?: string;
    }
  }
}

export {};
