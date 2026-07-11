import { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { generateDocNo } from '../utils/crypto';
import { PaginationParams, buildOrderBy } from '../utils/pagination';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

/** Round money to 4 dp to avoid float drift in payment status checks */
function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

export async function createSale(
  companyId: string | null | undefined,
  cashierId: string,
  input: {
    customerId?: string | null;
    branchId?: string | null;
    warehouseId?: string | null;
    shiftId?: string | null;
    items: Array<{
      productId: string;
      variantId?: string | null;
      quantity: number;
      unitPrice?: number;
      discount?: number;
      batchNumber?: string | null;
      serialNo?: string | null;
    }>;
    payments?: Array<{
      method: PaymentMethod;
      amount: number;
      reference?: string | null;
      /** ISO currency of tendered amount (defaults to company base) */
      currency?: string | null;
      exchangeRate?: number | null;
    }>;
    /** Display / tender currency for this sale (defaults to company base) */
    currency?: string | null;
    discountAmount?: number;
    notes?: string | null;
    isOffline?: boolean;
    offlineId?: string | null;
  }
) {
  const cid = requireCompany(companyId);

  if (input.offlineId) {
    const existing = await prisma.sale.findFirst({
      where: { companyId: cid, offlineId: input.offlineId },
    });
    if (existing) return existing;
  }

  if (!input.items?.length) {
    throw new ValidationError('Add at least one product to the sale');
  }

  // Resolve warehouse: explicit → default → any active (never soft-deleted)
  let warehouseId = input.warehouseId || undefined;
  if (!warehouseId) {
    const wh =
      (await prisma.warehouse.findFirst({
        where: { companyId: cid, isDefault: true, isActive: true, deletedAt: null },
      })) ||
      (await prisma.warehouse.findFirst({
        where: { companyId: cid, isActive: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }));
    warehouseId = wh?.id;
  }
  if (!warehouseId) {
    throw new ValidationError(
      'No warehouse configured. Create a warehouse under Settings before recording sales.'
    );
  }

  const productIds = input.items.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, companyId: cid, deletedAt: null },
    include: { tax: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  let subtotal = 0;
  let taxAmount = 0;
  const lineItems: Array<{
    productId: string;
    variantId?: string | null;
    productName: string;
    sku: string | null;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxAmount: number;
    total: number;
    batchNumber?: string | null;
    serialNo?: string | null;
    trackInventory: boolean;
  }> = [];

  for (const item of input.items) {
    const product = productMap.get(item.productId);
    if (!product) throw new NotFoundError(`Product ${item.productId}`);
    if (!product.isActive) {
      throw new ValidationError(`Product "${product.name}" is inactive and cannot be sold`);
    }
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ValidationError(`Invalid quantity for ${product.name}`);
    }
    const unitPrice = item.unitPrice != null ? Number(item.unitPrice) : Number(product.sellingPrice);
    const discount = Number(item.discount ?? 0) || 0;
    const lineSub = unitPrice * qty - discount;
    if (lineSub < 0) throw new ValidationError(`Discount too large for ${product.name}`);
    const taxRate = product.tax ? Number(product.tax.rate) : 0;
    const lineTax = (lineSub * taxRate) / 100;
    subtotal += lineSub;
    taxAmount += lineTax;
    lineItems.push({
      productId: product.id,
      variantId: item.variantId,
      productName: product.name,
      sku: product.sku,
      quantity: qty,
      unitPrice,
      discount,
      taxAmount: lineTax,
      total: lineSub + lineTax,
      batchNumber: item.batchNumber,
      serialNo: item.serialNo,
      trackInventory: product.trackInventory,
    });
  }

  const discountAmount = Number(input.discountAmount ?? 0) || 0;
  const total = Math.max(0, roundMoney(subtotal + taxAmount - discountAmount));

  // Multi-currency: product prices & sale totals stay in company base currency.
  // Payments may be tendered in any currency and are converted to base for settlement.
  const company = await prisma.company.findUnique({
    where: { id: cid },
    select: { currency: true },
  });
  const baseCurrency = (company?.currency || 'USD').toUpperCase();
  const saleCurrency = (input.currency || baseCurrency).toUpperCase();

  const currencyRows = await prisma.currency.findMany({
    where: { companyId: cid, isActive: true },
  });
  const rateMap: Record<string, number> = { [baseCurrency]: 1 };
  for (const r of currencyRows) {
    rateMap[r.code.toUpperCase()] = Number(r.exchangeRate) || 1;
  }
  rateMap[baseCurrency] = 1;
  const saleFx = rateMap[saleCurrency] ?? 1;

  const payments = input.payments || [];
  let normalizedPayments = payments.map((p) => {
    const payCur = (p.currency || saleCurrency || baseCurrency).toUpperCase();
    const fx =
      p.exchangeRate && Number(p.exchangeRate) > 0
        ? Number(p.exchangeRate)
        : rateMap[payCur] ?? 1;
    const amountBase = roundMoney(Number(p.amount) * fx);
    return {
      method: p.method,
      amount: Number(p.amount),
      currency: payCur,
      exchangeRate: fx,
      amountBase,
      reference: p.reference,
    };
  });

  // POS convenience: no payments sent → full cash settlement in base currency
  if (!normalizedPayments.length && total > 0) {
    normalizedPayments = [
      {
        method: 'CASH' as PaymentMethod,
        amount: total,
        currency: baseCurrency,
        exchangeRate: 1,
        amountBase: total,
        reference: null,
      },
    ];
  }

  let paidAmount = roundMoney(normalizedPayments.reduce((s, p) => s + p.amountBase, 0));

  // Clients sometimes tender pre-tax amount. For walk-in **base-currency** tenders only,
  // if payment covers pre-tax net, top up tax so the sale is fully paid.
  // Never invent money for foreign FX tenders (exchangeRate !== 1).
  const netBeforeTax = Math.max(0, subtotal - discountAmount);
  const lastPay = normalizedPayments[normalizedPayments.length - 1];
  const baseTenderOnly =
    !!lastPay &&
    Number(lastPay.exchangeRate) === 1 &&
    (!lastPay.currency || lastPay.currency === baseCurrency);
  if (
    !input.customerId &&
    baseTenderOnly &&
    paidAmount + 0.001 < total &&
    paidAmount + 0.001 >= netBeforeTax &&
    taxAmount > 0 &&
    normalizedPayments.length > 0
  ) {
    const shortfall = roundMoney(total - paidAmount);
    lastPay.amountBase = roundMoney(lastPay.amountBase + shortfall);
    lastPay.amount = roundMoney(lastPay.amount + shortfall);
    paidAmount = total;
  }

  // Rounding tolerance (float / FX)
  const EPS = 0.02;
  let paymentStatus: PaymentStatus =
    paidAmount <= 0
      ? 'UNPAID'
      : paidAmount + EPS >= total
        ? 'PAID'
        : 'PARTIAL';
  if (paymentStatus === 'PAID') {
    paidAmount = Math.max(paidAmount, total);
  }
  const primaryMethod = normalizedPayments[0]?.method || 'CASH';

  // Only attach a shift that belongs to this cashier (stale shift ids from shared devices break sales)
  let shiftId: string | null = input.shiftId || null;
  if (shiftId) {
    const shift = await prisma.shift.findFirst({
      where: { id: shiftId, companyId: cid, userId: cashierId, status: 'open' },
      select: { id: true },
    });
    if (!shift) shiftId = null;
  }
  if (!shiftId) {
    const open = await prisma.shift.findFirst({
      where: { companyId: cid, userId: cashierId, status: 'open' },
      select: { id: true },
    });
    shiftId = open?.id || null;
  }

  // Atomic saleNo: count-based numbers race under concurrency → unique constraint fails
  const maxAttempts = 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const last = await tx.sale.findFirst({
          where: { companyId: cid },
          orderBy: { createdAt: 'desc' },
          select: { saleNo: true },
        });
        let seq = 1;
        if (last?.saleNo) {
          const m = last.saleNo.match(/(\d+)$/);
          if (m) seq = parseInt(m[1], 10) + 1;
        } else {
          seq = (await tx.sale.count({ where: { companyId: cid } })) + 1;
        }
        // On retry, bump past collisions
        seq += attempt;
        const saleNo = generateDocNo('POS', seq);

        const sale = await tx.sale.create({
          data: {
            companyId: cid,
            branchId: input.branchId,
            warehouseId,
            saleNo,
            customerId: input.customerId,
            cashierId,
            shiftId,
            status: 'CONFIRMED',
            paymentStatus,
            subtotal,
            discountAmount,
            taxAmount,
            total,
            paidAmount,
            changeAmount: Math.max(0, paidAmount - total),
            paymentMethod: primaryMethod,
            currency: saleCurrency,
            exchangeRate: saleFx,
            notes: input.notes,
            isOffline: input.isOffline ?? false,
            offlineId: input.offlineId,
            items: {
              create: lineItems.map((li) => ({
                productId: li.productId,
                variantId: li.variantId,
                productName: li.productName,
                sku: li.sku,
                quantity: li.quantity,
                unitPrice: li.unitPrice,
                discount: li.discount,
                taxAmount: li.taxAmount,
                total: li.total,
                batchNumber: li.batchNumber,
                serialNo: li.serialNo,
              })),
            },
            payments: {
              create: normalizedPayments.map((p) => ({
                companyId: cid,
                amount: p.amount,
                currency: p.currency,
                exchangeRate: p.exchangeRate,
                amountBase: p.amountBase,
                method: p.method,
                reference: p.reference,
                customerId: input.customerId,
              })),
            },
          },
          include: {
            items: true,
            payments: true,
            customer: true,
          },
        });

        // Stock deduction — prefer sale warehouse, else any warehouse with enough qty
        for (const li of lineItems) {
          if (!li.trackInventory) continue;

          let level = await tx.stockLevel.findFirst({
            where: { productId: li.productId, warehouseId },
          });
          let deductWarehouseId = warehouseId;

          if (!level || Number(level.quantity) < li.quantity) {
            const alt = await tx.stockLevel.findFirst({
              where: {
                productId: li.productId,
                quantity: { gte: li.quantity },
                warehouse: { companyId: cid, isActive: true },
              },
              orderBy: { quantity: 'desc' },
            });
            if (alt) {
              level = alt;
              deductWarehouseId = alt.warehouseId;
            }
          }

          if (!level) {
            level = await tx.stockLevel.create({
              data: {
                productId: li.productId,
                warehouseId,
                quantity: 0,
              },
            });
            deductWarehouseId = warehouseId;
          }

          const available = Number(level.quantity);
          if (available < li.quantity) {
            throw new ValidationError(
              `Insufficient stock for ${li.productName} (available: ${available}, needed: ${li.quantity}). Receive stock or set initial quantity before selling.`
            );
          }

          await tx.stockLevel.update({
            where: { id: level.id },
            data: { quantity: { decrement: li.quantity } },
          });
          await tx.stockMovement.create({
            data: {
              companyId: cid,
              productId: li.productId,
              warehouseId: deductWarehouseId,
              type: 'SALE',
              quantity: -li.quantity,
              unitCost: li.unitPrice,
              reference: saleNo,
              referenceId: sale.id,
              batchNumber: li.batchNumber || undefined,
              performedBy: cashierId,
            },
          });
        }

        if (shiftId) {
          try {
            await tx.shift.update({
              where: { id: shiftId },
              data: { totalSales: { increment: total } },
            });
          } catch {
            // Shift closed/missing mid-request — sale still succeeds
          }
        }

        if (input.customerId && paidAmount < total) {
          await tx.customer.update({
            where: { id: input.customerId },
            data: { balance: { increment: total - paidAmount } },
          });
        }

        return sale;
      });
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string })?.code;
      const msg = String((err as Error)?.message || '');
      // Unique saleNo collision — retry with next sequence
      if (code === 'P2002' && (msg.includes('saleNo') || msg.includes('sale_no'))) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new ValidationError('Could not create sale — please try again');
}

export async function listSales(
  companyId: string | null | undefined,
  params: PaginationParams & { branchId?: string; from?: Date; to?: Date; status?: string }
) {
  const cid = requireCompany(companyId);
  const where: Prisma.SaleWhereInput = {
    companyId: cid,
    deletedAt: null,
    ...(params.branchId ? { branchId: params.branchId } : {}),
    ...(params.status ? { status: params.status as never } : {}),
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
            { customer: { firstName: { contains: params.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, data] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where,
      skip: params.skip,
      take: params.limit,
      orderBy: buildOrderBy(params.sortBy, params.sortOrder),
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, businessName: true } },
        cashier: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  return { data, total };
}

export async function getSale(companyId: string | null | undefined, id: string) {
  const cid = requireCompany(companyId);
  const sale = await prisma.sale.findFirst({
    where: { id, companyId: cid },
    include: {
      items: true,
      payments: true,
      customer: true,
      cashier: { select: { id: true, firstName: true, lastName: true } },
      branch: true,
    },
  });
  if (!sale) throw new NotFoundError('Sale');
  return sale;
}

export async function openShift(
  companyId: string | null | undefined,
  userId: string,
  input: { branchId?: string | null; openingCash?: number }
) {
  const cid = requireCompany(companyId);
  const open = await prisma.shift.findFirst({
    where: { companyId: cid, userId, status: 'open' },
  });
  if (open) throw new ValidationError('You already have an open shift');

  const count = await prisma.shift.count({ where: { companyId: cid } });
  return prisma.shift.create({
    data: {
      companyId: cid,
      branchId: input.branchId,
      userId,
      shiftNo: generateDocNo('SHF', count + 1),
      openingCash: input.openingCash ?? 0,
      status: 'open',
    },
  });
}

export async function closeShift(
  companyId: string | null | undefined,
  userId: string,
  shiftId: string,
  input: { closingCash: number; notes?: string | null }
) {
  const cid = requireCompany(companyId);
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, companyId: cid, userId, status: 'open' },
  });
  if (!shift) throw new NotFoundError('Open shift');

  const sales = await prisma.sale.aggregate({
    where: { shiftId, paymentMethod: 'CASH', paymentStatus: 'PAID' },
    _sum: { paidAmount: true },
  });
  const cashSales = Number(sales._sum.paidAmount || 0);
  const expectedCash = Number(shift.openingCash) + cashSales - Number(shift.totalRefunds);
  const difference = input.closingCash - expectedCash;

  return prisma.shift.update({
    where: { id: shiftId },
    data: {
      status: 'closed',
      closedAt: new Date(),
      closingCash: input.closingCash,
      expectedCash,
      difference,
      notes: input.notes,
    },
  });
}

export async function getCurrentShift(companyId: string | null | undefined, userId: string) {
  const cid = requireCompany(companyId);
  return prisma.shift.findFirst({
    where: { companyId: cid, userId, status: 'open' },
  });
}

/**
 * Put inventory back after a refund or voided sale.
 * Prefer reversing the actual SALE stock movements (correct warehouse even when
 * stock was taken from an alternate warehouse at sale time).
 */
async function restoreSaleInventory(
  tx: Prisma.TransactionClient,
  cid: string,
  sale: {
    id: string;
    saleNo: string;
    warehouseId: string | null;
    items: Array<{ productId: string; quantity: unknown; unitPrice: unknown; productName?: string }>;
  },
  userId: string,
  notes: string
) {
  const saleMovements = await tx.stockMovement.findMany({
    where: { referenceId: sale.id, type: 'SALE', companyId: cid },
  });

  type Restock = { productId: string; warehouseId: string; quantity: number; unitCost: number };
  const restocks: Restock[] = [];

  if (saleMovements.length > 0) {
    for (const m of saleMovements) {
      restocks.push({
        productId: m.productId,
        warehouseId: m.warehouseId,
        quantity: Math.abs(Number(m.quantity)),
        unitCost: Number(m.unitCost ?? 0),
      });
    }
  } else {
    // Fallback: use line items + sale warehouse
    let warehouseId = sale.warehouseId || undefined;
    if (!warehouseId) {
      const wh =
        (await tx.warehouse.findFirst({
          where: { companyId: cid, isDefault: true, isActive: true },
        })) ||
        (await tx.warehouse.findFirst({
          where: { companyId: cid, isActive: true },
          orderBy: { createdAt: 'asc' },
        }));
      warehouseId = wh?.id;
    }
    if (!warehouseId) {
      throw new ValidationError('No warehouse available to restore stock');
    }
    for (const item of sale.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product?.trackInventory) continue;
      restocks.push({
        productId: item.productId,
        warehouseId,
        quantity: Number(item.quantity),
        unitCost: Number(item.unitPrice),
      });
    }
  }

  for (const r of restocks) {
    if (r.quantity <= 0) continue;
    const product = await tx.product.findUnique({ where: { id: r.productId } });
    if (product && !product.trackInventory) continue;

    const level = await tx.stockLevel.findFirst({
      where: { productId: r.productId, warehouseId: r.warehouseId },
    });
    if (level) {
      await tx.stockLevel.update({
        where: { id: level.id },
        data: { quantity: { increment: r.quantity } },
      });
    } else {
      await tx.stockLevel.create({
        data: {
          productId: r.productId,
          warehouseId: r.warehouseId,
          quantity: r.quantity,
        },
      });
    }
    await tx.stockMovement.create({
      data: {
        companyId: cid,
        productId: r.productId,
        warehouseId: r.warehouseId,
        type: 'RETURN_IN',
        quantity: r.quantity,
        unitCost: r.unitCost,
        reference: sale.saleNo,
        referenceId: sale.id,
        notes,
        performedBy: userId,
      },
    });
  }

  return restocks;
}

export async function refundSale(
  companyId: string | null | undefined,
  userId: string,
  saleId: string,
  input?: { reason?: string }
) {
  const cid = requireCompany(companyId);
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId: cid, deletedAt: null },
    include: { items: true, payments: true },
  });
  if (!sale) throw new NotFoundError('Sale');
  if (sale.status === 'RETURNED' || sale.status === 'CANCELLED') {
    throw new ValidationError('Sale already returned or cancelled');
  }
  if (sale.paymentStatus === 'REFUNDED') {
    throw new ValidationError('Sale is already refunded');
  }

  const reason = input?.reason?.trim() || 'Customer return';

  return prisma.$transaction(async (tx) => {
    await restoreSaleInventory(tx, cid, sale, userId, `Refund: ${reason}`);

    // Reverse customer credit balance from partial payments on the original sale
    const unpaid = Math.max(0, Number(sale.total) - Number(sale.paidAmount));
    if (sale.customerId && unpaid > 0) {
      await tx.customer.update({
        where: { id: sale.customerId },
        data: { balance: { decrement: unpaid } },
      });
    }

    if (sale.shiftId) {
      await tx.shift.update({
        where: { id: sale.shiftId },
        data: {
          totalRefunds: { increment: Number(sale.total) },
          totalSales: { decrement: Number(sale.total) },
        },
      });
    }

    return tx.sale.update({
      where: { id: saleId },
      data: {
        status: 'RETURNED',
        paymentStatus: 'REFUNDED',
        notes: [sale.notes, `Refund: ${reason}`].filter(Boolean).join(' | '),
      },
      include: {
        items: true,
        payments: true,
        customer: true,
        cashier: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  });
}

/**
 * Delete / void a mistaken sale: restore stock, reverse balances, soft-delete.
 * Use when the cashier recorded the wrong sale (not a customer return).
 */
export async function deleteSale(
  companyId: string | null | undefined,
  userId: string,
  saleId: string,
  input?: { reason?: string }
) {
  const cid = requireCompany(companyId);
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId: cid, deletedAt: null },
    include: { items: true, payments: true },
  });
  if (!sale) throw new NotFoundError('Sale');
  if (sale.status === 'RETURNED' || sale.status === 'CANCELLED') {
    throw new ValidationError('Sale already returned or cancelled — cannot delete again');
  }
  if (sale.paymentStatus === 'REFUNDED') {
    throw new ValidationError('Refunded sales cannot be deleted. They stay for audit history.');
  }

  const reason = input?.reason?.trim() || 'Deleted due to mistake';

  return prisma.$transaction(async (tx) => {
    await restoreSaleInventory(tx, cid, sale, userId, `Void/delete: ${reason}`);

    const unpaid = Math.max(0, Number(sale.total) - Number(sale.paidAmount));
    if (sale.customerId && unpaid > 0) {
      await tx.customer.update({
        where: { id: sale.customerId },
        data: { balance: { decrement: unpaid } },
      });
    }

    if (sale.shiftId) {
      await tx.shift.update({
        where: { id: sale.shiftId },
        data: {
          totalSales: { decrement: Number(sale.total) },
        },
      });
    }

    return tx.sale.update({
      where: { id: saleId },
      data: {
        status: 'CANCELLED',
        paymentStatus: 'VOID',
        deletedAt: new Date(),
        notes: [sale.notes, `Deleted: ${reason}`].filter(Boolean).join(' | '),
      },
      include: {
        items: true,
        payments: true,
        customer: true,
      },
    });
  });
}

export async function syncOfflineSales(
  companyId: string | null | undefined,
  cashierId: string,
  sales: Array<Parameters<typeof createSale>[2]>
) {
  const results = [];
  for (const payload of sales) {
    try {
      const sale = await createSale(companyId, cashierId, {
        ...payload,
        isOffline: true,
      });
      results.push({ offlineId: payload.offlineId, success: true, saleId: sale.id, saleNo: sale.saleNo });
    } catch (error) {
      results.push({
        offlineId: payload.offlineId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed',
      });
    }
  }
  return results;
}
