/**
 * Polished multi-page PDF reports with column/row tables (PDFKit).
 */
import PDFDocument from 'pdfkit';
import { format } from 'date-fns';
import { prisma } from '../config/database';
import { ForbiddenError } from '../utils/errors';
import * as reportService from './report.service';

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
  const c = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { name: true, email: true, phone: true, currency: true, address: true, city: true },
  });
  return {
    name: c?.name || 'Enterprise IMS',
    email: c?.email || '',
    phone: c?.phone || '',
    currency: (c?.currency || 'USD').toUpperCase(),
    location: [c?.city, c?.address].filter(Boolean).join(' · '),
  };
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  pageW: number,
  meta: { name: string; email: string; phone: string; location: string },
  title: string,
  subtitle: string
) {
  doc.save();
  doc.rect(0, 0, pageW, 52).fill(COLORS.primary);
  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(14).text(meta.name, 40, 14, {
    width: pageW - 80,
  });
  doc.font('Helvetica').fontSize(8).fillColor('#c7d2fe').text(title, 40, 32, { width: pageW - 80 });
  doc.restore();

  let y = 64;
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(16).text(title, 40, y);
  y += 22;
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(subtitle, 40, y, {
    width: pageW - 80,
  });
  y += 16;
  const contact = [meta.location, meta.phone, meta.email].filter(Boolean).join('  ·  ');
  if (contact) {
    doc.fontSize(8).text(contact, 40, y, { width: pageW - 80 });
    y += 14;
  }
  doc
    .strokeColor(COLORS.line)
    .lineWidth(1)
    .moveTo(40, y + 4)
    .lineTo(pageW - 40, y + 4)
    .stroke();
  return y + 16;
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
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(
        `Enterprise IMS  ·  Page ${i + 1} of ${range.count}  ·  Generated ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
        40,
        pageH - 28,
        { width: pageW - 80, align: 'center' }
      );
  }
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

  const rows: Array<[string, string, string, boolean?]> = [
    ['Revenue (sales)', money(report.revenue, cur), '', false],
    ['Cost of goods sold (COGS)', money(report.cogs, cur), '', false],
    ['Gross profit', money(report.grossProfit, cur), `${report.grossMargin.toFixed(1)}% margin`, true],
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
      'Gross profit = Revenue − COGS. Purchases shown for reference (not deducted again from gross profit).',
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
