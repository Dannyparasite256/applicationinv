import { CompanyStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { PaginationParams, buildOrderBy } from '../utils/pagination';
import { startOfDay, subDays, format } from 'date-fns';
import { hashPassword } from '../utils/crypto';
import { generateTempPassword } from './userAdmin.service';
import { sendStaffCredentialsEmail } from './email.service';

function assertSuperAdmin(isSuperAdmin?: boolean) {
  if (!isSuperAdmin) throw new ForbiddenError('Super Admin access required');
}

type UserPrefs = {
  platformSupport?: {
    lastPassword?: string;
    setAt?: string;
    setBy?: string;
  };
  [key: string]: unknown;
};

function readPrefs(raw: unknown): UserPrefs {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as UserPrefs;
  return {};
}

export async function getPlatformOverview(isSuperAdmin?: boolean) {
  assertSuperAdmin(isSuperAdmin);
  const now = new Date();
  const day30 = subDays(now, 30);
  const day7 = subDays(now, 7);

  const [
    totalCompanies,
    activeCompanies,
    trialCompanies,
    suspendedCompanies,
    totalUsers,
    totalProducts,
    totalSales,
    salesAgg,
    recentCompanies,
    statusBreakdown,
  ] = await Promise.all([
    prisma.company.count({ where: { deletedAt: null } }),
    prisma.company.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    prisma.company.count({ where: { deletedAt: null, status: 'TRIAL' } }),
    prisma.company.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.product.count({ where: { deletedAt: null } }),
    prisma.sale.count({ where: { deletedAt: null, status: { not: 'CANCELLED' } } }),
    prisma.sale.aggregate({
      where: { deletedAt: null, status: { not: 'CANCELLED' }, saleDate: { gte: day30 } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.company.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        email: true,
        createdAt: true,
        trialEndsAt: true,
        _count: { select: { users: true, products: true, sales: true } },
      },
    }),
    prisma.company.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: true,
    }),
  ]);

  // Registration trend last 14 days
  const registrationTrend: Array<{ date: string; count: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = subDays(now, i);
    const from = startOfDay(d);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const count = await prisma.company.count({
      where: { deletedAt: null, createdAt: { gte: from, lt: to } },
    });
    registrationTrend.push({ date: format(d, 'MMM dd'), count });
  }

  const newThisWeek = await prisma.company.count({
    where: { deletedAt: null, createdAt: { gte: day7 } },
  });
  const newThisMonth = await prisma.company.count({
    where: { deletedAt: null, createdAt: { gte: day30 } },
  });

  return {
    kpis: {
      totalCompanies,
      activeCompanies,
      trialCompanies,
      suspendedCompanies,
      totalUsers,
      totalProducts,
      totalSales,
      gmv30d: Number(salesAgg._sum.total || 0),
      salesCount30d: salesAgg._count,
      newThisWeek,
      newThisMonth,
    },
    statusBreakdown: statusBreakdown.map((s) => ({
      status: s.status,
      count: s._count,
    })),
    registrationTrend,
    recentCompanies,
  };
}

export async function listCompanies(
  isSuperAdmin: boolean | undefined,
  params: PaginationParams & { status?: CompanyStatus; from?: Date; to?: Date }
) {
  assertSuperAdmin(isSuperAdmin);

  const where: Prisma.CompanyWhereInput = {
    deletedAt: null,
    ...(params.status ? { status: params.status } : {}),
    ...(params.from || params.to
      ? {
          createdAt: {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to ? { lte: params.to } : {}),
          },
        }
      : {}),
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: 'insensitive' } },
            { slug: { contains: params.search, mode: 'insensitive' } },
            { email: { contains: params.search, mode: 'insensitive' } },
            { phone: { contains: params.search, mode: 'insensitive' } },
            { city: { contains: params.search, mode: 'insensitive' } },
            { country: { contains: params.search, mode: 'insensitive' } },
            { address: { contains: params.search, mode: 'insensitive' } },
            {
              users: {
                some: {
                  deletedAt: null,
                  OR: [
                    { email: { contains: params.search, mode: 'insensitive' } },
                    { firstName: { contains: params.search, mode: 'insensitive' } },
                    { lastName: { contains: params.search, mode: 'insensitive' } },
                    { phone: { contains: params.search, mode: 'insensitive' } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };

  const [total, companies] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: buildOrderBy(params.sortBy || 'createdAt', params.sortOrder),
      include: {
        _count: {
          select: {
            users: true,
            products: true,
            sales: true,
            customers: true,
            branches: true,
            warehouses: true,
          },
        },
      },
    }),
  ]);

  // Attach sales volume for period (30d) per company
  const companyIds = companies.map((c) => c.id);
  const day30 = subDays(new Date(), 30);
  const salesByCompany =
    companyIds.length === 0
      ? []
      : await prisma.sale.groupBy({
          by: ['companyId'],
          where: {
            companyId: { in: companyIds },
            deletedAt: null,
            status: { notIn: ['CANCELLED', 'RETURNED'] },
            paymentStatus: { notIn: ['REFUNDED', 'VOID'] },
            saleDate: { gte: day30 },
          },
          _sum: { total: true },
          _count: true,
        });
  const salesMap = new Map(
    salesByCompany.map((s) => [
      s.companyId,
      { revenue30d: Number(s._sum.total || 0), sales30d: s._count },
    ])
  );

  const lastLogins =
    companyIds.length === 0
      ? []
      : await prisma.user.groupBy({
          by: ['companyId'],
          where: { companyId: { in: companyIds }, lastLoginAt: { not: null } },
          _max: { lastLoginAt: true },
        });
  const loginMap = new Map(lastLogins.map((l) => [l.companyId, l._max.lastLoginAt]));

  // Primary owners / admins so super admin can contact each business
  const ownerUsers =
    companyIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: {
            companyId: { in: companyIds },
            deletedAt: null,
            roles: {
              some: {
                role: { code: { in: ['COMPANY_OWNER', 'ADMINISTRATOR'] } },
              },
            },
          },
          select: {
            id: true,
            companyId: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            status: true,
            lastLoginAt: true,
            roles: { include: { role: { select: { code: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        });

  const ownersByCompany = new Map<
    string,
    Array<{
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      status: string;
      lastLoginAt: Date | null;
      role: string;
    }>
  >();
  for (const u of ownerUsers) {
    if (!u.companyId) continue;
    const list = ownersByCompany.get(u.companyId) || [];
    const roleCode =
      u.roles.find((r) => r.role.code === 'COMPANY_OWNER')?.role.code ||
      u.roles[0]?.role.code ||
      'ADMINISTRATOR';
    list.push({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      role: roleCode,
    });
    ownersByCompany.set(u.companyId, list);
  }

  const data = companies.map((c) => {
    const owners = ownersByCompany.get(c.id) || [];
    const primaryOwner = owners.find((o) => o.role === 'COMPANY_OWNER') || owners[0] || null;
    return {
      ...c,
      owners,
      primaryOwner,
      metrics: {
        ...(salesMap.get(c.id) || { revenue30d: 0, sales30d: 0 }),
        lastActivityAt: loginMap.get(c.id) || c.updatedAt,
      },
    };
  });

  return { data, total };
}

export async function getCompanyDetail(isSuperAdmin: boolean | undefined, companyId: string) {
  assertSuperAdmin(isSuperAdmin);

  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    include: {
      branches: { where: { deletedAt: null }, orderBy: { name: 'asc' } },
      warehouses: { where: { deletedAt: null } },
      taxes: true,
      _count: {
        select: {
          users: true,
          products: true,
          sales: true,
          customers: true,
          suppliers: true,
          invoices: true,
          purchases: true,
          patients: true,
          employees: true,
          auditLogs: true,
        },
      },
    },
  });
  if (!company) throw new NotFoundError('Company');

  const day30 = subDays(new Date(), 30);
  const [sales30, salesAll, topProducts, recentSales, users, owners, auditLogs, inventoryValue] =
    await Promise.all([
      prisma.sale.aggregate({
        where: {
          companyId,
          deletedAt: null,
          status: { not: 'CANCELLED' },
          saleDate: { gte: day30 },
        },
        _sum: { total: true, taxAmount: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { companyId, deletedAt: null, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.saleItem.groupBy({
        by: ['productName'],
        where: {
          sale: { companyId, saleDate: { gte: day30 }, deletedAt: null },
        },
        _sum: { total: true, quantity: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
      prisma.sale.findMany({
        where: { companyId, deletedAt: null },
        orderBy: { saleDate: 'desc' },
        take: 10,
        include: {
          cashier: { select: { firstName: true, lastName: true, email: true } },
          customer: { select: { firstName: true, lastName: true, businessName: true } },
        },
      }),
      prisma.user.findMany({
        where: { companyId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          status: true,
          lastLoginAt: true,
          lastLoginIp: true,
          createdAt: true,
          twoFactorEnabled: true,
          preferences: true,
          roles: { include: { role: { select: { code: true, name: true } } } },
        },
      }),
      prisma.user.findMany({
        where: {
          companyId,
          deletedAt: null,
          roles: { some: { role: { code: { in: ['COMPANY_OWNER', 'ADMINISTRATOR', 'SUPER_ADMIN'] } } } },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          status: true,
          lastLoginAt: true,
        },
        take: 10,
      }),
      prisma.auditLog.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
        },
      }),
      prisma.stockLevel.findMany({
        where: { product: { companyId, deletedAt: null } },
        include: { product: { select: { costPrice: true } } },
      }),
    ]);

  const invValue = inventoryValue.reduce(
    (s, r) => s + Number(r.quantity) * Number(r.product.costPrice),
    0
  );

  // Daily sales last 14 days for this company
  const salesTrend: Array<{ date: string; sales: number; count: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = subDays(new Date(), i);
    const from = startOfDay(d);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const agg = await prisma.sale.aggregate({
      where: {
        companyId,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        saleDate: { gte: from, lt: to },
      },
      _sum: { total: true },
      _count: true,
    });
    salesTrend.push({
      date: format(d, 'MMM dd'),
      sales: Number(agg._sum.total || 0),
      count: agg._count,
    });
  }

  return {
    company,
    metrics: {
      revenue30d: Number(sales30._sum.total || 0),
      tax30d: Number(sales30._sum.taxAmount || 0),
      salesCount30d: sales30._count,
      revenueAllTime: Number(salesAll._sum.total || 0),
      salesCountAllTime: salesAll._count,
      inventoryValue: invValue,
      users: company._count.users,
      products: company._count.products,
      customers: company._count.customers,
      branches: company.branches.length,
    },
    salesTrend,
    topProducts: topProducts.map((p) => ({
      name: p.productName,
      revenue: Number(p._sum.total || 0),
      quantity: Number(p._sum.quantity || 0),
    })),
    recentSales,
    users: users.map((u) => {
      const prefs = readPrefs(u.preferences);
      const support = prefs.platformSupport || {};
      const { preferences: _p, ...rest } = u;
      return {
        ...rest,
        roles: u.roles.map((r) => r.role),
        loginEmail: u.email,
        /** Last password set by super admin (if any). Original registration passwords are hashed and cannot be recovered. */
        knownPassword: support.lastPassword || null,
        passwordSetAt: support.setAt || null,
        hasKnownPassword: Boolean(support.lastPassword),
      };
    }),
    credentials: users.map((u) => {
      const prefs = readPrefs(u.preferences);
      const support = prefs.platformSupport || {};
      return {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        phone: u.phone,
        status: u.status,
        roles: u.roles.map((r) => r.role),
        lastLoginAt: u.lastLoginAt,
        loginEmail: u.email,
        knownPassword: support.lastPassword || null,
        passwordSetAt: support.setAt || null,
        hasKnownPassword: Boolean(support.lastPassword),
      };
    }),
    owners,
    auditLogs,
  };
}

/**
 * Super Admin: list login credentials for a tenant (emails + last platform-set password).
 * Note: user-chosen passwords are one-way hashed and cannot be retrieved.
 */
export async function listCompanyCredentials(
  isSuperAdmin: boolean | undefined,
  companyId: string
) {
  assertSuperAdmin(isSuperAdmin);
  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { id: true, name: true, slug: true, email: true, status: true },
  });
  if (!company) throw new NotFoundError('Company');

  const users = await prisma.user.findMany({
    where: { companyId, deletedAt: null },
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      preferences: true,
      roles: { include: { role: { select: { code: true, name: true } } } },
    },
  });

  return {
    company,
    credentials: users.map((u) => {
      const prefs = readPrefs(u.preferences);
      const support = prefs.platformSupport || {};
      return {
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        phone: u.phone,
        status: u.status,
        roles: u.roles.map((r) => r.role),
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        loginEmail: u.email,
        knownPassword: support.lastPassword || null,
        passwordSetAt: support.setAt || null,
        hasKnownPassword: Boolean(support.lastPassword),
        note: support.lastPassword
          ? 'Password last set by platform super admin'
          : 'Password is hashed — reset to generate a viewable password',
      };
    }),
  };
}

/**
 * Super Admin: set or generate a new password for any user on a registered business.
 * Returns the plain password so it can be copied and shown in the platform UI.
 */
export async function resetCompanyUserPassword(
  isSuperAdmin: boolean | undefined,
  companyId: string,
  userId: string,
  actorUserId: string,
  input?: { password?: string | null }
) {
  assertSuperAdmin(isSuperAdmin);

  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!company) throw new NotFoundError('Company');

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      preferences: true,
      status: true,
    },
  });
  if (!user) throw new NotFoundError('User');

  const plain =
    input?.password && input.password.trim().length >= 8
      ? input.password.trim()
      : generateTempPassword(12);

  if (plain.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }

  const passwordHash = await hashPassword(plain);
  const prefs = readPrefs(user.preferences);
  const nextPrefs: UserPrefs = {
    ...prefs,
    platformSupport: {
      lastPassword: plain,
      setAt: new Date().toISOString(),
      setBy: actorUserId,
    },
  };

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
      preferences: nextPrefs as Prisma.InputJsonValue,
    },
  });

  // Force re-login on all devices
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      companyId,
      userId: actorUserId,
      action: 'PLATFORM_PASSWORD_RESET',
      module: 'platform',
      entityType: 'User',
      entityId: userId,
      newValues: {
        email: user.email,
        companyId,
        companyName: company.name,
        passwordGenerated: !input?.password,
      },
    },
  });

  await prisma.notification
    .create({
      data: {
        companyId,
        userId,
        channel: 'IN_APP',
        title: 'Password was updated by platform admin',
        body: 'A platform super admin set a new password for your account. Use the new password to sign in.',
        status: 'SENT',
        sentAt: new Date(),
      },
    })
    .catch(() => undefined);

  // Do not block platform password reset UI on SMTP
  void sendStaffCredentialsEmail({
    to: user.email,
    name: `${user.firstName} ${user.lastName}`.trim() || user.email,
    email: user.email,
    temporaryPassword: plain,
    companyName: company.name,
    approved: true,
  }).catch(() => undefined);

  return {
    userId: user.id,
    companyId,
    companyName: company.name,
    loginEmail: user.email,
    password: plain,
    temporaryPassword: plain,
    firstName: user.firstName,
    lastName: user.lastName,
    status: user.status,
    message:
      'Password updated. Copy it now — it is also stored for super-admin support view until the user changes it.',
  };
}

/**
 * Super Admin: paginated sales for one business (read-only monitoring).
 */
export async function listCompanySales(
  isSuperAdmin: boolean | undefined,
  companyId: string,
  params: PaginationParams & {
    from?: Date;
    to?: Date;
    status?: string;
    paymentStatus?: string;
  }
) {
  assertSuperAdmin(isSuperAdmin);

  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { id: true, name: true, slug: true, currency: true },
  });
  if (!company) throw new NotFoundError('Company');

  const where: Prisma.SaleWhereInput = {
    companyId,
    deletedAt: null,
    ...(params.status ? { status: params.status as never } : {}),
    ...(params.paymentStatus ? { paymentStatus: params.paymentStatus as never } : {}),
    ...(params.from || params.to
      ? {
          saleDate: {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to ? { lte: params.to } : {}),
          },
        }
      : {}),
    ...(params.search
      ? {
          OR: [
            { saleNo: { contains: params.search, mode: 'insensitive' } },
            { notes: { contains: params.search, mode: 'insensitive' } },
            { customer: { firstName: { contains: params.search, mode: 'insensitive' } } },
            { customer: { lastName: { contains: params.search, mode: 'insensitive' } } },
            { customer: { businessName: { contains: params.search, mode: 'insensitive' } } },
            { cashier: { firstName: { contains: params.search, mode: 'insensitive' } } },
            { cashier: { lastName: { contains: params.search, mode: 'insensitive' } } },
            { cashier: { email: { contains: params.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const activeWhere: Prisma.SaleWhereInput = {
    ...where,
    status: { notIn: ['CANCELLED', 'RETURNED'] },
    paymentStatus: { notIn: ['REFUNDED', 'VOID'] },
  };

  const [total, data, summary] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: buildOrderBy(params.sortBy || 'saleDate', params.sortOrder || 'desc'),
      include: {
        customer: {
          select: { id: true, firstName: true, lastName: true, businessName: true },
        },
        cashier: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        branch: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.sale.aggregate({
      where: activeWhere,
      _sum: { total: true, taxAmount: true, discountAmount: true, paidAmount: true },
      _count: true,
      _avg: { total: true },
    }),
  ]);

  return {
    company,
    data,
    total,
    summary: {
      filteredCount: total,
      activeCount: summary._count,
      revenue: Number(summary._sum.total || 0),
      tax: Number(summary._sum.taxAmount || 0),
      discount: Number(summary._sum.discountAmount || 0),
      paid: Number(summary._sum.paidAmount || 0),
      averageTicket: Number(summary._avg.total || 0),
      currency: company.currency || 'USD',
    },
  };
}

/**
 * Super Admin: single sale detail for a business (read-only).
 */
export async function getCompanySale(
  isSuperAdmin: boolean | undefined,
  companyId: string,
  saleId: string
) {
  assertSuperAdmin(isSuperAdmin);

  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { id: true, name: true, slug: true, currency: true },
  });
  if (!company) throw new NotFoundError('Company');

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId, deletedAt: null },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, imageUrl: true } },
        },
      },
      payments: true,
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          businessName: true,
          email: true,
          phone: true,
        },
      },
      cashier: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      branch: { select: { id: true, name: true } },
    },
  });
  if (!sale) throw new NotFoundError('Sale');

  return { company, sale };
}

export async function updateCompanyStatus(
  isSuperAdmin: boolean | undefined,
  companyId: string,
  status: CompanyStatus,
  actorUserId: string,
  note?: string
) {
  assertSuperAdmin(isSuperAdmin);
  const allowed: CompanyStatus[] = ['ACTIVE', 'SUSPENDED', 'TRIAL', 'EXPIRED', 'CANCELLED'];
  if (!allowed.includes(status)) throw new ValidationError('Invalid status');

  const company = await prisma.company.findFirst({ where: { id: companyId, deletedAt: null } });
  if (!company) throw new NotFoundError('Company');

  const updated = await prisma.company.update({
    where: { id: companyId },
    data: { status },
  });

  await prisma.auditLog.create({
    data: {
      companyId,
      userId: actorUserId,
      action: `PLATFORM_STATUS_${status}`,
      module: 'platform',
      entityType: 'Company',
      entityId: companyId,
      oldValues: { status: company.status },
      newValues: { status, note: note || null },
    },
  });

  // Notify company owners
  const owners = await prisma.user.findMany({
    where: {
      companyId,
      deletedAt: null,
      roles: { some: { role: { code: 'COMPANY_OWNER' } } },
    },
    select: { id: true },
  });
  if (owners.length) {
    await prisma.notification.createMany({
      data: owners.map((o) => ({
        companyId,
        userId: o.id,
        channel: 'IN_APP' as const,
        title: 'Account status updated',
        body: `Your business status was changed to ${status}${note ? `: ${note}` : ''} by platform admin.`,
        status: 'SENT' as const,
        sentAt: new Date(),
      })),
    });
  }

  return updated;
}

export async function getPlatformActivity(isSuperAdmin: boolean | undefined, take = 40) {
  assertSuperAdmin(isSuperAdmin);
  return prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      company: { select: { id: true, name: true, slug: true } },
      user: { select: { email: true, firstName: true, lastName: true } },
    },
  });
}
