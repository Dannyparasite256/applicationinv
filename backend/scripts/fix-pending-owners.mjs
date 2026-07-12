import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../.env') });
config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  const pendingOwners = await prisma.user.findMany({
    where: {
      status: 'PENDING_VERIFICATION',
      deletedAt: null,
      roles: {
        some: {
          role: { code: { in: ['COMPANY_OWNER', 'SUPER_ADMIN'] } },
        },
      },
    },
    select: { id: true, email: true, firstName: true, lastName: true },
  });

  console.log('Pending owners to fix:', pendingOwners.length);
  for (const u of pendingOwners) {
    console.log(' -', u.email, u.firstName, u.lastName);
  }

  if (pendingOwners.length) {
    const r = await prisma.user.updateMany({
      where: { id: { in: pendingOwners.map((u) => u.id) } },
      data: {
        status: 'ACTIVE',
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });
    console.log('Updated:', r.count);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
