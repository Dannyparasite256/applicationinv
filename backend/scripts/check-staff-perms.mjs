import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const users = await p.user.findMany({
  where: { deletedAt: null },
  select: {
    email: true,
    status: true,
    roles: { include: { role: { select: { code: true, companyId: true, id: true } } } },
  },
  take: 40,
});

for (const u of users) {
  const roleIds = u.roles.map((r) => r.role.id);
  const rps = roleIds.length
    ? await p.rolePermission.findMany({
        where: { roleId: { in: roleIds } },
        include: { permission: { select: { code: true } } },
      })
    : [];
  const perms = [...new Set(rps.map((x) => x.permission.code))];
  console.log(
    u.email,
    u.status,
    'roles=' + u.roles.map((r) => `${r.role.code}(${r.role.companyId ? 'co' : 'sys'})`).join('|'),
    'pos=' + perms.includes('pos.access'),
    'n=' + perms.length,
    perms.join(',')
  );
}

const roles = await p.role.findMany({
  where: { companyId: { not: null } },
  select: {
    code: true,
    companyId: true,
    _count: { select: { permissions: true, users: true } },
  },
});
console.log('COMPANY_ROLES', JSON.stringify(roles, null, 2));

// Recent sales failures aren't logged; check latest sales by cashier
const sales = await p.sale.findMany({
  orderBy: { createdAt: 'desc' },
  take: 8,
  select: {
    saleNo: true,
    total: true,
    paymentStatus: true,
    createdAt: true,
    cashier: { select: { email: true } },
  },
});
console.log('RECENT_SALES', JSON.stringify(sales, null, 2));

await p.$disconnect();
