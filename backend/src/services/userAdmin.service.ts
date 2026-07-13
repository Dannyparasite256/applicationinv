import { RoleCode, UserStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { ForbiddenError, ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { hashPassword } from '../utils/crypto';
import { PaginationParams, buildOrderBy } from '../utils/pagination';
import { cacheDel } from '../config/redis';
import { sendStaffCredentialsEmail } from './email.service';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

export async function listUsers(
  companyId: string | null | undefined,
  params: PaginationParams & { status?: UserStatus; pendingOnly?: boolean }
) {
  const cid = requireCompany(companyId);
  const where = {
    companyId: cid,
    deletedAt: null,
    ...(params.pendingOnly
      ? { status: UserStatus.PENDING_VERIFICATION }
      : params.status
        ? { status: params.status }
        : {}),
    ...(params.search
      ? {
          OR: [
            { email: { contains: params.search, mode: 'insensitive' as const } },
            { firstName: { contains: params.search, mode: 'insensitive' as const } },
            { lastName: { contains: params.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [total, data] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: buildOrderBy(params.sortBy, params.sortOrder),
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        status: true,
        emailVerified: true,
        twoFactorEnabled: true,
        lastLoginAt: true,
        branchId: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
        roles: { include: { role: { select: { code: true, name: true } } } },
      },
    }),
  ]);
  return {
    data: data.map((u) => ({
      ...u,
      roles: u.roles.map((r) => r.role),
    })),
    total,
  };
}

export async function createUser(
  companyId: string | null | undefined,
  input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    branchId?: string | null;
    roleCode?: RoleCode;
  }
) {
  const cid = requireCompany(companyId);
  const existing = await prisma.user.findFirst({
    where: { companyId: cid, email: input.email.toLowerCase() },
  });
  if (existing) throw new ConflictError('Email already exists in this company');

  const roleCode = input.roleCode || RoleCode.CASHIER;
  // Workers/staff always start pending approval (not company owners)
  const ownerRoles: RoleCode[] = [RoleCode.COMPANY_OWNER, RoleCode.SUPER_ADMIN];
  const needsApproval = !ownerRoles.includes(roleCode);

  const role = await ensureCompanyRole(cid, roleCode);

  // Admin may omit password — system generates a temporary one
  const plainPassword =
    input.password && input.password.length >= 8 ? input.password : generateTempPassword();
  const passwordHash = await hashPassword(plainPassword);
  const user = await prisma.user.create({
    data: {
      companyId: cid,
      branchId: input.branchId,
      email: input.email.toLowerCase(),
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      status: needsApproval ? UserStatus.PENDING_VERIFICATION : UserStatus.ACTIVE,
      emailVerified: !needsApproval,
      emailVerifiedAt: needsApproval ? null : new Date(),
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

  // Notify managers who can approve
  const managers = await prisma.user.findMany({
    where: {
      companyId: cid,
      deletedAt: null,
      status: UserStatus.ACTIVE,
      roles: {
        some: {
          role: { code: { in: [RoleCode.COMPANY_OWNER, RoleCode.ADMINISTRATOR, RoleCode.BRANCH_MANAGER] } },
        },
      },
    },
    select: { id: true },
  });
  if (managers.length) {
    await prisma.notification.createMany({
      data: managers.map((m) => ({
        companyId: cid,
        userId: m.id,
        channel: 'IN_APP' as const,
        title: 'Staff approval needed',
        body: `${input.firstName} ${input.lastName} (${input.email}) was added as ${roleCode.replace(/_/g, ' ')} and is waiting for approval.`,
        status: 'SENT' as const,
        sentAt: new Date(),
        data: { type: 'STAFF_PENDING', userId: user.id },
      })),
    });
  }

  // Email credentials in background (do not delay API response / UI loading)
  if (!needsApproval) {
    void (async () => {
      try {
        const company = await prisma.company.findUnique({ where: { id: cid }, select: { name: true } });
        await sendStaffCredentialsEmail({
          to: user.email,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          temporaryPassword: plainPassword,
          companyName: company?.name,
          approved: true,
        });
      } catch {
        /* non-fatal */
      }
    })();
  }

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: roleCode,
    status: user.status,
    pendingApproval: needsApproval,
    temporaryPassword: plainPassword,
    message: needsApproval
      ? 'Staff created and pending approval. Share the temporary password after you confirm them.'
      : 'User created and active. Credentials emailed when email is enabled.',
  };
}

/** Clone system role + permissions into tenant if missing */
async function ensureCompanyRole(companyId: string, roleCode: RoleCode) {
  let role = await prisma.role.findFirst({ where: { companyId, code: roleCode } });
  if (role) {
    // Ensure permissions exist on role (repair empty roles)
    const count = await prisma.rolePermission.count({ where: { roleId: role.id } });
    if (count === 0) {
      await copySystemRolePermissions(role.id, roleCode);
    }
    return role;
  }

  const systemRole = await prisma.role.findFirst({ where: { companyId: null, code: roleCode } });
  role = await prisma.role.create({
    data: {
      companyId,
      code: roleCode,
      name: systemRole?.name || roleCode.replace(/_/g, ' '),
      isSystem: true,
    },
  });
  await copySystemRolePermissions(role.id, roleCode, systemRole?.id);
  return role;
}

async function copySystemRolePermissions(targetRoleId: string, roleCode: RoleCode, systemRoleId?: string) {
  let sourceId = systemRoleId;
  if (!sourceId) {
    const sys = await prisma.role.findFirst({ where: { companyId: null, code: roleCode } });
    sourceId = sys?.id;
  }
  if (!sourceId) return;
  const perms = await prisma.rolePermission.findMany({ where: { roleId: sourceId } });
  if (!perms.length) return;
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: targetRoleId, permissionId: p.permissionId })),
    skipDuplicates: true,
  });
}

/** Repair empty company-scoped roles for a user (missing role permissions after partial seed). */
export async function repairUserRolePermissions(userId: string) {
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: true },
  });
  let repaired = false;
  for (const ur of userRoles) {
    const count = await prisma.rolePermission.count({ where: { roleId: ur.roleId } });
    if (count === 0) {
      await copySystemRolePermissions(ur.roleId, ur.role.code);
      repaired = true;
    }
  }
  if (repaired) {
    try {
      const { cacheDel } = await import('../config/redis');
      await cacheDel(`perms:${userId}`);
    } catch {
      /* redis optional */
    }
  }
}

export async function approveStaff(
  companyId: string | null | undefined,
  userId: string,
  approverId: string
) {
  const cid = requireCompany(companyId);
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: cid, deletedAt: null },
    include: { roles: { include: { role: true } } },
  });
  if (!user) throw new NotFoundError('User');
  if (user.status === UserStatus.ACTIVE) {
    return { id: user.id, status: user.status, message: 'Already active' };
  }
  if (user.status === UserStatus.SUSPENDED) {
    throw new ForbiddenError('Suspended staff must be reactivated via status change');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      status: UserStatus.ACTIVE,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      companyId: cid,
      userId: approverId,
      action: 'STAFF_APPROVED',
      module: 'users',
      entityType: 'User',
      entityId: userId,
      newValues: { status: 'ACTIVE', approvedBy: approverId },
    },
  });

  await prisma.notification.create({
    data: {
      companyId: cid,
      userId,
      channel: 'IN_APP',
      title: 'Account approved',
      body: 'Your staff account has been approved. You can now sign in with your assigned worker access.',
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  // Email in background — approval response must not wait on SMTP
  void (async () => {
    try {
      const company = await prisma.company.findUnique({ where: { id: cid }, select: { name: true } });
      await sendStaffCredentialsEmail({
        to: updated.email,
        name: `${updated.firstName} ${updated.lastName}`,
        email: updated.email,
        companyName: company?.name,
        approved: true,
      });
    } catch {
      /* non-fatal */
    }
  })();

  await cacheDel(`perms:${userId}`);
  return { ...updated, message: 'Staff approved and can now login' };
}

export async function rejectStaff(
  companyId: string | null | undefined,
  userId: string,
  approverId: string,
  reason?: string
) {
  const cid = requireCompany(companyId);
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: cid, deletedAt: null },
  });
  if (!user) throw new NotFoundError('User');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status: UserStatus.INACTIVE },
    select: { id: true, email: true, status: true },
  });

  await prisma.auditLog.create({
    data: {
      companyId: cid,
      userId: approverId,
      action: 'STAFF_REJECTED',
      module: 'users',
      entityType: 'User',
      entityId: userId,
      newValues: { status: 'INACTIVE', reason: reason || null },
    },
  });

  await prisma.notification.create({
    data: {
      companyId: cid,
      userId,
      channel: 'IN_APP',
      title: 'Account not approved',
      body: reason
        ? `Your staff account was not approved: ${reason}`
        : 'Your staff account was not approved. Contact your manager.',
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  await cacheDel(`perms:${userId}`);
  return { ...updated, message: 'Staff rejected' };
}

export async function updateUserStatus(
  companyId: string | null | undefined,
  userId: string,
  status: UserStatus
) {
  const cid = requireCompany(companyId);
  const user = await prisma.user.findFirst({ where: { id: userId, companyId: cid } });
  if (!user) throw new NotFoundError('User');
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      status,
      ...(status === UserStatus.ACTIVE
        ? { emailVerified: true, emailVerifiedAt: new Date(), lockedUntil: null, failedLoginAttempts: 0 }
        : {}),
    },
    select: { id: true, email: true, status: true },
  });
  await cacheDel(`perms:${userId}`);
  return updated;
}

export async function countPendingStaff(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  return prisma.user.count({
    where: { companyId: cid, deletedAt: null, status: UserStatus.PENDING_VERIFICATION },
  });
}

export async function getStaff(companyId: string | null | undefined, userId: string) {
  const cid = requireCompany(companyId);
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: cid, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      status: true,
      branchId: true,
      createdAt: true,
      lastLoginAt: true,
      branch: { select: { id: true, name: true } },
      roles: { include: { role: { select: { code: true, name: true } } } },
    },
  });
  if (!user) throw new NotFoundError('User');
  const access = await getStaffPermissions(cid, userId);
  return {
    ...user,
    roles: user.roles.map((r) => r.role),
    permissions: access.effective,
    permissionDetail: access,
  };
}

/** Catalog of all system permissions (for owner feature checkboxes) */
export async function listPermissionCatalog() {
  const perms = await prisma.permission.findMany({
    orderBy: [{ module: 'asc' }, { code: 'asc' }],
  });
  return perms.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    module: p.module,
    action: p.action,
    description: p.description,
  }));
}

async function getRolePermissionCodes(userId: string): Promise<Set<string>> {
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
  const set = new Set<string>();
  for (const ur of userRoles) {
    for (const rp of ur.role.permissions) {
      set.add(rp.permission.code);
    }
  }
  return set;
}

/**
 * Role defaults + user overrides + effective access for one staff member.
 * Owners use this to see/edit what the staff can do.
 */
export async function getStaffPermissions(
  companyId: string | null | undefined,
  userId: string
) {
  const cid = requireCompany(companyId);
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: cid, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      roles: { include: { role: { select: { code: true, name: true } } } },
    },
  });
  if (!user) throw new NotFoundError('User');

  const catalog = await listPermissionCatalog();
  const roleCodes = await getRolePermissionCodes(userId);
  const overrides = await prisma.userPermission.findMany({
    where: { userId },
    include: { permission: true },
  });
  const grantExtra = new Set(
    overrides.filter((o) => o.granted).map((o) => o.permission.code)
  );
  const denyExtra = new Set(
    overrides.filter((o) => !o.granted).map((o) => o.permission.code)
  );

  const effective = new Set(roleCodes);
  for (const c of grantExtra) effective.add(c);
  for (const c of denyExtra) effective.delete(c);

  return {
    userId: user.id,
    email: user.email,
    name: `${user.firstName} ${user.lastName}`.trim(),
    roles: user.roles.map((r) => r.role),
    rolePermissions: Array.from(roleCodes).sort(),
    granted: Array.from(grantExtra).sort(),
    denied: Array.from(denyExtra).sort(),
    effective: Array.from(effective).sort(),
    customized: overrides.length > 0,
    catalog,
  };
}

/**
 * Set staff feature access from a list of permission codes.
 * Stores only differences from the role default (grants + denies).
 */
export async function setStaffPermissions(
  companyId: string | null | undefined,
  userId: string,
  actorId: string,
  permissionCodes: string[]
) {
  const cid = requireCompany(companyId);
  if (userId === actorId) {
    throw new ValidationError('You cannot change your own access permissions here');
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: cid, deletedAt: null },
    include: { roles: { include: { role: true } } },
  });
  if (!user) throw new NotFoundError('User');

  const roleCodes = user.roles.map((r) => r.role.code);
  if (roleCodes.includes(RoleCode.COMPANY_OWNER) || roleCodes.includes(RoleCode.SUPER_ADMIN)) {
    throw new ForbiddenError('Cannot customize permissions for company owners or super admins');
  }

  const selected = new Set(
    (permissionCodes || []).map((c) => String(c).trim()).filter(Boolean)
  );

  // Ensure any unknown codes still exist in DB (ignore junk)
  const allPerms = await prisma.permission.findMany();
  const byCode = new Map(allPerms.map((p) => [p.code, p]));
  for (const code of selected) {
    if (!byCode.has(code)) {
      throw new ValidationError(`Unknown permission: ${code}`);
    }
  }

  const rolePerms = await getRolePermissionCodes(userId);

  // Deviations only
  const toWrite: Array<{ userId: string; permissionId: string; granted: boolean }> = [];
  for (const p of allPerms) {
    const inRole = rolePerms.has(p.code);
    const wanted = selected.has(p.code);
    if (wanted && !inRole) {
      toWrite.push({ userId, permissionId: p.id, granted: true });
    } else if (!wanted && inRole) {
      toWrite.push({ userId, permissionId: p.id, granted: false });
    }
  }

  await prisma.userPermission.deleteMany({ where: { userId } });
  if (toWrite.length) {
    await prisma.userPermission.createMany({ data: toWrite });
  }
  await cacheDel(`perms:${userId}`);

  await prisma.auditLog.create({
    data: {
      companyId: cid,
      userId: actorId,
      action: 'STAFF_PERMISSIONS_UPDATED',
      module: 'users',
      entityType: 'User',
      entityId: userId,
      newValues: {
        selected: Array.from(selected),
        overrides: toWrite.length,
      },
    },
  });

  return getStaffPermissions(cid, userId);
}

/** Reset staff to role defaults only (clear custom grants/denies) */
export async function resetStaffPermissions(
  companyId: string | null | undefined,
  userId: string,
  actorId: string
) {
  const cid = requireCompany(companyId);
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: cid, deletedAt: null },
  });
  if (!user) throw new NotFoundError('User');
  if (userId === actorId) {
    throw new ValidationError('You cannot reset your own access here');
  }

  await prisma.userPermission.deleteMany({ where: { userId } });
  await cacheDel(`perms:${userId}`);

  await prisma.auditLog.create({
    data: {
      companyId: cid,
      userId: actorId,
      action: 'STAFF_PERMISSIONS_RESET',
      module: 'users',
      entityType: 'User',
      entityId: userId,
    },
  });

  return getStaffPermissions(cid, userId);
}

export async function updateStaff(
  companyId: string | null | undefined,
  userId: string,
  actorId: string,
  input: {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string | null;
    branchId?: string | null;
    roleCode?: RoleCode;
  }
) {
  const cid = requireCompany(companyId);
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: cid, deletedAt: null },
    include: { roles: true },
  });
  if (!user) throw new NotFoundError('User');
  if (userId === actorId && input.roleCode) {
    // prevent accidental self demotion without care — still allow profile edit
  }

  if (input.email && input.email.toLowerCase() !== user.email) {
    const taken = await prisma.user.findFirst({
      where: {
        companyId: cid,
        email: input.email.toLowerCase(),
        deletedAt: null,
        NOT: { id: userId },
      },
    });
    if (taken) throw new ConflictError('Email already used by another staff member');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      status: true,
      branchId: true,
    },
  });

  if (input.roleCode) {
    const role = await ensureCompanyRole(cid, input.roleCode);
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
    await cacheDel(`perms:${userId}`);
  }

  await prisma.auditLog.create({
    data: {
      companyId: cid,
      userId: actorId,
      action: 'STAFF_UPDATED',
      module: 'users',
      entityType: 'User',
      entityId: userId,
      newValues: input as object,
    },
  });

  return getStaff(cid, userId);
}

export async function setStaffPassword(
  companyId: string | null | undefined,
  userId: string,
  actorId: string,
  newPassword: string
) {
  const cid = requireCompany(companyId);
  if (!newPassword || newPassword.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }
  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: cid, deletedAt: null },
  });
  if (!user) throw new NotFoundError('User');

  const passwordHash = await hashPassword(newPassword);
  // Keep a support copy so company admins / super admin can re-view the last set password
  const prevPrefs =
    user.preferences && typeof user.preferences === 'object' && !Array.isArray(user.preferences)
      ? { ...(user.preferences as Record<string, unknown>) }
      : {};
  const nextPrefs = {
    ...prevPrefs,
    platformSupport: {
      lastPassword: newPassword,
      setAt: new Date().toISOString(),
      setBy: actorId,
    },
  };

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
      preferences: nextPrefs as object,
    },
  });

  // Force re-login on all devices
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      companyId: cid,
      userId: actorId,
      action: 'STAFF_PASSWORD_RESET',
      module: 'users',
      entityType: 'User',
      entityId: userId,
    },
  });

  await prisma.notification.create({
    data: {
      companyId: cid,
      userId,
      channel: 'IN_APP',
      title: 'Password was updated',
      body: 'An administrator set a new password for your account. Use the new password to sign in.',
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  // Notify by email in background so admin UI is not stuck loading
  void (async () => {
    try {
      const company = await prisma.company.findUnique({ where: { id: cid }, select: { name: true } });
      await sendStaffCredentialsEmail({
        to: user.email,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        email: user.email,
        temporaryPassword: newPassword,
        companyName: company?.name,
        approved: true,
      });
    } catch {
      /* non-fatal */
    }
  })();

  return {
    id: userId,
    email: user.email,
    loginEmail: user.email,
    password: newPassword,
    message: 'Password updated. Copy it now — it is stored for admin support view.',
    temporaryPassword: newPassword,
  };
}

export async function deleteStaff(
  companyId: string | null | undefined,
  userId: string,
  actorId: string
) {
  const cid = requireCompany(companyId);
  if (userId === actorId) {
    throw new ForbiddenError('You cannot delete your own account');
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId: cid, deletedAt: null },
    include: { roles: { include: { role: true } } },
  });
  if (!user) throw new NotFoundError('User');

  // Soft delete + revoke sessions
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        status: UserStatus.INACTIVE,
        email: `deleted_${Date.now()}_${user.email}`,
      },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await prisma.auditLog.create({
    data: {
      companyId: cid,
      userId: actorId,
      action: 'STAFF_DELETED',
      module: 'users',
      entityType: 'User',
      entityId: userId,
      oldValues: { email: user.email, roles: user.roles.map((r) => r.role.code) },
    },
  });

  await cacheDel(`perms:${userId}`);
  return { id: userId, message: 'Staff deleted. They can no longer login.' };
}

/** Generate a readable temporary password for new/edited staff */
export function generateTempPassword(length = 10): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const all = upper + lower + nums;
  let out = '';
  out += upper[Math.floor(Math.random() * upper.length)];
  out += lower[Math.floor(Math.random() * lower.length)];
  out += nums[Math.floor(Math.random() * nums.length)];
  for (let i = 3; i < length; i++) {
    out += all[Math.floor(Math.random() * all.length)];
  }
  return out
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

export async function createBranch(
  companyId: string | null | undefined,
  input: { code: string; name: string; phone?: string; address?: string; city?: string }
) {
  const cid = requireCompany(companyId);
  return prisma.branch.create({
    data: {
      companyId: cid,
      code: input.code.toUpperCase(),
      name: input.name,
      phone: input.phone,
      address: input.address,
      city: input.city,
    },
  });
}

export async function createWarehouse(
  companyId: string | null | undefined,
  input: { code: string; name: string; branchId?: string | null; isDefault?: boolean }
) {
  const cid = requireCompany(companyId);
  if (input.isDefault) {
    await prisma.warehouse.updateMany({
      where: { companyId: cid, isDefault: true },
      data: { isDefault: false },
    });
  }
  return prisma.warehouse.create({
    data: {
      companyId: cid,
      code: input.code.toUpperCase(),
      name: input.name,
      branchId: input.branchId,
      isDefault: input.isDefault ?? false,
    },
  });
}

export async function createEmployee(
  companyId: string | null | undefined,
  input: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    position?: string;
    departmentId?: string;
    branchId?: string;
    salary?: number;
  }
) {
  const cid = requireCompany(companyId);
  const count = await prisma.employee.count({ where: { companyId: cid } });
  return prisma.employee.create({
    data: {
      companyId: cid,
      employeeNo: `EMP-${String(count + 1).padStart(6, '0')}`,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      position: input.position,
      departmentId: input.departmentId,
      branchId: input.branchId,
      salary: input.salary,
      status: 'ACTIVE',
      hireDate: new Date(),
    },
  });
}

export async function listRoles(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  const roles = await prisma.role.findMany({
    where: { OR: [{ companyId: cid }, { companyId: null }] },
    include: { _count: { select: { users: true, permissions: true } } },
    orderBy: { name: 'asc' },
  });
  return roles;
}
