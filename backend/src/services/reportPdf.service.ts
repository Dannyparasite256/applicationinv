/**
 * Polished multi-page PDF reports with column/row tables (PDFKit).
 */
import PDFDocument from 'pdfkit';
import { format } from 'date-fns';
import { ForbiddenError } from '../utils/errors';
import * as reportService from './report.service';
import { drawBrandedHeader, drawPageFooters, loadBrandMeta } from './pdfBrand';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

const COLORS = {
  primary: '#4f46e5',
  primaryDark: '#312e81',
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  soft: '#f8fafc',
  headerBg: '#eef2ff',
  white: '#ffffff',
  success: '#059669',
};

type Col = { label: string; x: number; w: number; align?: 'left' | 'right' | 'center' };

function money(n: unknown, currency = 'USD') {
  const v = Number(n as number | string) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

function streamToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

async function companyMeta(companyId: string) {
  const b = await loadBrandMeta(companyId);
  return {
    name: b.name,
    email: b.email,
    phone: b.phone,
    currency: b.currency,
    location: b.address,
    brand: b,
  };
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  pageW: number,
  meta: { brand: Awaited<ReturnType<typeof loadBrandMeta>> },
  title: string,
  subtitle: string
) {
  return drawBrandedHeader(doc, pageW, meta.brand, title, subtitle);
}

function drawTableHeader(doc: PDFKit.PDFDocument, cols: Col[], y: number, rowH = 20) {
  const left = cols[0].x;
  const right = cols[cols.length - 1].x + cols[cols.length - 1].w;
  doc.save();
  doc.rect(left, y, right - left, rowH).fill(COLORS.headerBg);
  doc.fillColor(COLORS.primaryDark).font('Helvetica-Bold').fontSize(7.5);
  for (const c of cols) {
    doc.text(c.label, c.x + 3, y + 6, { width: c.w - 6, align: c.align || 'left' });
  }
  doc
    .strokeColor(COLORS.line)
    .lineWidth(0.6)
    .moveTo(left, y + rowH)
    .lineTo(right, y + rowH)
    .stroke();
  doc.restore();
  return y + rowH;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  cols: Col[],
  cells: string[],
  y: number,
  opts?: { alt?: boolean; bold?: boolean; fontSize?: number; rowH?: number }
) {
  const left = cols[0].x;
  const right = cols[cols.length - 1].x + cols[cols.length - 1].w;
  const rowH = opts?.rowH ?? 16;
  doc.save();
  if (opts?.alt) doc.rect(left, y, right - left, rowH).fill(COLORS.soft);
  doc
    .fillColor(COLORS.ink)
    .font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(opts?.fontSize ?? 7.5);
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    doc.text(cells[i] ?? '', c.x + 3, y + 4, {
      width: c.w - 6,
      align: c.align || 'left',
      lineBreak: false,
      ellipsis: true,
    });
  }
  doc
    .strokeColor(COLORS.line)
    .lineWidth(0.35)
    .moveTo(left, y + rowH)
    .lineTo(right, y + rowH)
    .stroke();
  doc.restore();
  return y + rowH;
}

function ensureSpace(
  doc: PDFKit.PDFDocument,
  y: number,
  need: number,
  pageH: number,
  marginBottom: number,
  redrawHeader: () => number
): number {
  if (y + need <= pageH - marginBottom) return y;
  doc.addPage();
  return redrawHeader();
}

function drawFooter(doc: PDFKit.PDFDocument, pageW: number, pageH: number) {
  drawPageFooters(doc, pageW, pageH);
}

export async function salesReportPdf(
  companyId: string | null | undefined,
  from?: Date,
  to?: Date
): Promise<Buffer> {
  const cid = requireCompany(companyId);
  const meta = await companyMeta(cid);
  const report = await reportService.salesReport(cid, from, to);
  const cur = meta.currency;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 40,
    bufferPages: true,
    info: { Title: 'Sales Report', Author: meta.name },
  });
  const pageW = doc.page.width;
  const pageH = doc.page.height;

  const cols: Col[] = [
    { label: 'Date', x: 40, w: 78 },
    { label: 'Sale #', x: 118, w: 72 },
    { label: 'Customer', x: 190, w: 110 },
    { label: 'Cashier', x: 300, w: 80 },
    { label: 'Subtotal', x: 380, w: 62, align: 'right' },
    { label: 'Tax', x: 442, w: 50, align: 'right' },
    { label: 'Disc.', x: 492, w: 50, align: 'right' },
    { label: 'Total', x: 542, w: 62, align: 'right' },
    { label: 'Paid', x: 604, w: 62, align: 'right' },
    { label: 'Status', x: 666, w: 90 },
  ];

  const subtitle = `Period ${format(report.from, 'dd MMM yyyy')} – ${format(report.to, 'dd MMM yyyy')}  ·  ${report.totals.count} sales  ·  ${cur}`;

  const paintHeader = () => {
    let y = drawHeader(doc, pageW, meta, 'Sales Report', subtitle);
    return drawTableHeader(doc, cols, y);
  };

  let y = paintHeader();
  let i = 0;
  for (const s of report.sales) {
    y = ensureSpace(doc, y, 18, pageH, 40, () => paintHeader());
    const customer =
      s.customer?.businessName ||
      `${s.customer?.firstName || ''} ${s.customer?.lastName || ''}`.trim() ||
      'Walk-in';
    const cashier = s.cashier
      ? `${s.cashier.firstName || ''} ${s.cashier.lastName || ''}`.trim()
      : '—';
    y = drawTableRow(
      doc,
      cols,
      [
        format(s.saleDate, 'yyyy-MM-dd HH:mm'),
        s.saleNo,
        customer,
        cashier,
        money(s.subtotal, cur),
        money(s.taxAmount, cur),
        money(s.discountAmount, cur),
        money(s.total, cur),
        money(s.paidAmount, cur),
        `${s.paymentStatus || ''} / ${s.status || ''}`,
      ],
      y,
      { alt: i % 2 === 1 }
    );
    i++;
  }

  y = ensureSpace(doc, y, 50, pageH, 40, () => paintHeader());
  y += 10;
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9).text('Totals', 40, y);
  y += 14;
  const totals = [
    ['Sales count', String(report.totals.count)],
    ['Subtotal', money(report.totals.subtotal, cur)],
    ['Tax', money(report.totals.tax, cur)],
    ['Discount', money(report.totals.discount, cur)],
    ['Grand total', money(report.totals.total, cur)],
    ['Paid', money(report.totals.paid, cur)],
  ];
  for (const [label, val] of totals) {
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(label, 40, y, { width: 120 });
    doc.font('Helvetica-Bold').fillColor(COLORS.ink).text(val, 160, y, { width: 140 });
    y += 13;
  }

  if (!report.sales.length) {
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text('No sales in this period.', 40, y + 8);
  }

  drawFooter(doc, pageW, pageH);
  return streamToBuffer(doc);
}

export async function inventoryReportPdf(companyId: string | null | undefined): Promise<Buffer> {
  const cid = requireCompany(companyId);
  const meta = await companyMeta(cid);
  const report = await reportService.inventoryReport(cid);
  const cur = meta.currency;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 40,
    bufferPages: true,
    info: { Title: 'Inventory Valuation', Author: meta.name },
  });
  const pageW = doc.page.width;
  const pageH = doc.page.height;

  const cols: Col[] = [
    { label: 'SKU', x: 40, w: 70 },
    { label: 'Product', x: 110, w: 160 },
    { label: 'Category', x: 270, w: 90 },
    { label: 'Qty', x: 360, w: 50, align: 'right' },
    { label: 'Cost', x: 410, w: 70, align: 'right' },
    { label: 'Sell', x: 480, w: 70, align: 'right' },
    { label: 'Value', x: 550, w: 80, align: 'right' },
    { label: 'Reorder', x: 630, w: 50, align: 'right' },
    { label: 'Status', x: 680, w: 70 },
  ];

  const subtitle = `${report.totalSkus} SKUs  ·  ${report.totalUnits} units  ·  Value ${money(report.totalValue, cur)}  ·  Low stock ${report.lowStockCount}`;

  const paintHeader = () => {
    let y = drawHeader(doc, pageW, meta, 'Inventory Valuation', subtitle);
    return drawTableHeader(doc, cols, y);
  };

  let y = paintHeader();
  let i = 0;
  for (const r of report.rows) {
    y = ensureSpace(doc, y, 18, pageH, 40, () => paintHeader());
    y = drawTableRow(
      doc,
      cols,
      [
        r.sku,
        r.name,
        r.category || '—',
        String(r.quantity),
        money(r.costPrice, cur),
        money(r.sellingPrice, cur),
        money(r.value, cur),
        String(r.reorderLevel),
        r.lowStock ? 'LOW' : 'OK',
      ],
      y,
      { alt: i % 2 === 1, bold: r.lowStock }
    );
    i++;
  }

  y = ensureSpace(doc, y, 40, pageH, 40, () => paintHeader());
  y += 12;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text('Summary', 40, y);
  y += 14;
  [
    ['Total SKUs', String(report.totalSkus)],
    ['Total units', String(report.totalUnits)],
    ['Inventory value', money(report.totalValue, cur)],
    ['Low stock items', String(report.lowStockCount)],
  ].forEach(([label, val]) => {
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(label, 40, y, { width: 120 });
    doc.font('Helvetica-Bold').fillColor(COLORS.ink).text(val, 160, y);
    y += 13;
  });

  if (!report.rows.length) {
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text('No inventory products.', 40, y + 8);
  }

  drawFooter(doc, pageW, pageH);
  return streamToBuffer(doc);
}

export async function profitReportPdf(
  companyId: string | null | undefined,
  from?: Date,
  to?: Date
): Promise<Buffer> {
  const cid = requireCompany(companyId);
  const meta = await companyMeta(cid);
  const report = await reportService.profitReport(cid, from, to);
  const cur = meta.currency;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margin: 48,
    bufferPages: true,
    info: { Title: 'Profit & Loss', Author: meta.name },
  });
  const pageW = doc.page.width;
  const pageH = doc.page.height;

  const subtitle = `Period ${format(report.from, 'dd MMM yyyy')} – ${format(report.to, 'dd MMM yyyy')}  ·  ${cur}`;
  let y = drawHeader(doc, pageW, meta, 'Profit & Loss', subtitle);

  const cols: Col[] = [
    { label: 'Line item', x: 48, w: 280 },
    { label: 'Amount', x: 328, w: 120, align: 'right' },
    { label: 'Notes', x: 448, w: 100 },
  ];
  y = drawTableHeader(doc, cols, y);

  const netRev = Number((report as { netRevenue?: number }).netRevenue ?? report.revenue);
  const taxAmt = Number((report as { tax?: number }).tax ?? 0);
  const expenses = Number((report as { expenses?: number }).expenses ?? 0);
  const netProfit = Number((report as { netProfit?: number }).netProfit ?? report.grossProfit);
  const netMargin = Number((report as { netMargin?: number }).netMargin ?? report.grossMargin);
  const rows: Array<[string, string, string, boolean?]> = [
    ['Gross sales (incl. tax)', money(report.revenue, cur), '', false],
    ['Tax collected', money(taxAmt, cur), '', false],
    ['Net sales (ex-tax)', money(netRev, cur), '', false],
    ['Cost of goods sold (COGS)', money(report.cogs, cur), 'At sale cost', false],
    ['Gross profit', money(report.grossProfit, cur), `${report.grossMargin.toFixed(1)}% margin`, false],
    ['Operating expenses', money(expenses, cur), '', false],
    ['Net profit', money(netProfit, cur), `${netMargin.toFixed(1)}% margin`, true],
    ['Purchases (period)', money(report.purchases, cur), 'PO totals', false],
  ];

  rows.forEach((r, i) => {
    y = drawTableRow(doc, cols, [r[0], r[1], r[2]], y, { alt: i % 2 === 1, bold: !!r[3], rowH: 22 });
  });

  y += 20;
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(
      'Gross profit = Net sales − COGS. COGS uses unit cost saved on each sale line (not a % estimate). Purchases are shown for reference and are not deducted again from gross profit.',
      48,
      y,
      { width: pageW - 96 }
    );

  drawFooter(doc, pageW, pageH);
  return streamToBuffer(doc);
}

export async function customerBalancesPdf(companyId: string | null | undefined): Promise<Buffer> {
  const cid = requireCompany(companyId);
  const meta = await companyMeta(cid);
  const rows = await reportService.customerBalances(cid);
  const cur = meta.currency;
  const total = rows.reduce((s, r) => s + Number(r.balance || 0), 0);

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margin: 48,
    bufferPages: true,
    info: { Title: 'Customer Balances', Author: meta.name },
  });
  const pageW = doc.page.width;
  const pageH = doc.page.height;

  const cols: Col[] = [
    { label: 'Code', x: 48, w: 70 },
    { label: 'Customer', x: 118, w: 180 },
    { label: 'Phone', x: 298, w: 90 },
    { label: 'Balance', x: 388, w: 90, align: 'right' },
    { label: 'Credit limit', x: 478, w: 80, align: 'right' },
  ];

  const subtitle = `${rows.length} customers with balance  ·  Outstanding ${money(total, cur)}`;

  const paintHeader = () => {
    let y = drawHeader(doc, pageW, meta, 'Customer Balances (AR)', subtitle);
    return drawTableHeader(doc, cols, y);
  };

  let y = paintHeader();
  let i = 0;
  for (const r of rows) {
    y = ensureSpace(doc, y, 18, pageH, 40, () => paintHeader());
    const name =
      r.businessName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || '—';
    y = drawTableRow(
      doc,
      cols,
      [
        r.code || '—',
        name,
        r.phone || '—',
        money(r.balance, cur),
        r.creditLimit != null ? money(r.creditLimit, cur) : '—',
      ],
      y,
      { alt: i % 2 === 1 }
    );
    i++;
  }

  y = ensureSpace(doc, y, 30, pageH, 40, () => paintHeader());
  y += 12;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text(`Total outstanding: ${money(total, cur)}`, 48, y);

  if (!rows.length) {
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text('No outstanding customer balances.', 48, y + 8);
  }

  drawFooter(doc, pageW, pageH);
  return streamToBuffer(doc);
}

export async function arAgingPdf(companyId: string | null | undefined): Promise<Buffer> {
  const cid = requireCompany(companyId);
  const meta = await companyMeta(cid);
  const report = await reportService.arAgingReport(cid);
  const cur = meta.currency;
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margin: 48,
    bufferPages: true,
    info: { Title: 'AR Aging', Author: meta.name },
  });
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const subtitle = `As of ${format(report.asOf, 'dd MMM yyyy')} · Total ${money(report.buckets.total, cur)}`;
  let y = drawHeader(doc, pageW, meta, 'Accounts Receivable Aging', subtitle);

  const sumCols: Col[] = [
    { label: 'Bucket', x: 48, w: 200 },
    { label: 'Amount', x: 248, w: 140, align: 'right' },
  ];
  y = drawTableHeader(doc, sumCols, y);
  const bucketRows: Array<[string, number]> = [
    ['Current (not due)', report.buckets.current],
    ['1–30 days', report.buckets.days1to30],
    ['31–60 days', report.buckets.days31to60],
    ['61–90 days', report.buckets.days61to90],
    ['90+ days', report.buckets.days90plus],
    ['Total', report.buckets.total],
  ];
  bucketRows.forEach((r, i) => {
    y = drawTableRow(doc, sumCols, [r[0], money(r[1], cur)], y, {
      alt: i % 2 === 1,
      bold: r[0] === 'Total',
    });
  });

  y += 16;
  const cols: Col[] = [
    { label: 'Invoice', x: 48, w: 80 },
    { label: 'Customer', x: 128, w: 150 },
    { label: 'Days', x: 278, w: 40, align: 'right' },
    { label: 'Balance', x: 318, w: 100, align: 'right' },
    { label: 'Bucket', x: 418, w: 100 },
  ];
  y = drawTableHeader(doc, cols, y);
  let i = 0;
  for (const r of report.rows.slice(0, 80)) {
    y = ensureSpace(doc, y, 18, pageH, 40, () => {
      let yy = drawHeader(doc, pageW, meta, 'AR Aging (cont.)', subtitle);
      return drawTableHeader(doc, cols, yy);
    });
    y = drawTableRow(
      doc,
      cols,
      [r.invoiceNo, r.customer, String(r.daysPastDue), money(r.balance, cur), r.bucket],
      y,
      { alt: i++ % 2 === 1 }
    );
  }

  drawFooter(doc, pageW, pageH);
  return streamToBuffer(doc);
}

export async function customerStatementPdf(
  companyId: string | null | undefined,
  customerId: string,
  from?: Date,
  to?: Date
): Promise<Buffer> {
  const cid = requireCompany(companyId);
  const meta = await companyMeta(cid);
  const st = await reportService.customerStatement(cid, customerId, from, to);
  const cur = meta.currency;
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margin: 48,
    bufferPages: true,
    info: { Title: 'Customer Statement', Author: meta.name },
  });
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const subtitle = `${st.customer.name} (${st.customer.code || '—'}) · ${format(st.from, 'dd MMM yyyy')} – ${format(st.to, 'dd MMM yyyy')}`;
  let y = drawHeader(doc, pageW, meta, 'Customer Statement', subtitle);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text(`Phone: ${st.customer.phone || '—'}  ·  Current balance: ${money(st.customer.balance, cur)}`, 48, y);
  y += 18;

  const invCols: Col[] = [
    { label: 'Invoice', x: 48, w: 90 },
    { label: 'Issued', x: 138, w: 80 },
    { label: 'Due', x: 218, w: 80 },
    { label: 'Total', x: 298, w: 80, align: 'right' },
    { label: 'Paid', x: 378, w: 80, align: 'right' },
    { label: 'Balance', x: 458, w: 80, align: 'right' },
  ];
  y = drawTableHeader(doc, invCols, y);
  st.invoices.forEach((inv, i) => {
    y = ensureSpace(doc, y, 18, pageH, 40, () => {
      let yy = drawHeader(doc, pageW, meta, 'Customer Statement', subtitle);
      return drawTableHeader(doc, invCols, yy);
    });
    y = drawTableRow(
      doc,
      invCols,
      [
        inv.invoiceNo,
        inv.issuedAt ? format(new Date(inv.issuedAt), 'yyyy-MM-dd') : '—',
        inv.dueDate ? format(new Date(inv.dueDate), 'yyyy-MM-dd') : '—',
        money(inv.total, cur),
        money(inv.paidAmount, cur),
        money(inv.balance, cur),
      ],
      y,
      { alt: i % 2 === 1 }
    );
  });

  y += 14;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink).text('Payments', 48, y);
  y += 12;
  const payCols: Col[] = [
    { label: 'Date', x: 48, w: 90 },
    { label: 'Method', x: 138, w: 80 },
    { label: 'Invoice', x: 218, w: 100 },
    { label: 'Amount', x: 318, w: 100, align: 'right' },
  ];
  y = drawTableHeader(doc, payCols, y);
  st.payments.forEach((p, i) => {
    y = ensureSpace(doc, y, 18, pageH, 40, () => drawTableHeader(doc, payCols, 70));
    y = drawTableRow(
      doc,
      payCols,
      [
        p.paidAt ? format(new Date(p.paidAt), 'yyyy-MM-dd') : '—',
        String(p.method || ''),
        p.invoiceNo || '—',
        money(p.amount, cur),
      ],
      y,
      { alt: i % 2 === 1 }
    );
  });

  drawFooter(doc, pageW, pageH);
  return streamToBuffer(doc);
}

export async function zReportPdf(
  companyId: string | null | undefined,
  shiftId: string
): Promise<Buffer> {
  const cid = requireCompany(companyId);
  const meta = await companyMeta(cid);
  const { prisma } = await import('../config/database');
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, companyId: cid },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  if (!shift) throw new ForbiddenError('Shift not found');

  const sales = await prisma.sale.findMany({
    where: {
      shiftId,
      deletedAt: null,
      status: { notIn: ['CANCELLED'] },
    },
    select: {
      saleNo: true,
      total: true,
      paidAmount: true,
      paymentMethod: true,
      paymentStatus: true,
      status: true,
      saleDate: true,
    },
  });

  const cur = meta.currency;
  const byMethod: Record<string, number> = {};
  let salesTotal = 0;
  let refunded = 0;
  for (const s of sales) {
    if (s.status === 'RETURNED' || s.paymentStatus === 'REFUNDED') {
      refunded += Number(s.total);
      continue;
    }
    salesTotal += Number(s.total);
    const m = s.paymentMethod || 'OTHER';
    byMethod[m] = (byMethod[m] || 0) + Number(s.paidAmount || s.total);
  }

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margin: 48,
    bufferPages: true,
    info: { Title: 'Z-Report', Author: meta.name },
  });
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const cashier = shift.user
    ? `${shift.user.firstName || ''} ${shift.user.lastName || ''}`.trim()
    : '—';
  const subtitle = `Shift ${shift.shiftNo} · ${cashier} · ${
    shift.closedAt ? format(shift.closedAt, 'yyyy-MM-dd HH:mm') : 'OPEN'
  }`;
  let y = drawHeader(doc, pageW, meta, 'End of Day / Z-Report', subtitle);

  const cols: Col[] = [
    { label: 'Metric', x: 48, w: 260 },
    { label: 'Amount', x: 308, w: 160, align: 'right' },
  ];
  y = drawTableHeader(doc, cols, y);
  const lines: Array<[string, string]> = [
    ['Opening cash', money(shift.openingCash, cur)],
    ['Cash sales (paid)', money(byMethod.CASH || 0, cur)],
    ['Card', money(byMethod.CARD || 0, cur)],
    ['Mobile money', money(byMethod.MOBILE_MONEY || 0, cur)],
    ['Gross sales (non-refunded)', money(salesTotal, cur)],
    ['Refunds', money(Number(shift.totalRefunds || refunded), cur)],
    ['Expected cash drawer', money(shift.expectedCash ?? 0, cur)],
    ['Closing cash counted', money(shift.closingCash ?? 0, cur)],
    ['Difference', money(shift.difference ?? 0, cur)],
    ['Sale count', String(sales.length)],
  ];
  lines.forEach((r, i) => {
    y = drawTableRow(doc, cols, r, y, { alt: i % 2 === 1, bold: r[0].includes('Difference') });
  });

  y += 16;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink).text('Sales on this shift', 48, y);
  y += 12;
  const saleCols: Col[] = [
    { label: 'Time', x: 48, w: 90 },
    { label: 'Sale #', x: 138, w: 90 },
    { label: 'Method', x: 228, w: 80 },
    { label: 'Total', x: 308, w: 90, align: 'right' },
    { label: 'Status', x: 398, w: 100 },
  ];
  y = drawTableHeader(doc, saleCols, y);
  sales.slice(0, 40).forEach((s, i) => {
    y = ensureSpace(doc, y, 16, pageH, 40, () => drawTableHeader(doc, saleCols, 70));
    y = drawTableRow(
      doc,
      saleCols,
      [
        format(s.saleDate, 'HH:mm'),
        s.saleNo,
        String(s.paymentMethod),
        money(s.total, cur),
        `${s.paymentStatus}/${s.status}`,
      ],
      y,
      { alt: i % 2 === 1 }
    );
  });

  drawFooter(doc, pageW, pageH);
  return streamToBuffer(doc);
}

export async function purchaseOrderPdf(
  companyId: string | null | undefined,
  purchaseId: string
): Promise<Buffer> {
  const cid = requireCompany(companyId);
  const meta = await companyMeta(cid);
  const { prisma } = await import('../config/database');
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseId, companyId: cid, deletedAt: null },
    include: {
      supplier: true,
      items: { include: { product: { select: { name: true, sku: true } } } },
    },
  });
  if (!po) throw new ForbiddenError('Purchase order not found');
  const cur = meta.currency;
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margin: 48,
    bufferPages: true,
    info: { Title: `PO ${po.orderNo}`, Author: meta.name },
  });
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const subtitle = `Status ${po.status} · Supplier ${po.supplier?.name || '—'}`;
  let y = drawHeader(doc, pageW, meta, `Purchase Order ${po.orderNo}`, subtitle);
  if (po.notes) {
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(`Notes: ${po.notes}`, 48, y);
    y += 14;
  }
  const cols: Col[] = [
    { label: 'SKU', x: 48, w: 70 },
    { label: 'Product', x: 118, w: 180 },
    { label: 'Qty', x: 298, w: 50, align: 'right' },
    { label: 'Unit cost', x: 348, w: 80, align: 'right' },
    { label: 'Line total', x: 428, w: 90, align: 'right' },
  ];
  y = drawTableHeader(doc, cols, y);
  po.items.forEach((it, i) => {
    y = ensureSpace(doc, y, 16, pageH, 40, () => drawTableHeader(doc, cols, 70));
    y = drawTableRow(
      doc,
      cols,
      [
        it.product?.sku || '—',
        it.product?.name || '—',
        String(Number(it.quantity)),
        money(it.unitCost, cur),
        money(it.total, cur),
      ],
      y,
      { alt: i % 2 === 1 }
    );
  });
  y += 12;
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.ink)
    .text(`Order total: ${money(po.total, cur)}`, 48, y);

  drawFooter(doc, pageW, pageH);
  return streamToBuffer(doc);
}
