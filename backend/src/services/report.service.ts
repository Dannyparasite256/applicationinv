import ExcelJS from 'exceljs';
import { prisma } from '../config/database';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { endOfDay, startOfMonth, format } from 'date-fns';
import { calculateProfit } from '../utils/profit';

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
  const p = await calculateProfit(cid, from, to);
  return {
    from: p.from,
    to: p.to,
    /** Gross sales including tax (matches dashboard / sales totals) */
    revenue: p.revenue,
    /** Net sales excluding tax (used for gross profit base) */
    netRevenue: p.netRevenue,
    tax: p.tax,
    cogs: p.cogs,
    /** Gross profit = net revenue − COGS */
    grossProfit: p.grossProfit,
    grossMargin: p.grossMargin,
    expenses: p.expenses,
    netProfit: p.netProfit,
    netMargin: p.netMargin,
    purchases: p.purchases,
    saleCount: p.saleCount,
  };
}

/** Per-product profit for the period (qty sold, revenue, COGS, margin) */
export async function productProfitReport(
  companyId: string | null | undefined,
  from?: Date,
  to?: Date
) {
  const cid = requireCompany(companyId);
  const fromDate = from || startOfMonth(new Date());
  const toDate = to || endOfDay(new Date());

  const items = await prisma.saleItem.findMany({
    where: {
      sale: {
        companyId: cid,
        deletedAt: null,
        saleDate: { gte: fromDate, lte: toDate },
        status: { notIn: ['CANCELLED', 'RETURNED'] },
        paymentStatus: { notIn: ['REFUNDED', 'VOID'] },
      },
    },
    select: {
      productId: true,
      productName: true,
      sku: true,
      quantity: true,
      total: true,
      costPrice: true,
      taxAmount: true,
      product: { select: { costPrice: true, name: true, sku: true } },
    },
  });

  type Acc = {
    productId: string;
    name: string;
    sku: string;
    quantity: number;
    revenue: number;
    cogs: number;
  };
  const map = new Map<string, Acc>();
  for (const it of items) {
    const key = it.productId;
    const unitCost =
      Number(it.costPrice) > 0 ? Number(it.costPrice) : Number(it.product?.costPrice || 0);
    const qty = Number(it.quantity);
    // Net line revenue approx: total − tax
    const lineNet = Math.max(0, Number(it.total) - Number(it.taxAmount || 0));
    const cur = map.get(key) || {
      productId: key,
      name: it.productName || it.product?.name || 'Product',
      sku: it.sku || it.product?.sku || '',
      quantity: 0,
      revenue: 0,
      cogs: 0,
    };
    cur.quantity += qty;
    cur.revenue += lineNet;
    cur.cogs += unitCost * qty;
    map.set(key, cur);
  }

  const rows = Array.from(map.values())
    .map((r) => {
      const revenue = Math.round(r.revenue * 10000) / 10000;
      const cogs = Math.round(r.cogs * 10000) / 10000;
      const profit = Math.round((revenue - cogs) * 10000) / 10000;
      const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
      return {
        productId: r.productId,
        name: r.name,
        sku: r.sku,
        quantity: Math.round(r.quantity * 10000) / 10000,
        revenue,
        cogs,
        profit,
        margin,
      };
    })
    .sort((a, b) => b.profit - a.profit);

  return {
    from: fromDate,
    to: toDate,
    rows,
    totals: {
      quantity: rows.reduce((s, r) => s + r.quantity, 0),
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
      cogs: rows.reduce((s, r) => s + r.cogs, 0),
      profit: rows.reduce((s, r) => s + r.profit, 0),
    },
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

/** AR aging buckets from open invoices */
export async function arAgingReport(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  const now = new Date();
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId: cid,
      deletedAt: null,
      status: { notIn: ['PAID', 'VOID', 'CANCELLED'] },
    },
    include: {
      customer: {
        select: { id: true, code: true, firstName: true, lastName: true, businessName: true },
      },
    },
  });

  const buckets = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90p: 0,
  };
  const rows = invoices.map((inv) => {
    const due = inv.dueDate || inv.issuedAt || now;
    const days = Math.max(0, Math.floor((now.getTime() - new Date(due).getTime()) / 86400000));
    const bal = Math.max(0, Number(inv.total) - Number(inv.paidAmount));
    let bucket: keyof typeof buckets = 'current';
    if (days <= 0) bucket = 'current';
    else if (days <= 30) bucket = 'd1_30';
    else if (days <= 60) bucket = 'd31_60';
    else if (days <= 90) bucket = 'd61_90';
    else bucket = 'd90p';
    buckets[bucket] += bal;
    const name =
      inv.customer?.businessName ||
      `${inv.customer?.firstName || ''} ${inv.customer?.lastName || ''}`.trim() ||
      '—';
    return {
      invoiceNo: inv.invoiceNo,
      customer: name,
      customerCode: inv.customer?.code || '',
      balance: bal,
      daysPastDue: days,
      bucket,
      dueDate: due,
    };
  });

  return {
    asOf: now,
    buckets: {
      current: buckets.current,
      days1to30: buckets.d1_30,
      days31to60: buckets.d31_60,
      days61to90: buckets.d61_90,
      days90plus: buckets.d90p,
      total:
        buckets.current + buckets.d1_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90p,
    },
    rows: rows.sort((a, b) => b.balance - a.balance),
  };
}

export async function customerStatement(
  companyId: string | null | undefined,
  customerId: string,
  from?: Date,
  to?: Date
) {
  const cid = requireCompany(companyId);
  const fromDate = from || startOfMonth(new Date());
  const toDate = to || endOfDay(new Date());
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, companyId: cid, deletedAt: null },
  });
  if (!customer) throw new NotFoundError('Customer');

  const invoices = await prisma.invoice.findMany({
    where: {
      companyId: cid,
      customerId,
      deletedAt: null,
      issuedAt: { gte: fromDate, lte: toDate },
    },
    orderBy: { issuedAt: 'asc' },
    select: {
      invoiceNo: true,
      issuedAt: true,
      dueDate: true,
      total: true,
      paidAmount: true,
      status: true,
    },
  });

  const payments = await prisma.payment.findMany({
    where: {
      companyId: cid,
      invoice: { customerId },
      paidAt: { gte: fromDate, lte: toDate },
    },
    orderBy: { paidAt: 'asc' },
    select: {
      amount: true,
      paidAt: true,
      method: true,
      reference: true,
      invoice: { select: { invoiceNo: true } },
    },
  });

  return {
    customer: {
      id: customer.id,
      code: customer.code,
      name:
        customer.businessName ||
        `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
      phone: customer.phone,
      email: customer.email,
      balance: Number(customer.balance),
    },
    from: fromDate,
    to: toDate,
    invoices: invoices.map((i) => ({
      invoiceNo: i.invoiceNo,
      issuedAt: i.issuedAt,
      dueDate: i.dueDate,
      status: i.status,
      total: Number(i.total),
      paidAmount: Number(i.paidAmount),
      balance: Math.max(0, Number(i.total) - Number(i.paidAmount)),
    })),
    payments: payments.map((p) => ({
      amount: Number(p.amount),
      paidAt: p.paidAt,
      method: p.method,
      reference: p.reference,
      invoiceNo: p.invoice?.invoiceNo,
    })),
  };
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

export async function customersCsv(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  const rows = await prisma.customer.findMany({
    where: { companyId: cid, deletedAt: null },
    orderBy: { code: 'asc' },
  });
  return toCsv(
    rows.map((c) => ({
      code: c.code,
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      businessName: c.businessName || '',
      phone: c.phone || '',
      email: c.email || '',
      balance: Number(c.balance),
      creditLimit: Number(c.creditLimit),
      loyaltyPoints: c.loyaltyPoints,
    }))
  );
}

export async function productsCsv(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  const rows = await prisma.product.findMany({
    where: { companyId: cid, deletedAt: null },
    include: { stockLevels: true },
    orderBy: { name: 'asc' },
  });
  return toCsv(
    rows.map((p) => {
      const qty = p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0);
      return {
        sku: p.sku,
        name: p.name,
        costPrice: Number(p.costPrice),
        sellingPrice: Number(p.sellingPrice),
        quantity: qty,
        reorderLevel: Number(p.reorderLevel),
        isActive: p.isActive ? 'YES' : 'NO',
      };
    })
  );
}

export async function expensesCsv(
  companyId: string | null | undefined,
  from?: Date,
  to?: Date
) {
  const { listExpenses } = await import('./expense.service');
  const report = await listExpenses(companyId, { from, to, limit: 5000 });
  const cur = report.baseCurrency || report.currency || 'USD';
  return toCsv(
    report.rows.map((r) => ({
      date: new Date(r.expenseDate).toISOString().slice(0, 10),
      category: r.category,
      description: r.description || '',
      amount: Number(r.amount),
      currency: cur,
      paymentMethod: r.paymentMethod || '',
      reference: r.reference || '',
    }))
  );
}

/** Combined backup pack as plain text sections (easy download without zip deps) */
export async function fullBackupText(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  const [customers, products, sales, inventory] = await Promise.all([
    customersCsv(cid),
    productsCsv(cid),
    salesCsv(cid),
    exportInventoryExcel(cid).then(() => inventoryReport(cid)),
  ]);
  const invCsv = toCsv(
    inventory.rows.map((r) => ({
      sku: r.sku,
      name: r.name,
      quantity: r.quantity,
      costPrice: r.costPrice,
      sellingPrice: r.sellingPrice,
      value: r.value,
    }))
  );
  return [
    '=== CUSTOMERS ===',
    customers,
    '',
    '=== PRODUCTS ===',
    products,
    '',
    '=== SALES (MTD default) ===',
    sales,
    '',
    '=== INVENTORY ===',
    invCsv,
  ].join('\n');
}
