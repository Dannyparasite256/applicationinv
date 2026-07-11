import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const users = await p.user.findMany({
  where: { deletedAt: null },
  select: {
    id: true,
    email: true,
    status: true,
    companyId: true,
    company: { select: { name: true, currency: true } },
    roles: { include: { role: { select: { code: true } } } },
  },
  orderBy: { email: 'asc' },
});

for (const u of users) {
  console.log(
    u.email.padEnd(35),
    (u.company?.name || '?').slice(0, 28).padEnd(28),
    u.status.padEnd(20),
    u.roles.map((r) => r.role.code).join(',')
  );
}

// Products for St Jude hardware companies
const companies = await p.company.findMany({
  where: { deletedAt: null },
  select: { id: true, name: true },
});
for (const c of companies) {
  const prods = await p.product.findMany({
    where: { companyId: c.id, deletedAt: null },
    select: {
      name: true,
      sellingPrice: true,
      trackInventory: true,
      stockLevels: { select: { quantity: true } },
    },
  });
  console.log('\n==', c.name, 'products', prods.length);
  for (const pr of prods) {
    const q = pr.stockLevels.reduce((s, l) => s + Number(l.quantity), 0);
    console.log(' ', pr.name, 'price', pr.sellingPrice, 'stock', q, 'track', pr.trackInventory);
  }
}

// Failed sale scenario: wembly staff asumanikimbowa on St Jude USD company
const stJude = companies.find((c) => c.name.toLowerCase().includes('jude') && c.id.startsWith('af81'));
if (stJude) {
  console.log('\nSt Jude company id', stJude.id);
}

await p.$disconnect();
