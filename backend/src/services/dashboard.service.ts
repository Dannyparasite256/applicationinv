import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { ForbiddenError } from '../utils/errors';
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  format,
} from 'date-fns';
import { activeSaleFilter, calculateProfit, type ProfitBreakdown } from '../utils/profit';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

function profitSlice(p: ProfitBreakdown) {
  return {
    sales: p.revenue,
    netRevenue: p.netRevenue,
    cogs: p.cogs,
    profit: p.grossProfit,
    grossMargin: p.grossMargin,
    tax: p.tax,
    saleCount: p.saleCount,
  };
}

export async function getDashboardStats(
  companyId: string | null | undefined,
  opts?: { from?: Date; to?: Date; branchId?: string }
) {
  const cid = requireCompany(companyId);
  const now = new Date();

  // Fixed calendar windows — always computed so daily/weekly/monthly cards stay accurate
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const calendarMonthStart = startOfMonth(now);
  const calendarMonthEnd = endOfMonth(now);

  // Optional filter range for charts / period KPIs (does NOT replace week/month windows).
  // Controllers pass full-day bounds via parseQueryDate — use them as-is.
  const periodStart = opts?.from ?? calendarMonthStart;
  const periodEnd = opts?.to ?? calendarMonthEnd;
  const hasCustomPeriod = Boolean(opts?.from || opts?.to);

  const saleWhere: Prisma.SaleWhereInput = {
    ...activeSaleFilter(cid),
    ...(opts?.branchId ? { branchId: opts.branchId } : {}),
  };
  const branchOpts = { branchId: opts?.branchId };

  const [
    profitToday,
    profitWeek,
    profitMonth,
    profitPeriod,
    lowStockCount,
    pendingOrders,
    customerCount,
    productCount,
    inventoryAgg,
    topProducts,
    topCustomers,
    recentSales,
    branchPerf,
    purchasesMonth,
  ] = await Promise.all([
    calculateProfit(cid, todayStart, todayEnd, branchOpts),
    calculateProfit(cid, weekStart, weekEnd, branchOpts),
    calculateProfit(cid, calendarMonthStart, calendarMonthEnd, branchOpts),
    // Selected range (Today / 7d / 30d / MTD / custom) — same engine as day/week/month
    calculateProfit(cid, periodStart, periodEnd, branchOpts),
    prisma.product
      .count({
        where: { companyId: cid, deletedAt: null, isActive: true, trackInventory: true },
      })
      .then(async () => {
        const products = await prisma.product.findMany({
          where: { companyId: cid, deletedAt: null, isActive: true, trackInventory: true },
          include: { stockLevels: true },
        });
        return products.filter(
          (p) =>
            p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0) <= Number(p.reorderLevel)
        ).length;
      }),
    prisma.purchaseOrder.count({
      where: {
        companyId: cid,
        status: { in: ['PENDING_APPROVAL', 'ORDERED', 'PARTIALLY_RECEIVED'] },
      },
    }),
    prisma.customer.count({ where: { companyId: cid, deletedAt: null, isActive: true } }),
    prisma.product.count({ where: { companyId: cid, deletedAt: null, isActive: true } }),
    prisma.stockLevel.findMany({
      where: { product: { companyId: cid, deletedAt: null } },
      include: { product: { select: { costPrice: true } } },
    }),
    prisma.saleItem.groupBy({
      by: ['productId', 'productName'],
      where: {
        sale: {
          ...activeSaleFilter(cid),
          saleDate: { gte: periodStart, lte: periodEnd },
          ...(opts?.branchId ? { branchId: opts.branchId } : {}),
        },
      },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 5,
    }),
    prisma.sale.groupBy({
      by: ['customerId'],
      where: {
        ...activeSaleFilter(cid),
        customerId: { not: null },
        saleDate: { gte: periodStart, lte: periodEnd },
        ...(opts?.branchId ? { branchId: opts.branchId } : {}),
      },
      _sum: { total: true },
      _count: true,
      orderBy: { _sum: { total: 'desc' } },
      take: 5,
    }),
    prisma.sale.findMany({
      where: { ...saleWhere },
      orderBy: { saleDate: 'desc' },
      take: 8,
      include: {
        customer: { select: { firstName: true, lastName: true, businessName: true } },
      },
    }),
    prisma.sale.groupBy({
      by: ['branchId'],
      where: {
        ...activeSaleFilter(cid),
        saleDate: { gte: periodStart, lte: periodEnd },
        ...(opts?.branchId ? { branchId: opts.branchId } : {}),
      },
      _sum: { total: true },
      _count: true,
    }),
    prisma.purchaseOrder.aggregate({
      where: {
        companyId: cid,
        deletedAt: null,
        createdAt: { gte: calendarMonthStart, lte: calendarMonthEnd },
        status: { not: 'CANCELLED' },
      },
      _sum: { total: true },
      _count: true,
    }),
  ]);

  const inventoryValue = inventoryAgg.reduce(
    (sum, row) => sum + Number(row.quantity) * Number(row.product.costPrice),
    0
  );

  // Last 14 days sales chart (lightweight aggregates — not full COGS per day)
  const chartDays = 14;
  const salesChart: Array<{ date: string; sales: number; count: number }> = [];
  for (let i = chartDays - 1; i >= 0; i--) {
    const d = subDays(now, i);
    const from = startOfDay(d);
    const to = endOfDay(d);
    const dayAgg = await prisma.sale.aggregate({
      where: { ...saleWhere, saleDate: { gte: from, lte: to } },
      _sum: { total: true },
      _count: true,
    });
    salesChart.push({
      date: format(d, 'MMM dd'),
      sales: Number(dayAgg._sum?.total || 0),
      count: typeof dayAgg._count === 'number' ? dayAgg._count : Number(dayAgg._count || 0),
    });
  }

  const customerIds = topCustomers.map((c) => c.customerId).filter(Boolean) as string[];
  const customers = await prisma.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, firstName: true, lastName: true, businessName: true, code: true },
  });
  const custMap = new Map(customers.map((c) => [c.id, c]));

  const branchIds = branchPerf.map((b) => b.branchId).filter(Boolean) as string[];
  const branches = await prisma.branch.findMany({
    where: { id: { in: branchIds } },
    select: { id: true, name: true },
  });
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  const countOf = (v: unknown) => (typeof v === 'number' ? v : Number(v || 0));

  const today = profitSlice(profitToday);
  const week = profitSlice(profitWeek);
  const month = profitSlice(profitMonth);
  const period = profitSlice(profitPeriod);

  return {
    kpis: {
      // Calendar day
      salesToday: today.sales,
      salesTodayCount: today.saleCount,
      profitToday: today.profit,
      cogsToday: today.cogs,
      marginToday: today.grossMargin,

      // Calendar week (Mon–Sun)
      salesWeek: week.sales,
      salesWeekCount: week.saleCount,
      profitWeek: week.profit,
      cogsWeek: week.cogs,
      marginWeek: week.grossMargin,

      // Calendar month
      salesMonth: month.sales,
      salesMonthCount: month.saleCount,
      profitMonth: month.profit,
      cogsMonth: month.cogs,
      marginMonth: month.grossMargin,

      // Selected filter range (Today / 7d / 30d / MTD / custom)
      periodSales: period.sales,
      periodSalesCount: period.saleCount,
      periodProfit: period.profit,
      periodCogs: period.cogs,
      periodMargin: period.grossMargin,
      periodNetRevenue: period.netRevenue,
      periodFrom: periodStart,
      periodTo: periodEnd,
      hasCustomPeriod,

      // Back-compat: main "Gross Profit" follows the selected range
      profit: period.profit,
      cogs: period.cogs,
      netRevenue: period.netRevenue,
      grossMargin: period.grossMargin,

      purchasesMonth: Number(purchasesMonth._sum?.total || 0),
      inventoryValue,
      lowStock: lowStockCount,
      pendingOrders,
      customers: customerCount,
      products: productCount,
      outstandingPayments: 0,
    },
    profits: {
      today,
      week,
      month,
      period,
    },
    salesChart,
    topProducts: topProducts.map((p) => ({
      productId: p.productId,
      name: p.productName,
      quantity: Number(p._sum?.quantity || 0),
      revenue: Number(p._sum?.total || 0),
    })),
    topCustomers: topCustomers.map((c) => {
      const cust = c.customerId ? custMap.get(c.customerId) : null;
      return {
        customerId: c.customerId,
        name: cust
          ? cust.businessName || `${cust.firstName || ''} ${cust.lastName || ''}`.trim()
          : 'Unknown',
        total: Number(c._sum?.total || 0),
        orders: countOf(c._count),
      };
    }),
    branchPerformance: branchPerf.map((b) => ({
      branchId: b.branchId,
      name: b.branchId ? branchMap.get(b.branchId) || 'Unassigned' : 'Unassigned',
      sales: Number(b._sum?.total || 0),
      orders: countOf(b._count),
    })),
    recentSales,
  };
}
