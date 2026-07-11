import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const emptyRoles = await p.role.findMany({
  where: { companyId: { not: null } },
  select: {
    id: true,
    code: true,
    companyId: true,
    _count: { select: { permissions: true } },
  },
});

for (const role of emptyRoles) {
  if (role._count.permissions > 0) continue;
  const sys = await p.role.findFirst({
    where: { companyId: null, code: role.code },
    include: { permissions: true },
  });
  if (!sys?.permissions?.length) {
    console.log('NO_SYS_PERMS', role.code, role.companyId);
    continue;
  }
  await p.rolePermission.createMany({
    data: sys.permissions.map((rp) => ({
      roleId: role.id,
      permissionId: rp.permissionId,
    })),
    skipDuplicates: true,
  });
  const n = await p.rolePermission.count({ where: { roleId: role.id } });
  console.log('REPAIRED', role.code, role.companyId, '->', n, 'perms');
}

await p.$disconnect();
