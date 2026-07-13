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
    /** Loyalty points to redeem (converted to currency discount) */
    redeemPoints?: number | null;
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
  const variantIds = input.items.map((i) => i.variantId).filter(Boolean) as string[];
  const [products, variants] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds }, companyId: cid, deletedAt: null },
      include: { tax: true },
    }),
    variantIds.length
      ? prisma.productVariant.findMany({
          where: { id: { in: variantIds }, productId: { in: productIds } },
        })
      : Promise.resolve([]),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  let subtotal = 0;
  let taxAmount = 0;
  const lineItems: Array<{
    productId: string;
    variantId?: string | null;
    productName: string;
    sku: string | null;
    quantity: number;
    unitPrice: number;
    /** Unit cost snapshot for COGS */
    costPrice: number;
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
    const variant = item.variantId ? variantMap.get(item.variantId) : undefined;
    const unitPrice =
      item.unitPrice != null
        ? Number(item.unitPrice)
        : variant
          ? Number(variant.sellingPrice)
          : Number(product.sellingPrice);
    // Snapshot cost at sale time (variant cost when present, else product master)
    const costPrice = variant
      ? Number(variant.costPrice) || Number(product.costPrice) || 0
      : Number(product.costPrice) || 0;
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
      sku: variant?.sku || product.sku,
      quantity: qty,
      unitPrice,
      costPrice,
      discount,
      taxAmount: lineTax,
      total: lineSub + lineTax,
      batchNumber: item.batchNumber,
      serialNo: item.serialNo,
      trackInventory: product.trackInventory,
    });
  }

  let discountAmount = Number(input.discountAmount ?? 0) || 0;

  // Loyalty redeem: convert points → currency discount using active program
  let redeemPoints = Math.max(0, Math.floor(Number(input.redeemPoints ?? 0) || 0));
  let loyaltyProgram: {
    id: string;
    pointsPerCurrency: unknown;
    redemptionRate: unknown;
    minRedeemPoints: number;
  } | null = null;
  let customerRow: {
    id: string;
    balance: unknown;
    creditLimit: unknown;
    loyaltyPoints: number;
  } | null = null;

  if (input.customerId) {
    customerRow = await prisma.customer.findFirst({
      where: { id: input.customerId, companyId: cid, deletedAt: null },
      select: { id: true, balance: true, creditLimit: true, loyaltyPoints: true },
    });
    if (!customerRow) throw new NotFoundError('Customer');

    loyaltyProgram = await prisma.loyaltyProgram.findFirst({
      where: { companyId: cid, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!loyaltyProgram) {
      loyaltyProgram = await prisma.loyaltyProgram.create({
        data: {
          companyId: cid,
          name: 'Default',
          pointsPerCurrency: 1,
          redemptionRate: 0.01,
          minRedeemPoints: 100,
          isActive: true,
        },
      });
    }

    if (redeemPoints > 0) {
      const minPts = Number(loyaltyProgram.minRedeemPoints || 0);
      if (redeemPoints < minPts) {
        throw new ValidationError(`Minimum ${minPts} loyalty points required to redeem`);
      }
      if (redeemPoints > Number(customerRow.loyaltyPoints || 0)) {
        throw new ValidationError(
          `Customer only has ${customerRow.loyaltyPoints} loyalty points`
        );
      }
      const rate = Number(loyaltyProgram.redemptionRate || 0.01);
      const redeemValue = roundMoney(redeemPoints * rate);
      discountAmount = roundMoney(discountAmount + redeemValue);
    }
  } else if (redeemPoints > 0) {
    throw new ValidationError('Select a customer to redeem loyalty points');
  }

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

  // Credit limit: unpaid portion must fit under remaining credit
  if (input.customerId && customerRow && paidAmount + 0.02 < total) {
    const newCredit = roundMoney(total - paidAmount);
    const limit = Number(customerRow.creditLimit || 0);
    const bal = Number(customerRow.balance || 0);
    if (limit > 0 && bal + newCredit > limit + 0.02) {
      const remaining = Math.max(0, roundMoney(limit - bal));
      throw new ValidationError(
        `Credit limit exceeded. Limit ${limit}, balance ${bal}, remaining credit ${remaining}. Collect at least ${roundMoney(total - remaining)} now.`
      );
    }
  }

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
                costPrice: li.costPrice,
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
              unitCost: li.costPrice,
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

        if (input.customerId) {
          // Credit balance for unpaid portion
          if (paidAmount < total) {
            await tx.customer.update({
              where: { id: input.customerId },
              data: { balance: { increment: total - paidAmount } },
            });
          }

          // Loyalty: earn points on paid amount, redeem if requested
          const ppc = Number(loyaltyProgram?.pointsPerCurrency ?? 1) || 1;
          const earnBase = Math.min(paidAmount, total);
          const earned = Math.max(0, Math.floor(earnBase * ppc));
          const pointsDelta = earned - redeemPoints;
          if (pointsDelta !== 0 || redeemPoints > 0) {
            await tx.customer.update({
              where: { id: input.customerId },
              data: { loyaltyPoints: { increment: pointsDelta } },
            });
          }
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

/** List closed/open shifts for end-of-day history */
export async function listShifts(
  companyId: string | null | undefined,
  opts?: { limit?: number; status?: string }
) {
  const cid = requireCompany(companyId);
  return prisma.shift.findMany({
    where: {
      companyId: cid,
      ...(opts?.status ? { status: opts.status } : {}),
    },
    orderBy: { openedAt: 'desc' },
    take: opts?.limit ?? 30,
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
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
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, imageUrl: true } },
        },
      },
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
    items: Array<{
      productId: string;
      quantity: unknown;
      unitPrice?: unknown;
      costPrice?: unknown;
      productName?: string;
    }>;
  },
  userId: string,
  notes: string,
  /** When set, only restore these product/qty pairs (partial refund) instead of full SALE movements */
  partialRestocks?: Array<{ productId: string; quantity: number; unitCost: number }>
) {
  type Restock = { productId: string; warehouseId: string; quantity: number; unitCost: number };
  const restocks: Restock[] = [];

  if (partialRestocks?.length) {
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
    // Prefer original SALE movement warehouse per product when available
    const saleMovements = await tx.stockMovement.findMany({
      where: { referenceId: sale.id, type: 'SALE', companyId: cid },
    });
    const whByProduct = new Map<string, string>();
    for (const m of saleMovements) {
      if (!whByProduct.has(m.productId)) whByProduct.set(m.productId, m.warehouseId);
    }
    if (!warehouseId && saleMovements[0]) warehouseId = saleMovements[0].warehouseId;
    if (!warehouseId) {
      throw new ValidationError('No warehouse available to restore stock');
    }
    for (const p of partialRestocks) {
      restocks.push({
        productId: p.productId,
        warehouseId: whByProduct.get(p.productId) || warehouseId,
        quantity: p.quantity,
        unitCost: p.unitCost,
      });
    }
  } else {
    const saleMovements = await tx.stockMovement.findMany({
      where: { referenceId: sale.id, type: 'SALE', companyId: cid },
    });

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
      // Fallback: use line items + sale warehouse (cost snapshot preferred over selling price)
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
        const unitCost =
          Number(item.costPrice) > 0
            ? Number(item.costPrice)
            : Number(product.costPrice) || Number(item.unitPrice) || 0;
        restocks.push({
          productId: item.productId,
          warehouseId,
          quantity: Number(item.quantity),
          unitCost,
        });
      }
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
  input?: {
    reason?: string;
    /** FULL (default) or PARTIAL line returns */
    mode?: 'FULL' | 'PARTIAL';
    items?: Array<{ saleItemId: string; quantity: number }>;
  }
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
  const mode = input?.mode || 'FULL';

  // Partial: return selected line quantities only
  if (mode === 'PARTIAL' && input?.items?.length) {
    const itemMap = new Map(sale.items.map((it) => [it.id, it]));
    const lineUpdates: Array<{
      id: string;
      newQty: number;
      newDiscount: number;
      newTax: number;
      newTotal: number;
      productId: string;
      returnQty: number;
      unitCost: number;
    }> = [];
    let refundTotal = 0;
    let refundSubtotal = 0;
    let refundTax = 0;
    let refundLineDiscount = 0;

    for (const line of input.items) {
      const src = itemMap.get(line.saleItemId);
      if (!src) throw new ValidationError('Invalid sale line for partial refund');
      const qty = Number(line.quantity);
      const max = Number(src.quantity);
      if (!Number.isFinite(qty) || qty <= 0 || qty > max + 0.0001) {
        throw new ValidationError(`Invalid return qty for ${src.productName || src.productId}`);
      }
      const ratio = max > 0 ? qty / max : 0;
      const lineTotal = ratio * Number(src.total);
      const lineTax = ratio * Number(src.taxAmount);
      const lineDisc = ratio * Number(src.discount);
      const lineSub = lineTotal - lineTax; // pre-tax portion of returned amount
      refundTotal += lineTotal;
      refundSubtotal += lineSub;
      refundTax += lineTax;
      refundLineDiscount += lineDisc;

      const unitCost = Number(src.costPrice) > 0 ? Number(src.costPrice) : 0;

      lineUpdates.push({
        id: src.id,
        newQty: Math.max(0, roundMoney(max - qty)),
        newDiscount: Math.max(0, roundMoney(Number(src.discount) - lineDisc)),
        newTax: Math.max(0, roundMoney(Number(src.taxAmount) - lineTax)),
        newTotal: Math.max(0, roundMoney(Number(src.total) - lineTotal)),
        productId: src.productId,
        returnQty: qty,
        unitCost,
      });
    }

    refundTotal = roundMoney(refundTotal);
    refundSubtotal = roundMoney(refundSubtotal);
    refundTax = roundMoney(refundTax);

    // Allocate order-level discount proportionally to returned pre-tax share
    const saleSubtotal = Number(sale.subtotal);
    const orderDiscShare =
      saleSubtotal > 0
        ? roundMoney((refundSubtotal / saleSubtotal) * Number(sale.discountAmount))
        : 0;

    return prisma.$transaction(async (tx) => {
      // Resolve missing unit costs from product master for restock movements
      for (const u of lineUpdates) {
        if (u.unitCost > 0) continue;
        const p = await tx.product.findUnique({
          where: { id: u.productId },
          select: { costPrice: true },
        });
        u.unitCost = Number(p?.costPrice || 0);
      }

      await restoreSaleInventory(
        tx,
        cid,
        {
          id: sale.id,
          saleNo: sale.saleNo,
          warehouseId: sale.warehouseId,
          items: [],
        },
        userId,
        `Partial refund: ${reason}`,
        lineUpdates.map((u) => ({
          productId: u.productId,
          quantity: u.returnQty,
          unitCost: u.unitCost,
        }))
      );

      for (const u of lineUpdates) {
        if (u.newQty <= 0.0001) {
          await tx.saleItem.delete({ where: { id: u.id } });
        } else {
          await tx.saleItem.update({
            where: { id: u.id },
            data: {
              quantity: u.newQty,
              discount: u.newDiscount,
              taxAmount: u.newTax,
              total: u.newTotal,
            },
          });
        }
      }

      const newPaid = Math.max(0, roundMoney(Number(sale.paidAmount) - refundTotal));
      const newTotal = Math.max(0, roundMoney(Number(sale.total) - refundTotal));
      const newSubtotal = Math.max(0, roundMoney(Number(sale.subtotal) - refundSubtotal));
      const newTax = Math.max(0, roundMoney(Number(sale.taxAmount) - refundTax));
      const newOrderDisc = Math.max(0, roundMoney(Number(sale.discountAmount) - orderDiscShare));

      const remainingItems = await tx.saleItem.count({ where: { saleId } });
      const fullyReturned = remainingItems === 0 || newTotal <= 0.0001;

      if (sale.shiftId) {
        await tx.shift.update({
          where: { id: sale.shiftId },
          data: {
            totalRefunds: { increment: refundTotal },
            totalSales: { decrement: refundTotal },
          },
        });
      }

      return tx.sale.update({
        where: { id: saleId },
        data: {
          status: fullyReturned ? 'RETURNED' : sale.status,
          paymentStatus: fullyReturned
            ? 'REFUNDED'
            : newPaid + 0.0001 < newTotal
              ? 'PARTIAL'
              : sale.paymentStatus,
          paidAmount: newPaid,
          total: newTotal,
          subtotal: newSubtotal,
          taxAmount: newTax,
          discountAmount: newOrderDisc,
          notes: [sale.notes, `Partial refund ${refundTotal}: ${reason}`]
            .filter(Boolean)
            .join(' | '),
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
