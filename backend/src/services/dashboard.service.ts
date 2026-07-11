import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
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

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

/** Sales that count toward revenue / profit (excludes deleted, cancelled, refunded/returned). */
function activeSaleFilter(companyId: string): Prisma.SaleWhereInput {
  return {
    companyId,
    deletedAt: null,
    status: { notIn: [OrderStatus.CANCELLED, OrderStatus.RETURNED] },
    paymentStatus: { notIn: [PaymentStatus.REFUNDED, PaymentStatus.VOID] },
  };
}

export async function getDashboardStats(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const saleWhere = activeSaleFilter(cid);

  const [
    salesToday,
    salesWeek,
    salesMonth,
    purchasesMonth,
    lowStockCount,
    pendingOrders,
    customerCount,
    productCount,
    inventoryAgg,
    topProducts,
    topCustomers,
    recentSales,
    branchPerf,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { ...saleWhere, saleDate: { gte: todayStart, lte: todayEnd } },
      _sum: { total: true, paidAmount: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { ...saleWhere, saleDate: { gte: weekStart, lte: weekEnd } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { ...saleWhere, saleDate: { gte: monthStart, lte: monthEnd } },
      _sum: { total: true, taxAmount: true, discountAmount: true },
      _count: true,
    }),
    prisma.purchaseOrder.aggregate({
      where: {
        companyId: cid,
        deletedAt: null,
        createdAt: { gte: monthStart, lte: monthEnd },
        status: { not: 'CANCELLED' },
      },
      _sum: { total: true },
      _count: true,
    }),
    prisma.product.count({
      where: { companyId: cid, deletedAt: null, isActive: true, trackInventory: true },
    }).then(async () => {
      const products = await prisma.product.findMany({
        where: { companyId: cid, deletedAt: null, isActive: true, trackInventory: true },
        include: { stockLevels: true },
      });
      return products.filter(
        (p) => p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0) <= Number(p.reorderLevel)
      ).length;
    }),
    prisma.purchaseOrder.count({
      where: { companyId: cid, status: { in: ['PENDING_APPROVAL', 'ORDERED', 'PARTIALLY_RECEIVED'] } },
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
          saleDate: { gte: monthStart },
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
        saleDate: { gte: monthStart },
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
        saleDate: { gte: monthStart },
      },
      _sum: { total: true },
      _count: true,
    }),
  ]);

  const inventoryValue = inventoryAgg.reduce(
    (sum, row) => sum + Number(row.quantity) * Number(row.product.costPrice),
    0
  );

  // Last 14 days sales chart
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

  // Resolve top customers names
  const customerIds = topCustomers.map((c) => c.customerId).filter(Boolean) as string[];
  const customers = await prisma.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, firstName: true, lastName: true, businessName: true, code: true },
  });
  const custMap = new Map(customers.map((c) => [c.id, c]));

  // Branch names
  const branchIds = branchPerf.map((b) => b.branchId).filter(Boolean) as string[];
  const branches = await prisma.branch.findMany({
    where: { id: { in: branchIds } },
    select: { id: true, name: true },
  });
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  const revenue = Number(salesMonth._sum?.total || 0);
  const cogsEstimate = revenue * 0.6; // simplified until full COGS posting
  const profit = revenue - cogsEstimate - Number(purchasesMonth._sum?.total || 0) * 0;

  const countOf = (v: unknown) => (typeof v === 'number' ? v : Number(v || 0));

  return {
    kpis: {
      salesToday: Number(salesToday._sum?.total || 0),
      salesTodayCount: countOf(salesToday._count),
      salesWeek: Number(salesWeek._sum?.total || 0),
      salesMonth: revenue,
      salesMonthCount: countOf(salesMonth._count),
      purchasesMonth: Number(purchasesMonth._sum?.total || 0),
      profit,
      inventoryValue,
      lowStock: lowStockCount,
      pendingOrders,
      customers: customerCount,
      products: productCount,
      outstandingPayments: 0,
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
