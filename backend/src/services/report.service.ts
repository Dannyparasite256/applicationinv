import ExcelJS from 'exceljs';
import { prisma } from '../config/database';
import { ForbiddenError } from '../utils/errors';
import { startOfDay, endOfDay, startOfMonth, endOfMonth, format } from 'date-fns';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

export async function salesReport(
  companyId: string | null | undefined,
  from?: Date,
  to?: Date
) {
  const cid = requireCompany(companyId);
  const fromDate = from || startOfMonth(new Date());
  const toDate = to || endOfDay(new Date());

  const sales = await prisma.sale.findMany({
    where: {
      companyId: cid,
      deletedAt: null,
      saleDate: { gte: fromDate, lte: toDate },
      // Exclude voided / refunded so reports match dashboard after delete/refund
      status: { notIn: ['CANCELLED', 'RETURNED'] },
      paymentStatus: { notIn: ['REFUNDED', 'VOID'] },
    },
    include: {
      customer: { select: { firstName: true, lastName: true, businessName: true, code: true } },
      cashier: { select: { firstName: true, lastName: true } },
      items: true,
    },
    orderBy: { saleDate: 'desc' },
  });

  const totals = sales.reduce(
    (acc, s) => {
      acc.count += 1;
      acc.subtotal += Number(s.subtotal);
      acc.tax += Number(s.taxAmount);
      acc.discount += Number(s.discountAmount);
      acc.total += Number(s.total);
      acc.paid += Number(s.paidAmount);
      return acc;
    },
    { count: 0, subtotal: 0, tax: 0, discount: 0, total: 0, paid: 0 }
  );

  return { from: fromDate, to: toDate, totals, sales };
}

export async function inventoryReport(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  const products = await prisma.product.findMany({
    where: { companyId: cid, deletedAt: null, trackInventory: true },
    include: {
      stockLevels: { include: { warehouse: true } },
      category: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });

  const rows = products.map((p) => {
    const qty = p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0);
    const value = qty * Number(p.costPrice);
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category?.name || '',
      costPrice: Number(p.costPrice),
      sellingPrice: Number(p.sellingPrice),
      quantity: qty,
      value,
      reorderLevel: Number(p.reorderLevel),
      lowStock: qty <= Number(p.reorderLevel),
      warehouses: p.stockLevels.map((l) => ({
        warehouse: l.warehouse.name,
        quantity: Number(l.quantity),
      })),
    };
  });

  return {
    totalSkus: rows.length,
    totalUnits: rows.reduce((s, r) => s + r.quantity, 0),
    totalValue: rows.reduce((s, r) => s + r.value, 0),
    lowStockCount: rows.filter((r) => r.lowStock).length,
    rows,
  };
}

export async function profitReport(companyId: string | null | undefined, from?: Date, to?: Date) {
  const cid = requireCompany(companyId);
  const fromDate = from || startOfMonth(new Date());
  const toDate = to || endOfDay(new Date());

  const saleItems = await prisma.saleItem.findMany({
    where: {
      sale: {
        companyId: cid,
        deletedAt: null,
        saleDate: { gte: fromDate, lte: toDate },
        status: { notIn: ['CANCELLED', 'RETURNED'] },
        paymentStatus: { notIn: ['REFUNDED', 'VOID'] },
      },
    },
    include: { product: { select: { costPrice: true, name: true } } },
  });

  let revenue = 0;
  let cogs = 0;
  for (const item of saleItems) {
    revenue += Number(item.total);
    cogs += Number(item.product.costPrice) * Number(item.quantity);
  }

  const purchases = await prisma.purchaseOrder.aggregate({
    where: {
      companyId: cid,
      deletedAt: null,
      createdAt: { gte: fromDate, lte: toDate },
      status: { not: 'CANCELLED' },
    },
    _sum: { total: true },
  });

  return {
    from: fromDate,
    to: toDate,
    revenue,
    cogs,
    grossProfit: revenue - cogs,
    grossMargin: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0,
    purchases: Number(purchases._sum.total || 0),
  };
}

export async function customerBalances(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  return prisma.customer.findMany({
    where: { companyId: cid, deletedAt: null, balance: { not: 0 } },
    orderBy: { balance: 'desc' },
    select: {
      id: true,
      code: true,
      firstName: true,
      lastName: true,
      businessName: true,
      phone: true,
      balance: true,
      creditLimit: true,
    },
  });
}

export async function exportSalesExcel(
  companyId: string | null | undefined,
  from?: Date,
  to?: Date
): Promise<Buffer> {
  const report = await salesReport(companyId, from, to);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Enterprise IMS';
  const sheet = wb.addWorksheet('Sales');
  sheet.columns = [
    { header: 'Sale #', key: 'saleNo', width: 18 },
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Customer', key: 'customer', width: 24 },
    { header: 'Cashier', key: 'cashier', width: 18 },
    { header: 'Subtotal', key: 'subtotal', width: 12 },
    { header: 'Tax', key: 'tax', width: 10 },
    { header: 'Discount', key: 'discount', width: 10 },
    { header: 'Total', key: 'total', width: 12 },
    { header: 'Paid', key: 'paid', width: 12 },
    { header: 'Payment', key: 'payment', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const s of report.sales) {
    sheet.addRow({
      saleNo: s.saleNo,
      date: format(s.saleDate, 'yyyy-MM-dd HH:mm'),
      customer:
        s.customer?.businessName ||
        `${s.customer?.firstName || ''} ${s.customer?.lastName || ''}`.trim() ||
        'Walk-in',
      cashier: s.cashier ? `${s.cashier.firstName} ${s.cashier.lastName}` : '',
      subtotal: Number(s.subtotal),
      tax: Number(s.taxAmount),
      discount: Number(s.discountAmount),
      total: Number(s.total),
      paid: Number(s.paidAmount),
      payment: s.paymentMethod,
      status: s.paymentStatus,
    });
  }

  sheet.addRow({});
  sheet.addRow({
    saleNo: 'TOTALS',
    total: report.totals.total,
    paid: report.totals.paid,
    tax: report.totals.tax,
    discount: report.totals.discount,
    subtotal: report.totals.subtotal,
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function exportInventoryExcel(companyId: string | null | undefined): Promise<Buffer> {
  const report = await inventoryReport(companyId);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Inventory');
  sheet.columns = [
    { header: 'SKU', key: 'sku', width: 14 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Qty', key: 'quantity', width: 10 },
    { header: 'Cost', key: 'costPrice', width: 10 },
    { header: 'Price', key: 'sellingPrice', width: 10 },
    { header: 'Value', key: 'value', width: 12 },
    { header: 'Reorder', key: 'reorderLevel', width: 10 },
    { header: 'Low Stock', key: 'lowStock', width: 10 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const r of report.rows) {
    sheet.addRow({ ...r, lowStock: r.lowStock ? 'YES' : 'NO' });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

export async function salesCsv(companyId: string | null | undefined, from?: Date, to?: Date) {
  const report = await salesReport(companyId, from, to);
  return toCsv(
    report.sales.map((s) => ({
      saleNo: s.saleNo,
      date: s.saleDate.toISOString(),
      total: Number(s.total),
      paid: Number(s.paidAmount),
      paymentMethod: s.paymentMethod,
      paymentStatus: s.paymentStatus,
    }))
  );
}
