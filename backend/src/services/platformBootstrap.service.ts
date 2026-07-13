/**
 * Ensures platform essentials exist after migrate-only deploys (e.g. Render free tier
 * that never ran `db:seed`). Safe to run on every boot — only creates missing rows.
 */
import { RoleCode, UserStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { hashPassword } from '../utils/crypto';
import { logger } from '../utils/logger';

const CORE_PERMISSIONS = [
  { module: 'inventory', action: 'products.read', code: 'inventory.products.read', name: 'View products' },
  { module: 'inventory', action: 'products.create', code: 'inventory.products.create', name: 'Create products' },
  { module: 'inventory', action: 'products.update', code: 'inventory.products.update', name: 'Update products' },
  { module: 'inventory', action: 'products.delete', code: 'inventory.products.delete', name: 'Delete products' },
  { module: 'inventory', action: 'stock.adjust', code: 'inventory.stock.adjust', name: 'Adjust stock' },
  { module: 'inventory', action: 'stock.transfer', code: 'inventory.stock.transfer', name: 'Transfer stock' },
  { module: 'sales', action: 'read', code: 'sales.read', name: 'View sales' },
  { module: 'sales', action: 'create', code: 'sales.create', name: 'Create sales' },
  { module: 'pos', action: 'access', code: 'pos.access', name: 'Access POS' },
  { module: 'purchases', action: 'read', code: 'purchases.read', name: 'View purchases' },
  { module: 'purchases', action: 'create', code: 'purchases.create', name: 'Create purchases' },
  { module: 'purchases', action: 'update', code: 'purchases.update', name: 'Update purchases' },
  { module: 'crm', action: 'customers.read', code: 'crm.customers.read', name: 'View customers' },
  { module: 'crm', action: 'customers.create', code: 'crm.customers.create', name: 'Create customers' },
  { module: 'accounting', action: 'read', code: 'accounting.read', name: 'View accounting' },
  { module: 'accounting', action: 'write', code: 'accounting.write', name: 'Manage accounting' },
  { module: 'hospital', action: 'patients.read', code: 'hospital.patients.read', name: 'View patients' },
  { module: 'hospital', action: 'patients.create', code: 'hospital.patients.create', name: 'Register patients' },
  { module: 'hospital', action: 'appointments.create', code: 'hospital.appointments.create', name: 'Create appointments' },
  { module: 'pharmacy', action: 'dispense', code: 'pharmacy.dispense', name: 'Dispense prescriptions' },
  { module: 'laboratory', action: 'read', code: 'laboratory.read', name: 'View lab orders' },
  { module: 'laboratory', action: 'create', code: 'laboratory.create', name: 'Create lab orders' },
  { module: 'hr', action: 'employees.read', code: 'hr.employees.read', name: 'View employees' },
  { module: 'settings', action: 'company', code: 'settings.company', name: 'Manage company settings' },
  { module: 'reports', action: 'read', code: 'reports.read', name: 'View reports' },
  { module: 'users', action: 'manage', code: 'users.manage', name: 'Manage users' },
];

export async function ensurePlatformBootstrap(): Promise<void> {
  try {
    for (const p of CORE_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { code: p.code },
        create: p,
        update: { name: p.name },
      });
    }

    let superRole = await prisma.role.findFirst({
      where: { code: RoleCode.SUPER_ADMIN, companyId: null },
    });
    if (!superRole) {
      superRole = await prisma.role.create({
        data: {
          code: RoleCode.SUPER_ADMIN,
          name: 'Super Admin',
          isSystem: true,
          companyId: null,
        },
      });
    }

    const allPerms = await prisma.permission.findMany();
    for (const perm of allPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: superRole.id, permissionId: perm.id } },
        create: { roleId: superRole.id, permissionId: perm.id },
        update: {},
      });
    }

    // Minimal system worker roles so tenant staff get defaults without full seed
    const workerRoleMap: Record<string, string[]> = {
      COMPANY_OWNER: allPerms.map((p) => p.code),
      ADMINISTRATOR: allPerms.map((p) => p.code),
      BRANCH_MANAGER: [
        'pos.access', 'sales.read', 'sales.create', 'inventory.products.read', 'inventory.products.create',
        'inventory.products.update', 'inventory.stock.adjust', 'inventory.stock.transfer',
        'crm.customers.read', 'crm.customers.create', 'purchases.read', 'purchases.create', 'purchases.update',
        'reports.read', 'hr.employees.read', 'users.manage',
      ],
      CASHIER: ['pos.access', 'sales.read', 'inventory.products.read', 'crm.customers.read', 'crm.customers.create'],
      STORE_MANAGER: [
        'pos.access', 'sales.read', 'sales.create', 'inventory.products.read', 'inventory.products.create',
        'inventory.products.update', 'inventory.stock.adjust', 'crm.customers.read', 'crm.customers.create', 'reports.read',
      ],
      WAREHOUSE_MANAGER: [
        'inventory.products.read', 'inventory.products.update', 'inventory.stock.adjust', 'inventory.stock.transfer',
        'purchases.read', 'purchases.update',
      ],
      ACCOUNTANT: [
        'accounting.read', 'accounting.write', 'sales.read', 'purchases.read', 'reports.read', 'crm.customers.read',
      ],
      SALES_PERSON: [
        'pos.access', 'sales.read', 'sales.create', 'inventory.products.read', 'crm.customers.read', 'crm.customers.create',
      ],
      PROCUREMENT_OFFICER: [
        'purchases.read', 'purchases.create', 'purchases.update', 'inventory.products.read', 'crm.customers.read',
      ],
      PHARMACIST: [
        'pharmacy.dispense', 'inventory.products.read', 'inventory.stock.adjust', 'pos.access', 'sales.read',
        'crm.customers.read',
      ],
      DOCTOR: ['hospital.patients.read', 'hospital.patients.create', 'hospital.appointments.create', 'pharmacy.dispense'],
      NURSE: ['hospital.patients.read', 'hospital.patients.create', 'hospital.appointments.create'],
      RECEPTIONIST: [
        'hospital.patients.read', 'hospital.patients.create', 'hospital.appointments.create', 'crm.customers.read',
        'crm.customers.create',
      ],
      LABORATORY_TECHNICIAN: ['laboratory.read', 'laboratory.create', 'hospital.patients.read'],
    };

    for (const [code, permCodes] of Object.entries(workerRoleMap)) {
      let role = await prisma.role.findFirst({
        where: { companyId: null, code: code as RoleCode },
      });
      if (!role) {
        role = await prisma.role.create({
          data: {
            code: code as RoleCode,
            name: code.replace(/_/g, ' '),
            isSystem: true,
            companyId: null,
          },
        });
      }
      const count = await prisma.rolePermission.count({ where: { roleId: role.id } });
      if (count > 0) continue;
      for (const pCode of permCodes) {
        const perm = allPerms.find((p) => p.code === pCode);
        if (!perm) continue;
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
          create: { roleId: role.id, permissionId: perm.id },
          update: {},
        });
      }
    }

    // Platform shell company (superadmin is tenant-attached for multi-tenant model)
    let platform = await prisma.company.findUnique({ where: { slug: 'platform' } });
    if (!platform) {
      platform = await prisma.company.create({
        data: {
          name: 'Platform',
          slug: 'platform',
          email: 'platform@enterprise-ims.local',
          status: 'ACTIVE',
          currency: 'USD',
        },
      });
      await prisma.branch.create({
        data: {
          companyId: platform.id,
          code: 'HQ',
          name: 'Platform HQ',
          isHeadOffice: true,
        },
      });
    }

    const email = (
      process.env.SUPERADMIN_EMAIL ||
      process.env.SEED_SUPERADMIN_EMAIL ||
      'superadmin@ims.local'
    ).toLowerCase();
    const plainPassword =
      process.env.SUPERADMIN_PASSWORD ||
      process.env.SEED_PASSWORD ||
      process.env.SEED_ADMIN_PASSWORD;
    const forceReset = process.env.SUPERADMIN_FORCE_RESET === 'true';

    const existingSuper = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        roles: { some: { role: { code: RoleCode.SUPER_ADMIN } } },
      },
    });

    if (existingSuper && !forceReset) {
      logger.info('Platform bootstrap: super admin already exists', { email: existingSuper.email });
      return;
    }

    if (!plainPassword || plainPassword.length < 8) {
      logger.warn(
        'Platform bootstrap: skip super admin create/reset — set SUPERADMIN_PASSWORD or SEED_PASSWORD in env (min 8 chars)'
      );
      return;
    }

    const passwordHash = await hashPassword(plainPassword);
    const branch = await prisma.branch.findFirst({
      where: { companyId: platform.id, isHeadOffice: true },
    });

    if (existingSuper && forceReset) {
      await prisma.user.update({
        where: { id: existingSuper.id },
        data: {
          passwordHash,
          status: UserStatus.ACTIVE,
          emailVerified: true,
          emailVerifiedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      logger.info('Platform bootstrap: super admin password reset via SUPERADMIN_FORCE_RESET', {
        email: existingSuper.email,
      });
      return;
    }

    // Prefer email under platform company
    const user = await prisma.user.upsert({
      where: { companyId_email: { companyId: platform.id, email } },
      create: {
        companyId: platform.id,
        branchId: branch?.id,
        email,
        passwordHash,
        firstName: 'Super',
        lastName: 'Admin',
        status: UserStatus.ACTIVE,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
      update: {
        passwordHash,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: superRole.id } },
      create: { userId: user.id, roleId: superRole.id },
      update: {},
    });

    logger.info('Platform bootstrap: super admin ready', {
      email,
      hint: 'Password from SUPERADMIN_PASSWORD / SEED_PASSWORD (never logged)',
    });
  } catch (err) {
    logger.error('Platform bootstrap failed (non-fatal)', {
      err: err instanceof Error ? err.message : err,
    });
  }
}
