import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const companies = await p.company.findMany({
  where: { deletedAt: null },
  select: {
    id: true,
    name: true,
    currency: true,
    warehouses: { select: { id: true, name: true, isActive: true, isDefault: true } },
    _count: { select: { products: true, sales: true, users: true } },
  },
});
console.log(JSON.stringify(companies, null, 2));

// products with 0 stock that are trackInventory
const zero = await p.product.findMany({
  where: { deletedAt: null, trackInventory: true, isActive: true },
  select: {
    id: true,
    name: true,
    companyId: true,
    stockLevels: { select: { quantity: true } },
  },
  take: 50,
});
for (const prod of zero) {
  const q = prod.stockLevels.reduce((s, l) => s + Number(l.quantity), 0);
  if (q <= 0) console.log('ZERO_STOCK', prod.companyId.slice(0, 8), prod.name, q);
}

// shifts
const shifts = await p.shift.findMany({
  where: { status: 'open' },
  select: {
    id: true,
    shiftNo: true,
    userId: true,
    companyId: true,
    user: { select: { email: true } },
  },
});
console.log('OPEN_SHIFTS', JSON.stringify(shifts, null, 2));

await p.$disconnect();
