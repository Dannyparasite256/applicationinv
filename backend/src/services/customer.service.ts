import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { generateSku } from '../utils/crypto';
import { PaginationParams, buildOrderBy } from '../utils/pagination';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

export async function listCustomers(companyId: string | null | undefined, params: PaginationParams) {
  const cid = requireCompany(companyId);
  const where: Prisma.CustomerWhereInput = {
    companyId: cid,
    deletedAt: null,
    ...(params.search
      ? {
          OR: [
            { firstName: { contains: params.search, mode: 'insensitive' } },
            { lastName: { contains: params.search, mode: 'insensitive' } },
            { businessName: { contains: params.search, mode: 'insensitive' } },
            { email: { contains: params.search, mode: 'insensitive' } },
            { phone: { contains: params.search, mode: 'insensitive' } },
            { code: { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [total, data] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: buildOrderBy(params.sortBy, params.sortOrder),
    }),
  ]);
  return { data, total };
}

export async function createCustomer(
  companyId: string | null | undefined,
  data: {
    type?: string;
    firstName?: string | null;
    lastName?: string | null;
    businessName?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    creditLimit?: number;
    notes?: string | null;
  }
) {
  const cid = requireCompany(companyId);
  const count = await prisma.customer.count({ where: { companyId: cid } });
  return prisma.customer.create({
    data: {
      companyId: cid,
      code: generateSku('CUS', count + 1),
      type: data.type || 'individual',
      firstName: data.firstName,
      lastName: data.lastName,
      businessName: data.businessName,
      email: data.email,
      phone: data.phone,
      address: data.address,
      city: data.city,
      country: data.country,
      creditLimit: data.creditLimit ?? 0,
      notes: data.notes,
    },
  });
}

export async function getCustomer(companyId: string | null | undefined, id: string) {
  const cid = requireCompany(companyId);
  const customer = await prisma.customer.findFirst({
    where: { id, companyId: cid, deletedAt: null },
    include: {
      sales: { take: 10, orderBy: { saleDate: 'desc' } },
      payments: { take: 10, orderBy: { paidAt: 'desc' } },
    },
  });
  if (!customer) throw new NotFoundError('Customer');
  return customer;
}

export async function listSuppliers(companyId: string | null | undefined, params: PaginationParams) {
  const cid = requireCompany(companyId);
  const where: Prisma.SupplierWhereInput = {
    companyId: cid,
    deletedAt: null,
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: 'insensitive' } },
            { email: { contains: params.search, mode: 'insensitive' } },
            { code: { contains: params.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [total, data] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: buildOrderBy(params.sortBy, params.sortOrder),
    }),
  ]);
  return { data, total };
}

export async function updateCustomer(
  companyId: string | null | undefined,
  id: string,
  data: Partial<{
    firstName: string | null;
    lastName: string | null;
    businessName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    creditLimit: number;
    notes: string | null;
    isActive: boolean;
  }>
) {
  await getCustomer(companyId, id);
  return prisma.customer.update({
    where: { id },
    data: {
      ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
      ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
      ...(data.businessName !== undefined ? { businessName: data.businessName } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.address !== undefined ? { address: data.address } : {}),
      ...(data.city !== undefined ? { city: data.city } : {}),
      ...(data.country !== undefined ? { country: data.country } : {}),
      ...(data.creditLimit !== undefined ? { creditLimit: data.creditLimit } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });
}

export async function createSupplier(
  companyId: string | null | undefined,
  data: {
    name: string;
    contactPerson?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    paymentTerms?: string | null;
    notes?: string | null;
  }
) {
  const cid = requireCompany(companyId);
  const count = await prisma.supplier.count({ where: { companyId: cid } });
  return prisma.supplier.create({
    data: {
      companyId: cid,
      code: generateSku('SUP', count + 1),
      name: data.name,
      contactPerson: data.contactPerson,
      email: data.email,
      phone: data.phone,
      address: data.address,
      paymentTerms: data.paymentTerms,
      notes: data.notes,
    },
  });
}
