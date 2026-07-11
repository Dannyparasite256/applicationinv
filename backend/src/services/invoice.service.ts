import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { generateDocNo } from '../utils/crypto';
import { PaginationParams, buildOrderBy } from '../utils/pagination';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

export async function listInvoices(
  companyId: string | null | undefined,
  params: PaginationParams & {
    status?: string;
    paymentStatus?: string;
    customerId?: string;
  }
) {
  const cid = requireCompany(companyId);
  const where: Prisma.InvoiceWhereInput = {
    companyId: cid,
    deletedAt: null,
    ...(params.status ? { status: params.status as never } : {}),
    ...(params.paymentStatus ? { paymentStatus: params.paymentStatus as never } : {}),
    ...(params.customerId ? { customerId: params.customerId } : {}),
    ...(params.search
      ? {
          OR: [
            { invoiceNo: { contains: params.search, mode: 'insensitive' } },
            { notes: { contains: params.search, mode: 'insensitive' } },
            { customer: { firstName: { contains: params.search, mode: 'insensitive' } } },
            { customer: { lastName: { contains: params.search, mode: 'insensitive' } } },
            { customer: { businessName: { contains: params.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [total, data] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: buildOrderBy(params.sortBy, params.sortOrder),
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, businessName: true, code: true } },
        _count: { select: { items: true, payments: true } },
      },
    }),
  ]);
  return { data, total };
}

export async function getInvoice(companyId: string | null | undefined, id: string) {
  const cid = requireCompany(companyId);
  const invoice = await prisma.invoice.findFirst({
    where: { id, companyId: cid, deletedAt: null },
    include: {
      customer: true,
      items: true,
      payments: true,
      company: { select: { name: true, address: true, phone: true, email: true, logoUrl: true, currency: true } },
    },
  });
  if (!invoice) throw new NotFoundError('Invoice');
  return invoice;
}

export async function createInvoice(
  companyId: string | null | undefined,
  input: {
    customerId?: string | null;
    dueDate?: Date | null;
    notes?: string | null;
    discountAmount?: number;
    items: Array<{
      productId?: string | null;
      description: string;
      quantity: number;
      unitPrice: number;
      discount?: number;
      taxAmount?: number;
      /** Percent tax (e.g. 10) when taxAmount is omitted */
      taxRate?: number;
    }>;
  }
) {
  const cid = requireCompany(companyId);
  if (!input.items?.length) throw new ValidationError('Add at least one line item');

  let subtotal = 0;
  let taxAmount = 0;
  const lines = input.items.map((item) => {
    const qty = Number(item.quantity);
    const price = Number(item.unitPrice);
    const disc = Number(item.discount || 0) || 0;
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ValidationError(`Invalid quantity for "${item.description}"`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new ValidationError(`Invalid unit price for "${item.description}"`);
    }
    const lineSub = qty * price - disc;
    // Prefer explicit taxAmount; otherwise derive from optional taxRate %
    const rate = Number((item as { taxRate?: number }).taxRate || 0) || 0;
    const lineTax =
      item.taxAmount != null && item.taxAmount !== undefined
        ? Number(item.taxAmount) || 0
        : rate > 0
          ? (lineSub * rate) / 100
          : 0;
    subtotal += lineSub;
    taxAmount += lineTax;
    return {
      productId: item.productId,
      description: item.description.trim(),
      quantity: qty,
      unitPrice: price,
      discount: disc,
      taxAmount: lineTax,
      total: lineSub + lineTax,
    };
  });

  const discountAmount = Number(input.discountAmount || 0) || 0;
  const total = Math.max(0, subtotal + taxAmount - discountAmount);
  const count = await prisma.invoice.count({ where: { companyId: cid } });
  const company = await prisma.company.findUnique({
    where: { id: cid },
    select: { currency: true },
  });

  return prisma.invoice.create({
    data: {
      companyId: cid,
      invoiceNo: generateDocNo('INV', count + 1),
      customerId: input.customerId,
      status: 'SENT',
      paymentStatus: 'UNPAID',
      subtotal,
      discountAmount,
      taxAmount,
      total,
      currency: (company?.currency || 'USD').toUpperCase(),
      dueDate: input.dueDate,
      notes: input.notes,
      issuedAt: new Date(),
      items: { create: lines },
    },
    include: { items: true, customer: true, payments: true },
  });
}

export async function createInvoiceFromSale(companyId: string | null | undefined, saleId: string) {
  const cid = requireCompany(companyId);
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId: cid },
    include: { items: true },
  });
  if (!sale) throw new NotFoundError('Sale');

  // Prevent duplicate invoices from the same sale (double AR)
  const existing = await prisma.invoice.findFirst({
    where: {
      companyId: cid,
      deletedAt: null,
      notes: { contains: `From sale ${sale.saleNo}` },
    },
    include: { items: true, customer: true, payments: true },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;

  return createInvoice(cid, {
    customerId: sale.customerId,
    notes: `From sale ${sale.saleNo}`,
    discountAmount: Number(sale.discountAmount),
    items: sale.items.map((i) => ({
      productId: i.productId,
      description: i.productName,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      discount: Number(i.discount),
      taxAmount: Number(i.taxAmount),
    })),
  });
}

export async function recordInvoicePayment(
  companyId: string | null | undefined,
  invoiceId: string,
  input: {
    amount: number;
    method: string;
    reference?: string | null;
    notes?: string | null;
    currency?: string | null;
    exchangeRate?: number | null;
  }
) {
  const cid = requireCompany(companyId);
  const invoice = await getInvoice(cid, invoiceId);
  if (input.amount <= 0) throw new ValidationError('Amount must be positive');
  if (invoice.paymentStatus === 'PAID' || invoice.status === 'VOID' || invoice.status === 'CANCELLED') {
    throw new ValidationError('This invoice cannot accept more payments');
  }

  const company = await prisma.company.findUnique({
    where: { id: cid },
    select: { currency: true },
  });
  const base = (company?.currency || 'USD').toUpperCase();
  const payCur = (input.currency || invoice.currency || base).toUpperCase();
  const rows = await prisma.currency.findMany({ where: { companyId: cid, isActive: true } });
  const rateMap: Record<string, number> = { [base]: 1 };
  for (const r of rows) rateMap[r.code.toUpperCase()] = Number(r.exchangeRate) || 1;
  rateMap[base] = 1;
  const fx =
    input.exchangeRate && input.exchangeRate > 0 ? input.exchangeRate : rateMap[payCur] ?? 1;
  let amountBase = Number(input.amount) * fx;
  let tenderAmount = Number(input.amount);

  const balance = Math.max(0, Number(invoice.total) - Number(invoice.paidAmount));
  if (amountBase > balance + 0.02) {
    throw new ValidationError(
      `Payment exceeds balance due (${balance.toFixed(2)} ${base}). Enter a smaller amount.`
    );
  }
  // Cap tiny float overshoot
  if (amountBase > balance) {
    amountBase = balance;
    tenderAmount = fx > 0 ? balance / fx : tenderAmount;
  }

  return prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        companyId: cid,
        invoiceId,
        customerId: invoice.customerId,
        amount: tenderAmount,
        currency: payCur,
        exchangeRate: fx,
        amountBase,
        method: input.method as never,
        reference: input.reference,
        notes: input.notes,
      },
    });
    const paidAmount = Number(invoice.paidAmount) + amountBase;
    const total = Number(invoice.total);
    const paymentStatus = paidAmount + 0.001 >= total ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';
    const status = paymentStatus === 'PAID' ? 'PAID' : invoice.status === 'DRAFT' ? 'SENT' : invoice.status;

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount,
        paymentStatus,
        status: status as never,
      },
      include: { items: true, payments: true, customer: true },
    });
  });
}

/** Soft-void an unpaid / partially paid invoice (cannot void fully paid). */
export async function voidInvoice(
  companyId: string | null | undefined,
  invoiceId: string,
  reason?: string | null
) {
  const cid = requireCompany(companyId);
  const invoice = await getInvoice(cid, invoiceId);
  if (invoice.paymentStatus === 'PAID') {
    throw new ValidationError('Cannot void a fully paid invoice');
  }
  if (invoice.status === 'CANCELLED' || invoice.paymentStatus === 'VOID') {
    throw new ValidationError('Invoice is already voided/cancelled');
  }

  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'CANCELLED',
      paymentStatus: 'VOID',
      notes: reason
        ? `${invoice.notes ? invoice.notes + '\n' : ''}Voided: ${reason}`
        : invoice.notes,
    },
    include: { items: true, payments: true, customer: true },
  });
}

/** Soft-delete invoice (managers / accounting). */
export async function deleteInvoice(companyId: string | null | undefined, invoiceId: string) {
  const cid = requireCompany(companyId);
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId: cid, deletedAt: null },
  });
  if (!invoice) throw new NotFoundError('Invoice');
  if (invoice.paymentStatus === 'PAID' && Number(invoice.paidAmount) > 0) {
    throw new ValidationError('Cannot delete a paid invoice — void is not enough; keep it for records');
  }

  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      deletedAt: new Date(),
      status: 'CANCELLED',
      paymentStatus: invoice.paymentStatus === 'UNPAID' ? 'VOID' : invoice.paymentStatus,
    },
  });
}

export async function invoiceSummary(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  const baseWhere = { companyId: cid, deletedAt: null };
  const [total, unpaid, partial, paid, voided, sumUnpaid] = await Promise.all([
    prisma.invoice.count({ where: baseWhere }),
    prisma.invoice.count({ where: { ...baseWhere, paymentStatus: 'UNPAID' } }),
    prisma.invoice.count({ where: { ...baseWhere, paymentStatus: 'PARTIAL' } }),
    prisma.invoice.count({ where: { ...baseWhere, paymentStatus: 'PAID' } }),
    prisma.invoice.count({
      where: { ...baseWhere, OR: [{ paymentStatus: 'VOID' }, { status: 'CANCELLED' }] },
    }),
    prisma.invoice.findMany({
      where: {
        ...baseWhere,
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      },
      select: { total: true, paidAmount: true },
    }),
  ]);
  const outstanding = sumUnpaid.reduce(
    (s, i) => s + Math.max(0, Number(i.total) - Number(i.paidAmount)),
    0
  );
  return { total, unpaid, partial, paid, voided, outstanding };
}
