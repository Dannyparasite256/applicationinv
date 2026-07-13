import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { endOfDay, startOfMonth } from 'date-fns';

/** Sales that count toward revenue / profit (excludes deleted, cancelled, refunded/returned). */
export function activeSaleFilter(companyId: string): Prisma.SaleWhereInput {
  return {
    companyId,
    deletedAt: null,
    status: { notIn: [OrderStatus.CANCELLED, OrderStatus.RETURNED] },
    paymentStatus: { notIn: [PaymentStatus.REFUNDED, PaymentStatus.VOID] },
  };
}

export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

export type ProfitBreakdown = {
  from: Date;
  to: Date;
  /** Net sales (subtotal − order discounts), excluding tax */
  netRevenue: number;
  /** Tax collected on active sales */
  tax: number;
  /** Gross sales total including tax (matches Sale.total / dashboard sales) */
  revenue: number;
  /** Cost of goods sold from sale-line cost snapshots (falls back to product cost) */
  cogs: number;
  /** Gross profit on net sales: netRevenue − cogs */
  grossProfit: number;
  /** Gross margin % on net revenue */
  grossMargin: number;
  /** Purchase order totals in period (reference only; not deducted from gross profit) */
  purchases: number;
  saleCount: number;
};

/**
 * Accurate profit for a company/period.
 *
 * - Revenue uses Sale.total (includes tax, after order-level discounts) so it matches
 *   sales reports and dashboard KPIs.
 * - Net revenue excludes tax so margin is not distorted by VAT/sales tax.
 * - COGS uses SaleItem.costPrice snapshot × quantity (fallback: live product.costPrice).
 * - Partial refunds reduce Sale.total and line qty/totals, so both sides stay aligned.
 */
export async function calculateProfit(
  companyId: string,
  from?: Date,
  to?: Date,
  opts?: { branchId?: string }
): Promise<ProfitBreakdown> {
  // Callers should pass full-day bounds (startOfDay / endOfDay or parseQueryDate)
  const fromDate = from || startOfMonth(new Date());
  const toDate = to || endOfDay(new Date());

  const saleWhere: Prisma.SaleWhereInput = {
    ...activeSaleFilter(companyId),
    saleDate: { gte: fromDate, lte: toDate },
    ...(opts?.branchId ? { branchId: opts.branchId } : {}),
  };

  const [salesAgg, saleItems, purchases] = await Promise.all([
    prisma.sale.aggregate({
      where: saleWhere,
      _sum: {
        total: true,
        subtotal: true,
        taxAmount: true,
        discountAmount: true,
      },
      _count: true,
    }),
    prisma.saleItem.findMany({
      where: { sale: saleWhere },
      select: {
        quantity: true,
        costPrice: true,
        product: { select: { costPrice: true } },
      },
    }),
    prisma.purchaseOrder.aggregate({
      where: {
        companyId,
        deletedAt: null,
        createdAt: { gte: fromDate, lte: toDate },
        status: { not: 'CANCELLED' },
      },
      _sum: { total: true },
    }),
  ]);

  const revenue = roundMoney(Number(salesAgg._sum?.total || 0));
  const tax = roundMoney(Number(salesAgg._sum?.taxAmount || 0));
  const subtotal = Number(salesAgg._sum?.subtotal || 0);
  const orderDiscount = Number(salesAgg._sum?.discountAmount || 0);
  // Net sales = pre-tax merchandise after line + order discounts
  const netRevenue = roundMoney(Math.max(0, subtotal - orderDiscount));

  let cogs = 0;
  for (const item of saleItems) {
    const unitCost =
      Number(item.costPrice) > 0
        ? Number(item.costPrice)
        : Number(item.product?.costPrice || 0);
    cogs += unitCost * Number(item.quantity);
  }
  cogs = roundMoney(cogs);

  const grossProfit = roundMoney(netRevenue - cogs);
  const grossMargin = netRevenue > 0 ? roundMoney((grossProfit / netRevenue) * 100) : 0;
  const saleCount =
    typeof salesAgg._count === 'number' ? salesAgg._count : Number(salesAgg._count || 0);

  return {
    from: fromDate,
    to: toDate,
    netRevenue,
    tax,
    revenue,
    cogs,
    grossProfit,
    grossMargin,
    purchases: roundMoney(Number(purchases._sum?.total || 0)),
    saleCount,
  };
}

/**
 * Weighted-average unit cost after receiving stock.
 * oldQty is on-hand before this receipt.
 */
export function weightedAverageCost(
  oldQty: number,
  oldUnitCost: number,
  receivedQty: number,
  receivedUnitCost: number
): number {
  const oq = Math.max(0, Number(oldQty) || 0);
  const rq = Math.max(0, Number(receivedQty) || 0);
  const oc = Math.max(0, Number(oldUnitCost) || 0);
  const rc = Math.max(0, Number(receivedUnitCost) || 0);
  if (rq <= 0) return roundMoney(oc);
  if (oq <= 0) return roundMoney(rc);
  return roundMoney((oq * oc + rq * rc) / (oq + rq));
}
