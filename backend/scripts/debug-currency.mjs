import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('DB', (process.env.DATABASE_URL || '').slice(0, 50));
  try {
    const n = await prisma.currency.count();
    console.log('currency count', n);
  } catch (e) {
    console.error('currency count ERR', e instanceof Error ? e.message : e);
  }
  try {
    const c = await prisma.company.findFirst({ where: { deletedAt: null } });
    console.log('company', c?.id, c?.name);
    if (c) {
      const full = await prisma.company.findFirst({
        where: { id: c.id },
        include: { branches: true, warehouses: true, taxes: true, currencies: true },
      });
      console.log('full counts', {
        b: full?.branches.length,
        w: full?.warehouses.length,
        t: full?.taxes.length,
        cur: full?.currencies.length,
      });
      const s = JSON.stringify(full);
      console.log('json ok', s.slice(0, 180));
    }
  } catch (e) {
    console.error('company include ERR', e instanceof Error ? e.message : e);
    console.error(e);
  }
}

main().finally(() => prisma.$disconnect());
