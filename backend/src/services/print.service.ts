import PDFDocument from 'pdfkit';
import { prisma } from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { sendDocumentEmail } from './email.service';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

/** Format money values from Prisma Decimal, number, or string. */
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

/**
 * Print / PDF currency context.
 * Sale & invoice totals are stored in company base currency; we convert to the
 * admin's selected dashboard (display) currency for receipts & invoices.
 */
export type PrintMoneyCtx = {
  base: string;
  display: string;
  /** Base units per 1 unit of display currency (amountDisplay = amountBase / rate) */
  rate: number;
  note: string;
};

/** Resolve display currency from query (admin top-bar selection) + company rates. */
export async function resolvePrintMoney(
  companyId: string,
  requestedCurrency?: string | null
): Promise<PrintMoneyCtx> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { currency: true },
  });
  const base = (company?.currency || 'USD').toUpperCase();
  let display = (requestedCurrency || base).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  if (display.length !== 3) display = base;

  const rows = await prisma.currency.findMany({
    where: { companyId, isActive: true },
    select: { code: true, exchangeRate: true },
  });
  const rateMap: Record<string, number> = { [base]: 1 };
  for (const r of rows) {
    rateMap[r.code.toUpperCase()] = Number(r.exchangeRate) || 1;
  }
  rateMap[base] = 1;

  const rate = rateMap[display] && rateMap[display] > 0 ? rateMap[display] : 1;
  // If requested currency is unknown, fall back to base (no wrong conversion)
  const known = display === base || rateMap[display] != null;
  if (!known) {
    return {
      base,
      display: base,
      rate: 1,
      note: `All amounts in ${base}`,
    };
  }

  const note =
    display === base
      ? `All amounts in ${display}`
      : `Amounts in ${display} · converted from ${base} (1 ${display} = ${rate.toFixed(4)} ${base})`;

  return { base, display, rate, note };
}

/** Convert a base-currency amount into the print display currency. */
function fromBase(n: unknown, ctx: PrintMoneyCtx): number {
  const baseAmt = Number(n as number | string) || 0;
  if (!ctx.rate || ctx.rate === 0) return baseAmt;
  return baseAmt / ctx.rate;
}

/** Format a base amount in the selected print currency. */
function moneyBase(n: unknown, ctx: PrintMoneyCtx): string {
  return money(fromBase(n, ctx), ctx.display);
}

function fmtNumBase(n: unknown, ctx: PrintMoneyCtx, digits = 2): string {
  return fromBase(n, ctx).toFixed(digits);
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

function customerName(c?: {
  businessName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
} | null) {
  if (!c) return 'Walk-in Customer';
  return c.businessName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Customer';
}

export async function loadSale(companyId: string, saleId: string) {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId },
    include: {
      items: true,
      payments: true,
      customer: true,
      cashier: { select: { firstName: true, lastName: true, email: true } },
      company: true,
      branch: true,
    },
  });
  if (!sale) throw new NotFoundError('Sale');
  return sale;
}

export async function loadInvoice(companyId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
    include: {
      items: true,
      payments: true,
      customer: true,
      company: true,
    },
  });
  if (!invoice) throw new NotFoundError('Invoice');
  return invoice;
}

// ═══════════════════════════════════════════════════════════
// ESC/POS (thermal printer software: RawBT, QZ Tray, PrintNode)
// ═══════════════════════════════════════════════════════════

/** ESC/POS control codes compatible with most 58/80mm POS printers */
export function buildEscPosReceipt(
  sale: Awaited<ReturnType<typeof loadSale>>,
  paperWidth: 32 | 42 = 42,
  moneyCtx?: PrintMoneyCtx
): Buffer {
  const ESC = '\x1B';
  const GS = '\x1D';
  const lines: string[] = [];
  const ctx: PrintMoneyCtx = moneyCtx || {
    base: sale.company?.currency || 'USD',
    display: sale.company?.currency || 'USD',
    rate: 1,
    note: `All amounts in ${sale.company?.currency || 'USD'}`,
  };
  const dash = '-'.repeat(paperWidth);

  const center = (t: string) => {
    const s = t.slice(0, paperWidth);
    const pad = Math.max(0, Math.floor((paperWidth - s.length) / 2));
    return ' '.repeat(pad) + s;
  };
  const row = (left: string, right: string) => {
    const space = Math.max(1, paperWidth - left.length - right.length);
    return `${left}${''.padEnd(space)}${right}`.slice(0, paperWidth);
  };

  // Initialize printer
  lines.push(`${ESC}@`); // init
  lines.push(`${ESC}a\x01`); // center
  lines.push(`${ESC}!\x18`); // double height/width-ish
  lines.push(`${sale.company?.name || 'Enterprise IMS'}\n`);
  lines.push(`${ESC}!\x00`); // normal
  if (sale.company?.address) lines.push(`${sale.company.address}\n`);
  if (sale.company?.phone) lines.push(`Tel: ${sale.company.phone}\n`);
  lines.push(`SALES RECEIPT\n`);
  lines.push(`${ESC}a\x00`); // left
  lines.push(`${dash}\n`);
  lines.push(`Receipt: ${sale.saleNo}\n`);
  lines.push(`Date: ${sale.saleDate.toLocaleString()}\n`);
  if (sale.branch) lines.push(`Branch: ${sale.branch.name}\n`);
  if (sale.cashier) lines.push(`Cashier: ${sale.cashier.firstName} ${sale.cashier.lastName}\n`);
  lines.push(`Customer: ${customerName(sale.customer)}\n`);
  lines.push(`${dash}\n`);

  lines.push(`Currency: ${ctx.display}\n`);
  for (const item of sale.items) {
    lines.push(`${item.productName}\n`);
    lines.push(
      `${row(
        `  ${Number(item.quantity)} x ${fmtNumBase(item.unitPrice, ctx)}`,
        fmtNumBase(item.total, ctx)
      )}\n`
    );
  }

  lines.push(`${dash}\n`);
  lines.push(`${row('Subtotal', fmtNumBase(sale.subtotal, ctx))}\n`);
  lines.push(`${row('Tax', fmtNumBase(sale.taxAmount, ctx))}\n`);
  if (Number(sale.discountAmount) > 0) {
    lines.push(`${row('Discount', fmtNumBase(sale.discountAmount, ctx))}\n`);
  }
  lines.push(`${ESC}E\x01`); // bold on
  lines.push(`${row('TOTAL', moneyBase(sale.total, ctx))}\n`);
  lines.push(`${ESC}E\x00`);
  lines.push(`${row('Paid', fmtNumBase(sale.paidAmount, ctx))}\n`);
  if (Number(sale.changeAmount) > 0) {
    lines.push(`${row('Change', fmtNumBase(sale.changeAmount, ctx))}\n`);
  }
  lines.push(`${row('Method', sale.paymentMethod)}\n`);
  lines.push(`${dash}\n`);
  lines.push(`${ESC}a\x01`);
  lines.push(`Thank you for your business!\n`);
  lines.push(`Powered by Enterprise IMS\n`);
  // Cut paper (partial)
  lines.push(`\n\n\n`);
  lines.push(`${GS}V\x41\x03`); // feed & cut

  return Buffer.from(lines.join(''), 'binary');
}

export function buildEscPosInvoice(
  invoice: Awaited<ReturnType<typeof loadInvoice>>,
  paperWidth: 42 = 42,
  moneyCtx?: PrintMoneyCtx
): Buffer {
  const ESC = '\x1B';
  const GS = '\x1D';
  const dash = '-'.repeat(paperWidth);
  const ctx = moneyCtx || defaultMoneyCtx(invoice.company?.currency);
  const lines: string[] = [];
  const row = (left: string, right: string) => {
    const space = Math.max(1, paperWidth - left.length - right.length);
    return `${left}${''.padEnd(space)}${right}`.slice(0, paperWidth);
  };

  lines.push(`${ESC}@`);
  lines.push(`${ESC}a\x01`);
  lines.push(`${invoice.company?.name || 'Company'}\n`);
  lines.push(`TAX INVOICE\n`);
  lines.push(`${ESC}a\x00`);
  lines.push(`${dash}\n`);
  lines.push(`Invoice: ${invoice.invoiceNo}\n`);
  lines.push(`Date: ${(invoice.issuedAt || invoice.createdAt).toLocaleDateString()}\n`);
  if (invoice.dueDate) lines.push(`Due: ${invoice.dueDate.toLocaleDateString()}\n`);
  lines.push(`Bill To: ${customerName(invoice.customer)}\n`);
  lines.push(`Status: ${invoice.paymentStatus}\n`);
  lines.push(`Currency: ${ctx.display}\n`);
  lines.push(`${dash}\n`);
  for (const item of invoice.items) {
    lines.push(`${item.description}\n`);
    lines.push(
      `${row(
        `  ${Number(item.quantity)} x ${fmtNumBase(item.unitPrice, ctx)}`,
        fmtNumBase(item.total, ctx)
      )}\n`
    );
  }
  lines.push(`${dash}\n`);
  lines.push(`${row('Subtotal', fmtNumBase(invoice.subtotal, ctx))}\n`);
  lines.push(`${row('Tax', fmtNumBase(invoice.taxAmount, ctx))}\n`);
  lines.push(`${ESC}E\x01${row('TOTAL', moneyBase(invoice.total, ctx))}${ESC}E\x00\n`);
  lines.push(`${row('Paid', fmtNumBase(invoice.paidAmount, ctx))}\n`);
  lines.push(
    `${row('Balance', fmtNumBase(Number(invoice.total) - Number(invoice.paidAmount), ctx))}\n`
  );
  lines.push(`\n\n\n${GS}V\x41\x03`);
  return Buffer.from(lines.join(''), 'binary');
}

/** Plain text for any printer / Notepad / generic drivers */
function defaultMoneyCtx(base?: string | null): PrintMoneyCtx {
  const b = (base || 'USD').toUpperCase();
  return { base: b, display: b, rate: 1, note: `All amounts in ${b}` };
}

export function buildPlainTextReceipt(
  sale: Awaited<ReturnType<typeof loadSale>>,
  moneyCtx?: PrintMoneyCtx
): string {
  const ctx = moneyCtx || defaultMoneyCtx(sale.company?.currency);
  const lines: string[] = [];
  lines.push(sale.company?.name || 'Enterprise IMS');
  if (sale.company?.address) lines.push(sale.company.address);
  if (sale.company?.phone) lines.push(`Tel: ${sale.company.phone}`);
  lines.push('');
  lines.push('SALES RECEIPT');
  lines.push('================================================');
  lines.push(`Receipt  : ${sale.saleNo}`);
  lines.push(`Date     : ${sale.saleDate.toLocaleString()}`);
  lines.push(`Currency : ${ctx.display}`);
  if (sale.cashier) lines.push(`Cashier  : ${sale.cashier.firstName} ${sale.cashier.lastName}`);
  lines.push(`Customer : ${customerName(sale.customer)}`);
  if (ctx.display !== ctx.base) lines.push(ctx.note);
  lines.push('================================================');
  lines.push(
    `${'ITEM'.padEnd(22)} ${'QTY'.padStart(5)} ${'PRICE'.padStart(9)} ${'AMOUNT'.padStart(9)}`
  );
  lines.push('------------------------------------------------');
  for (const item of sale.items) {
    const name = item.productName.slice(0, 22).padEnd(22);
    const qty = String(Number(item.quantity)).padStart(5);
    const price = fmtNumBase(item.unitPrice, ctx).padStart(9);
    const amt = fmtNumBase(item.total, ctx).padStart(9);
    lines.push(`${name} ${qty} ${price} ${amt}`);
  }
  lines.push('------------------------------------------------');
  lines.push(`${'Subtotal'.padEnd(38)}${fmtNumBase(sale.subtotal, ctx).padStart(10)}`);
  lines.push(`${'Tax'.padEnd(38)}${fmtNumBase(sale.taxAmount, ctx).padStart(10)}`);
  if (Number(sale.discountAmount) > 0) {
    lines.push(`${'Discount'.padEnd(38)}${fmtNumBase(sale.discountAmount, ctx).padStart(10)}`);
  }
  lines.push(`${'TOTAL'.padEnd(38)}${moneyBase(sale.total, ctx).padStart(10)}`);
  lines.push(`${'Paid'.padEnd(38)}${fmtNumBase(sale.paidAmount, ctx).padStart(10)}`);
  if (Number(sale.changeAmount) > 0) {
    lines.push(`${'Change'.padEnd(38)}${fmtNumBase(sale.changeAmount, ctx).padStart(10)}`);
  }
  lines.push(`${'Method'.padEnd(38)}${String(sale.paymentMethod).replace(/_/g, ' ').padStart(10)}`);
  lines.push('================================================');
  lines.push('Thank you for your business!');
  lines.push('Powered by Enterprise IMS');
  return lines.join('\r\n') + '\r\n';
}

export function buildPlainTextInvoice(
  invoice: Awaited<ReturnType<typeof loadInvoice>>,
  moneyCtx?: PrintMoneyCtx
): string {
  const ctx = moneyCtx || defaultMoneyCtx(invoice.company?.currency);
  const lines: string[] = [];
  lines.push(invoice.company?.name || 'Company');
  lines.push('TAX INVOICE');
  lines.push('================================================');
  lines.push(`Invoice #: ${invoice.invoiceNo}`);
  lines.push(`Date     : ${(invoice.issuedAt || invoice.createdAt).toLocaleDateString()}`);
  if (invoice.dueDate) lines.push(`Due Date : ${invoice.dueDate.toLocaleDateString()}`);
  lines.push(`Status   : ${invoice.paymentStatus}`);
  lines.push(`Currency : ${ctx.display}`);
  lines.push(`Bill To  : ${customerName(invoice.customer)}`);
  if (invoice.customer?.phone) lines.push(`Phone    : ${invoice.customer.phone}`);
  if (invoice.customer?.email) lines.push(`Email    : ${invoice.customer.email}`);
  if (ctx.display !== ctx.base) lines.push(ctx.note);
  lines.push('================================================');
  lines.push(
    `${'#'.padStart(2)} ${'DESCRIPTION'.padEnd(24)} ${'QTY'.padStart(5)} ${'PRICE'.padStart(8)} ${'TOTAL'.padStart(8)}`
  );
  lines.push('------------------------------------------------');
  invoice.items.forEach((item, idx) => {
    lines.push(
      `${String(idx + 1).padStart(2)} ${item.description.slice(0, 24).padEnd(24)} ${String(Number(item.quantity)).padStart(5)} ${fmtNumBase(item.unitPrice, ctx).padStart(8)} ${fmtNumBase(item.total, ctx).padStart(8)}`
    );
  });
  lines.push('------------------------------------------------');
  lines.push(`Subtotal     : ${moneyBase(invoice.subtotal, ctx)}`);
  lines.push(`Tax          : ${moneyBase(invoice.taxAmount, ctx)}`);
  if (Number(invoice.discountAmount) > 0) {
    lines.push(`Discount     : ${moneyBase(invoice.discountAmount, ctx)}`);
  }
  lines.push(`TOTAL        : ${moneyBase(invoice.total, ctx)}`);
  lines.push(`Paid         : ${moneyBase(invoice.paidAmount, ctx)}`);
  lines.push(
    `Balance Due  : ${moneyBase(Number(invoice.total) - Number(invoice.paidAmount), ctx)}`
  );
  if (invoice.notes) {
    lines.push('------------------------------------------------');
    lines.push(`Notes: ${invoice.notes}`);
  }
  lines.push('================================================');
  lines.push('Thank you for your business.');
  return lines.join('\r\n') + '\r\n';
}

// ═══════════════════════════════════════════════════════════
// Shared document design tokens (HTML + PDF)
// ═══════════════════════════════════════════════════════════

const DOC = {
  primary: '#4F46E5',
  primaryDark: '#312E81',
  ink: '#0F172A',
  muted: '#64748B',
  line: '#E2E8F0',
  soft: '#F8FAFC',
  headerBg: '#EEF2FF',
  totalBg: '#EEF2FF',
  white: '#FFFFFF',
  success: '#059669',
  successBg: '#D1FAE5',
  warnBg: '#FEF3C7',
  warn: '#B45309',
};

function fmtNum(n: unknown, digits = 2) {
  return (Number(n) || 0).toFixed(digits);
}

// ═══════════════════════════════════════════════════════════
// HTML (browser print / print software that supports HTML)
// ═══════════════════════════════════════════════════════════

export function buildReceiptHtml(
  sale: Awaited<ReturnType<typeof loadSale>>,
  options?: { autoPrint?: boolean; moneyCtx?: PrintMoneyCtx }
) {
  const ctx = options?.moneyCtx || defaultMoneyCtx(sale.company?.currency);
  const currency = ctx.display;
  const itemRows = sale.items
    .map(
      (i, idx) => `
      <tr class="${idx % 2 ? 'alt' : ''}">
        <td class="item">
          <div class="item-name">${escapeHtml(i.productName)}</div>
          ${i.sku ? `<div class="item-sku">SKU ${escapeHtml(i.sku)}</div>` : ''}
        </td>
        <td class="right num">${fmtNum(i.quantity, Number(i.quantity) % 1 ? 2 : 0)}</td>
        <td class="right num">${fmtNumBase(i.unitPrice, ctx)}</td>
        <td class="right num bold">${fmtNumBase(i.total, ctx)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Receipt ${escapeHtml(sale.saleNo)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
      color: ${DOC.ink};
      margin: 0;
      padding: 0;
      background: #f1f5f9;
    }
    .sheet {
      max-width: 720px;
      margin: 16px auto;
      background: ${DOC.white};
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12);
      border: 1px solid ${DOC.line};
    }
    .hero {
      background: linear-gradient(135deg, ${DOC.primary} 0%, #6366f1 55%, #06b6d4 100%);
      color: #fff;
      padding: 22px 24px 18px;
    }
    .hero-top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: -0.03em; }
    .hero-sub { opacity: 0.9; font-size: 12px; margin-top: 4px; line-height: 1.4; }
    .pill {
      background: rgba(255,255,255,0.18);
      border: 1px solid rgba(255,255,255,0.28);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .body { padding: 20px 24px 28px; }
    .meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 18px;
    }
    .card {
      background: ${DOC.soft};
      border: 1px solid ${DOC.line};
      border-radius: 12px;
      padding: 12px 14px;
    }
    .card h3 {
      margin: 0 0 8px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: ${DOC.muted};
      font-weight: 700;
    }
    .card p { margin: 2px 0; font-size: 13px; }
    table.items {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      border: 1px solid ${DOC.line};
      border-radius: 12px;
      overflow: hidden;
      margin-top: 4px;
    }
    table.items thead th {
      background: ${DOC.headerBg};
      color: ${DOC.primaryDark};
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 11px 10px;
      text-align: left;
      border-bottom: 1px solid ${DOC.line};
    }
    table.items td {
      padding: 11px 10px;
      font-size: 13px;
      border-bottom: 1px solid ${DOC.line};
      vertical-align: top;
    }
    table.items tr:last-child td { border-bottom: none; }
    table.items tr.alt td { background: ${DOC.soft}; }
    .item-name { font-weight: 600; }
    .item-sku { font-size: 11px; color: ${DOC.muted}; margin-top: 2px; font-family: ui-monospace, monospace; }
    .right { text-align: right; }
    .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .bold { font-weight: 700; }
    .totals-wrap {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
    }
    .totals {
      width: 280px;
      border: 1px solid ${DOC.line};
      border-radius: 12px;
      overflow: hidden;
    }
    .totals table { width: 100%; border-collapse: collapse; }
    .totals td { padding: 8px 12px; font-size: 13px; }
    .totals tr:nth-child(odd) td { background: ${DOC.soft}; }
    .totals .grand td {
      background: ${DOC.totalBg} !important;
      color: ${DOC.primaryDark};
      font-weight: 800;
      font-size: 15px;
      border-top: 2px solid ${DOC.primary};
      padding-top: 12px;
      padding-bottom: 12px;
    }
    .thanks {
      margin-top: 22px;
      text-align: center;
      color: ${DOC.muted};
      font-size: 12px;
      line-height: 1.5;
    }
    .footer-bar {
      margin-top: 18px;
      padding-top: 12px;
      border-top: 1px dashed ${DOC.line};
      text-align: center;
      font-size: 11px;
      color: ${DOC.muted};
    }
    .actions {
      margin: 16px auto 24px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .actions button {
      border: 0;
      background: ${DOC.primary};
      color: #fff;
      padding: 11px 18px;
      border-radius: 10px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
    }
    .actions button.secondary { background: #e2e8f0; color: ${DOC.ink}; }
    @media print {
      body { background: #fff; }
      .sheet { box-shadow: none; border: none; margin: 0; max-width: none; border-radius: 0; }
      .actions { display: none !important; }
    }
    @media (max-width: 560px) {
      .meta { grid-template-columns: 1fr; }
      .body, .hero { padding: 16px; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="hero">
      <div class="hero-top">
        <div>
          <div class="brand">${escapeHtml(sale.company?.name || 'Enterprise IMS')}</div>
          <div class="hero-sub">
            ${sale.company?.address ? `${escapeHtml(sale.company.address)}<br/>` : ''}
            ${sale.company?.phone ? `Tel: ${escapeHtml(sale.company.phone)}` : ''}
            ${sale.company?.email ? ` · ${escapeHtml(sale.company.email)}` : ''}
          </div>
        </div>
        <div class="pill">Sales Receipt</div>
      </div>
    </div>
    <div class="body">
      <div class="meta">
        <div class="card">
          <h3>Receipt details</h3>
          <p><strong>${escapeHtml(sale.saleNo)}</strong></p>
          <p>${escapeHtml(sale.saleDate.toLocaleString())}</p>
          <p>Currency: <strong>${escapeHtml(currency)}</strong></p>
          ${sale.branch ? `<p>Branch: ${escapeHtml(sale.branch.name)}</p>` : ''}
          ${sale.cashier ? `<p>Cashier: ${escapeHtml(`${sale.cashier.firstName} ${sale.cashier.lastName}`)}</p>` : ''}
        </div>
        <div class="card">
          <h3>Customer</h3>
          <p><strong>${escapeHtml(customerName(sale.customer))}</strong></p>
          ${sale.customer?.phone ? `<p>${escapeHtml(sale.customer.phone)}</p>` : ''}
          ${sale.customer?.email ? `<p>${escapeHtml(sale.customer.email)}</p>` : ''}
          <p>Payment: <strong>${escapeHtml(String(sale.paymentMethod).replace(/_/g, ' '))}</strong></p>
        </div>
      </div>

      <table class="items">
        <thead>
          <tr>
            <th style="width:46%">Item</th>
            <th class="right" style="width:12%">Qty</th>
            <th class="right" style="width:20%">Unit price (${escapeHtml(currency)})</th>
            <th class="right" style="width:22%">Amount (${escapeHtml(currency)})</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div class="totals-wrap">
        <div class="totals">
          <table>
            <tr><td>Subtotal</td><td class="right num">${moneyBase(sale.subtotal, ctx)}</td></tr>
            <tr><td>Tax</td><td class="right num">${moneyBase(sale.taxAmount, ctx)}</td></tr>
            ${
              Number(sale.discountAmount) > 0
                ? `<tr><td>Discount</td><td class="right num">−${moneyBase(sale.discountAmount, ctx)}</td></tr>`
                : ''
            }
            <tr class="grand"><td>Total</td><td class="right num">${moneyBase(sale.total, ctx)}</td></tr>
            <tr><td>Paid</td><td class="right num">${moneyBase(sale.paidAmount, ctx)}</td></tr>
            ${
              Number(sale.changeAmount) > 0
                ? `<tr><td>Change</td><td class="right num">${moneyBase(sale.changeAmount, ctx)}</td></tr>`
                : ''
            }
          </table>
        </div>
      </div>

      <div class="thanks">Thank you for your business!<br/>We appreciate your support.</div>
      <div class="footer-bar">${escapeHtml(ctx.note)} · ${escapeHtml(sale.paymentStatus)} · Enterprise IMS</div>
    </div>
  </div>
  <div class="actions">
    <button onclick="window.print()">Print</button>
    <button class="secondary" onclick="window.close()">Close</button>
  </div>
  ${options?.autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},350)}</script>' : ''}
</body>
</html>`;
}

export function buildInvoiceHtml(
  invoice: Awaited<ReturnType<typeof loadInvoice>>,
  options?: { autoPrint?: boolean; moneyCtx?: PrintMoneyCtx }
) {
  const ctx = options?.moneyCtx || defaultMoneyCtx(invoice.company?.currency);
  const currency = ctx.display;
  const balance = Number(invoice.total) - Number(invoice.paidAmount);
  const paid = invoice.paymentStatus === 'PAID';
  const itemRows = invoice.items
    .map(
      (i, idx) => `
      <tr class="${idx % 2 ? 'alt' : ''}">
        <td class="center muted">${idx + 1}</td>
        <td class="item"><div class="item-name">${escapeHtml(i.description)}</div></td>
        <td class="right num">${fmtNum(i.quantity, Number(i.quantity) % 1 ? 2 : 0)}</td>
        <td class="right num">${fmtNumBase(i.unitPrice, ctx)}</td>
        <td class="right num">${fmtNumBase(i.taxAmount, ctx)}</td>
        <td class="right num bold">${fmtNumBase(i.total, ctx)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice ${escapeHtml(invoice.invoiceNo)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, Arial, sans-serif; color: ${DOC.ink}; margin: 0; background: #f1f5f9; }
    .sheet {
      max-width: 900px; margin: 16px auto; background: #fff;
      border-radius: 16px; overflow: hidden; border: 1px solid ${DOC.line};
      box-shadow: 0 12px 40px rgba(15,23,42,.12);
    }
    .hero {
      background: linear-gradient(135deg, ${DOC.primaryDark} 0%, ${DOC.primary} 60%, #0891b2 100%);
      color: #fff; padding: 24px 28px;
      display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap;
    }
    .brand { font-size: 24px; font-weight: 800; letter-spacing: -0.03em; }
    .hero-sub { opacity: .9; font-size: 12px; margin-top: 6px; line-height: 1.45; }
    .title-block { text-align: right; }
    .title { font-size: 28px; font-weight: 800; letter-spacing: 0.08em; }
    .meta { font-size: 13px; margin-top: 8px; opacity: .95; }
    .badge {
      display: inline-block; margin-top: 8px; padding: 5px 12px; border-radius: 999px;
      font-size: 11px; font-weight: 800; letter-spacing: .04em;
      background: ${paid ? DOC.successBg : DOC.warnBg};
      color: ${paid ? DOC.success : DOC.warn};
    }
    .body { padding: 24px 28px 32px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
    .card { border: 1px solid ${DOC.line}; border-radius: 12px; padding: 14px 16px; background: ${DOC.soft}; }
    .card h3 { margin: 0 0 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: ${DOC.muted}; }
    .card p { margin: 3px 0; font-size: 13px; }
    table.items {
      width: 100%; border-collapse: separate; border-spacing: 0;
      border: 1px solid ${DOC.line}; border-radius: 12px; overflow: hidden;
    }
    th {
      background: ${DOC.headerBg}; color: ${DOC.primaryDark}; text-align: left;
      padding: 12px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
      border-bottom: 1px solid ${DOC.line};
    }
    td { padding: 12px 10px; border-bottom: 1px solid ${DOC.line}; font-size: 13px; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr.alt td { background: ${DOC.soft}; }
    .item-name { font-weight: 600; }
    .right { text-align: right; }
    .center { text-align: center; }
    .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .bold { font-weight: 700; }
    .muted { color: ${DOC.muted}; }
    .totals-wrap { display: flex; justify-content: flex-end; margin-top: 18px; }
    .totals { width: 300px; border: 1px solid ${DOC.line}; border-radius: 12px; overflow: hidden; }
    .totals table { width: 100%; border-collapse: collapse; }
    .totals td { padding: 9px 14px; font-size: 13px; border: none; }
    .totals tr:nth-child(odd) td { background: ${DOC.soft}; }
    .totals .grand td {
      background: ${DOC.totalBg} !important; color: ${DOC.primaryDark};
      font-weight: 800; font-size: 16px; border-top: 2px solid ${DOC.primary};
      padding-top: 12px; padding-bottom: 12px;
    }
    .notes { margin-top: 20px; padding: 14px; border-radius: 12px; background: ${DOC.soft}; border: 1px solid ${DOC.line}; }
    .footer { margin-top: 24px; text-align: center; font-size: 11px; color: ${DOC.muted}; }
    .actions { margin: 16px auto 24px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .actions button { border: 0; background: ${DOC.primary}; color: #fff; padding: 11px 18px; border-radius: 10px; cursor: pointer; font-weight: 600; }
    .actions button.secondary { background: #e2e8f0; color: ${DOC.ink}; }
    @media print {
      body { background: #fff; }
      .sheet { box-shadow: none; border: none; margin: 0; border-radius: 0; max-width: none; }
      .actions { display: none !important; }
    }
    @media (max-width: 640px) {
      .grid, .hero { display: block; }
      .title-block { text-align: left; margin-top: 14px; }
      .body, .hero { padding: 16px; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="hero">
      <div>
        <div class="brand">${escapeHtml(invoice.company?.name || 'Company')}</div>
        <div class="hero-sub">
          ${invoice.company?.address ? `${escapeHtml(invoice.company.address)}<br/>` : ''}
          ${invoice.company?.phone ? `Tel: ${escapeHtml(invoice.company.phone)}` : ''}
          ${invoice.company?.email ? `<br/>${escapeHtml(invoice.company.email)}` : ''}
          ${invoice.company?.taxId ? `<br/>Tax ID: ${escapeHtml(invoice.company.taxId)}` : ''}
        </div>
      </div>
      <div class="title-block">
        <div class="title">INVOICE</div>
        <div class="meta">
          <div><strong>${escapeHtml(invoice.invoiceNo)}</strong></div>
          <div>Date: ${(invoice.issuedAt || invoice.createdAt).toLocaleDateString()}</div>
          ${invoice.dueDate ? `<div>Due: ${invoice.dueDate.toLocaleDateString()}</div>` : ''}
          <div><span class="badge">${escapeHtml(invoice.paymentStatus)}</span></div>
        </div>
      </div>
    </div>
    <div class="body">
      <div class="grid">
        <div class="card">
          <h3>Bill to</h3>
          <p><strong>${escapeHtml(customerName(invoice.customer))}</strong></p>
          ${invoice.customer?.phone ? `<p>${escapeHtml(invoice.customer.phone)}</p>` : ''}
          ${invoice.customer?.email ? `<p>${escapeHtml(invoice.customer.email)}</p>` : ''}
          ${invoice.customer?.address ? `<p class="muted">${escapeHtml(invoice.customer.address)}</p>` : ''}
        </div>
        <div class="card">
          <h3>Payment summary</h3>
          <p>Currency: <strong>${escapeHtml(currency)}</strong></p>
          <p>Total: <strong>${moneyBase(invoice.total, ctx)}</strong></p>
          <p>Paid: <strong>${moneyBase(invoice.paidAmount, ctx)}</strong></p>
          <p>Balance due: <strong>${moneyBase(balance, ctx)}</strong></p>
          ${ctx.display !== ctx.base ? `<p class="muted" style="margin-top:6px;font-size:11px">${escapeHtml(ctx.note)}</p>` : ''}
        </div>
      </div>

      <table class="items">
        <thead>
          <tr>
            <th style="width:6%">#</th>
            <th style="width:38%">Description</th>
            <th class="right" style="width:12%">Qty</th>
            <th class="right" style="width:14%">Unit price</th>
            <th class="right" style="width:14%">Tax</th>
            <th class="right" style="width:16%">Amount (${escapeHtml(currency)})</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div class="totals-wrap">
        <div class="totals">
          <table>
            <tr><td>Subtotal</td><td class="right num">${moneyBase(invoice.subtotal, ctx)}</td></tr>
            <tr><td>Tax</td><td class="right num">${moneyBase(invoice.taxAmount, ctx)}</td></tr>
            ${
              Number(invoice.discountAmount) > 0
                ? `<tr><td>Discount</td><td class="right num">−${moneyBase(invoice.discountAmount, ctx)}</td></tr>`
                : ''
            }
            <tr class="grand"><td>Total</td><td class="right num">${moneyBase(invoice.total, ctx)}</td></tr>
            <tr><td>Amount paid</td><td class="right num">${moneyBase(invoice.paidAmount, ctx)}</td></tr>
            <tr><td>Balance due</td><td class="right num">${moneyBase(balance, ctx)}</td></tr>
          </table>
        </div>
      </div>

      ${
        invoice.notes
          ? `<div class="notes"><strong>Notes</strong><div class="muted" style="margin-top:6px">${escapeHtml(invoice.notes)}</div></div>`
          : ''
      }

      <div class="footer">${escapeHtml(ctx.note)} · Generated by Enterprise IMS</div>
    </div>
  </div>
  <div class="actions">
    <button onclick="window.print()">Print invoice</button>
    <button class="secondary" onclick="window.close()">Close</button>
  </div>
  ${options?.autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},350)}</script>' : ''}
</body>
</html>`;
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════
// Enhanced PDFs — table layouts for receipts & invoices
// ═══════════════════════════════════════════════════════════

type PdfCol = { label: string; x: number; w: number; align?: 'left' | 'right' | 'center' };

function drawPdfHeaderBar(doc: PDFKit.PDFDocument, pageW: number, title: string) {
  doc.save();
  doc.rect(0, 0, pageW, 56).fill(DOC.primary);
  doc.fillColor(DOC.white).font('Helvetica-Bold').fontSize(11).text(title, 0, 22, {
    width: pageW,
    align: 'center',
  });
  doc.restore();
}

function drawTableHeader(doc: PDFKit.PDFDocument, cols: PdfCol[], y: number, rowH = 20) {
  const left = cols[0].x;
  const right = cols[cols.length - 1].x + cols[cols.length - 1].w;
  doc.save();
  doc.rect(left, y, right - left, rowH).fill(DOC.headerBg);
  doc.fillColor(DOC.primaryDark).font('Helvetica-Bold').fontSize(8);
  for (const c of cols) {
    doc.text(c.label, c.x + 3, y + 6, {
      width: c.w - 6,
      align: c.align || 'left',
    });
  }
  doc
    .strokeColor(DOC.line)
    .lineWidth(0.6)
    .moveTo(left, y + rowH)
    .lineTo(right, y + rowH)
    .stroke();
  doc.restore();
  return y + rowH;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  cols: PdfCol[],
  cells: string[],
  y: number,
  opts?: { alt?: boolean; bold?: boolean; fontSize?: number; rowH?: number }
) {
  const left = cols[0].x;
  const right = cols[cols.length - 1].x + cols[cols.length - 1].w;
  const rowH = opts?.rowH ?? 18;
  doc.save();
  if (opts?.alt) {
    doc.rect(left, y, right - left, rowH).fill(DOC.soft);
  }
  doc
    .fillColor(DOC.ink)
    .font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(opts?.fontSize ?? 8);
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    doc.text(cells[i] ?? '', c.x + 3, y + 5, {
      width: c.w - 6,
      align: c.align || 'left',
      lineBreak: false,
      ellipsis: true,
    });
  }
  doc
    .strokeColor(DOC.line)
    .lineWidth(0.4)
    .moveTo(left, y + rowH)
    .lineTo(right, y + rowH)
    .stroke();
  doc.restore();
  return y + rowH;
}

function drawTotalsBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  rows: Array<{ label: string; value: string; grand?: boolean }>
) {
  let cy = y;
  doc.save();
  doc.roundedRect(x, y, width, rows.length * 18 + 8, 6).strokeColor(DOC.line).lineWidth(0.8).stroke();
  for (const r of rows) {
    if (r.grand) {
      doc.rect(x + 1, cy, width - 2, 20).fill(DOC.totalBg);
      doc.fillColor(DOC.primaryDark).font('Helvetica-Bold').fontSize(10);
    } else {
      doc.fillColor(DOC.ink).font('Helvetica').fontSize(9);
    }
    doc.text(r.label, x + 10, cy + 5, { width: width * 0.45 });
    doc.text(r.value, x + width * 0.4, cy + 5, { width: width * 0.55 - 10, align: 'right' });
    cy += r.grand ? 20 : 16;
  }
  doc.restore();
  return cy + 6;
}

export async function receiptPdf(
  companyId: string | null | undefined,
  saleId: string,
  format: 'thermal80' | 'thermal58' | 'a4' = 'a4',
  displayCurrency?: string | null
): Promise<Buffer> {
  const cid = requireCompany(companyId);
  const sale = await loadSale(cid, saleId);
  const ctx = await resolvePrintMoney(cid, displayCurrency);
  const currency = ctx.display;
  const company = sale.company;

  if (format === 'a4') {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const pageW = 595.28;
    const contentL = 40;
    const contentW = pageW - 80;

    // Hero bar
    doc.save();
    doc.rect(0, 0, pageW, 78).fill(DOC.primary);
    doc.fillColor(DOC.white).font('Helvetica-Bold').fontSize(18).text(company?.name || 'Enterprise IMS', 40, 22, {
      width: 340,
    });
    doc.font('Helvetica').fontSize(9).fillColor('#E0E7FF');
    let hy = 46;
    if (company?.address) {
      doc.text(company.address, 40, hy, { width: 340 });
      hy += 12;
    }
    const contact = [company?.phone ? `Tel: ${company.phone}` : '', company?.email || ''].filter(Boolean).join('  ·  ');
    if (contact) doc.text(contact, 40, hy, { width: 340 });
    doc.fillColor(DOC.white).font('Helvetica-Bold').fontSize(11).text('SALES RECEIPT', 360, 28, {
      width: 195,
      align: 'right',
    });
    doc.font('Helvetica').fontSize(9).text(sale.saleNo, 360, 46, { width: 195, align: 'right' });
    doc.restore();

    let y = 96;
    // Meta cards
    doc.save();
    doc.roundedRect(contentL, y, contentW / 2 - 8, 72, 8).fill(DOC.soft).strokeColor(DOC.line).stroke();
    doc.roundedRect(contentL + contentW / 2 + 8, y, contentW / 2 - 8, 72, 8).fill(DOC.soft).strokeColor(DOC.line).stroke();
    doc.fillColor(DOC.muted).font('Helvetica-Bold').fontSize(8).text('RECEIPT DETAILS', contentL + 12, y + 10);
    doc.fillColor(DOC.ink).font('Helvetica').fontSize(9);
    doc.text(`Date: ${sale.saleDate.toLocaleString()}`, contentL + 12, y + 26);
    doc.text(`Currency: ${currency}`, contentL + 12, y + 40);
    if (sale.cashier) {
      doc.text(`Cashier: ${sale.cashier.firstName} ${sale.cashier.lastName}`, contentL + 12, y + 54);
    } else if (sale.branch) {
      doc.text(`Branch: ${sale.branch.name}`, contentL + 12, y + 54);
    }
    const rx = contentL + contentW / 2 + 20;
    doc.fillColor(DOC.muted).font('Helvetica-Bold').fontSize(8).text('CUSTOMER', rx, y + 10);
    doc.fillColor(DOC.ink).font('Helvetica').fontSize(9);
    doc.text(customerName(sale.customer), rx, y + 26, { width: contentW / 2 - 28 });
    doc.text(`Payment: ${String(sale.paymentMethod).replace(/_/g, ' ')}`, rx, y + 42);
    doc.text(`Status: ${sale.paymentStatus}`, rx, y + 56);
    doc.restore();
    y += 90;

    const cols: PdfCol[] = [
      { label: 'ITEM', x: contentL, w: contentW * 0.46, align: 'left' },
      { label: 'QTY', x: contentL + contentW * 0.46, w: contentW * 0.12, align: 'right' },
      { label: `UNIT (${currency})`, x: contentL + contentW * 0.58, w: contentW * 0.2, align: 'right' },
      { label: `AMOUNT (${currency})`, x: contentL + contentW * 0.78, w: contentW * 0.22, align: 'right' },
    ];
    // Outer border
    const tableStart = y;
    y = drawTableHeader(doc, cols, y, 22);
    sale.items.forEach((item, idx) => {
      y = drawTableRow(
        doc,
        cols,
        [
          item.productName + (item.sku ? `  (${item.sku})` : ''),
          fmtNum(item.quantity, Number(item.quantity) % 1 ? 2 : 0),
          fmtNumBase(item.unitPrice, ctx),
          fmtNumBase(item.total, ctx),
        ],
        y,
        { alt: idx % 2 === 1, rowH: 20, fontSize: 9 }
      );
    });
    doc
      .strokeColor(DOC.line)
      .lineWidth(0.8)
      .roundedRect(contentL, tableStart, contentW, y - tableStart, 4)
      .stroke();

    y += 14;
    const totalRows = [
      { label: 'Subtotal', value: moneyBase(sale.subtotal, ctx) },
      { label: 'Tax', value: moneyBase(sale.taxAmount, ctx) },
      ...(Number(sale.discountAmount) > 0
        ? [{ label: 'Discount', value: `−${moneyBase(sale.discountAmount, ctx)}` }]
        : []),
      { label: 'TOTAL', value: moneyBase(sale.total, ctx), grand: true },
      { label: 'Paid', value: moneyBase(sale.paidAmount, ctx) },
      ...(Number(sale.changeAmount) > 0
        ? [{ label: 'Change', value: moneyBase(sale.changeAmount, ctx) }]
        : []),
    ];
    drawTotalsBox(doc, contentL + contentW - 230, y, 230, totalRows);

    doc
      .fillColor(DOC.muted)
      .font('Helvetica')
      .fontSize(9)
      .text('Thank you for your business!', contentL, 760, { width: contentW, align: 'center' });
    doc
      .fontSize(8)
      .text(`${ctx.note} · Enterprise IMS · Print-ready PDF`, contentL, 776, {
        width: contentW,
        align: 'center',
      });

    return streamToBuffer(doc);
  }

  // Thermal 58 / 80 mm — compact table
  const pageW = format === 'thermal58' ? 164 : 226;
  const margin = 8;
  const contentW = pageW - margin * 2;
  const estimatedH = 220 + sale.items.length * 28 + 120;
  const doc = new PDFDocument({ size: [pageW, Math.max(500, estimatedH)], margin });

  doc.fillColor(DOC.primary).font('Helvetica-Bold').fontSize(10).text(company?.name || 'Enterprise IMS', {
    align: 'center',
    width: contentW,
  });
  doc.fillColor(DOC.muted).font('Helvetica').fontSize(7);
  if (company?.address) doc.text(company.address, { align: 'center', width: contentW });
  if (company?.phone) doc.text(`Tel: ${company.phone}`, { align: 'center', width: contentW });
  doc.moveDown(0.3);
  doc.fillColor(DOC.ink).font('Helvetica-Bold').fontSize(9).text('SALES RECEIPT', { align: 'center', width: contentW });
  doc.font('Helvetica').fontSize(7);
  doc.text(`No: ${sale.saleNo}`, { align: 'center', width: contentW });
  doc.text(sale.saleDate.toLocaleString(), { align: 'center', width: contentW });
  doc.text(`Currency: ${currency}`, { align: 'center', width: contentW });
  doc.text(`Customer: ${customerName(sale.customer)}`, { width: contentW });
  if (sale.cashier) doc.text(`Cashier: ${sale.cashier.firstName} ${sale.cashier.lastName}`, { width: contentW });
  doc.moveDown(0.25);

  const cols: PdfCol[] = [
    { label: 'ITEM', x: margin, w: contentW * 0.4, align: 'left' },
    { label: 'QTY', x: margin + contentW * 0.4, w: contentW * 0.15, align: 'right' },
    { label: 'PRICE', x: margin + contentW * 0.55, w: contentW * 0.2, align: 'right' },
    { label: 'AMT', x: margin + contentW * 0.75, w: contentW * 0.25, align: 'right' },
  ];
  let y = doc.y + 2;
  y = drawTableHeader(doc, cols, y, 16);
  sale.items.forEach((item, idx) => {
    // Name may need two lines on narrow paper — single line with ellipsis
    y = drawTableRow(
      doc,
      cols,
      [
        item.productName.slice(0, format === 'thermal58' ? 14 : 18),
        fmtNum(item.quantity, Number(item.quantity) % 1 ? 2 : 0),
        fmtNumBase(item.unitPrice, ctx),
        fmtNumBase(item.total, ctx),
      ],
      y,
      { alt: idx % 2 === 1, rowH: 15, fontSize: 7 }
    );
  });

  doc.y = y + 6;
  doc.fillColor(DOC.ink).font('Helvetica').fontSize(7);
  const pair = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(label, margin, doc.y, { width: contentW * 0.5, continued: false });
    const yy = doc.y - 9;
    doc.text(value, margin + contentW * 0.45, yy, { width: contentW * 0.55, align: 'right' });
  };
  pair('Subtotal', fmtNumBase(sale.subtotal, ctx));
  pair('Tax', fmtNumBase(sale.taxAmount, ctx));
  if (Number(sale.discountAmount) > 0) pair('Discount', `-${fmtNumBase(sale.discountAmount, ctx)}`);
  pair('TOTAL', moneyBase(sale.total, ctx), true);
  pair('Paid', fmtNumBase(sale.paidAmount, ctx));
  if (Number(sale.changeAmount) > 0) pair('Change', fmtNumBase(sale.changeAmount, ctx));
  pair('Method', String(sale.paymentMethod).replace(/_/g, ' '));

  doc.moveDown(0.5);
  doc.fillColor(DOC.muted).fontSize(7).text('Thank you for your business!', { align: 'center', width: contentW });
  doc.text(ctx.note, { align: 'center', width: contentW });
  return streamToBuffer(doc);
}

export async function invoicePdfBuffer(
  companyId: string | null | undefined,
  invoiceId: string,
  displayCurrency?: string | null
): Promise<Buffer> {
  const cid = requireCompany(companyId);
  const invoice = await loadInvoice(cid, invoiceId);
  const ctx = await resolvePrintMoney(cid, displayCurrency);
  const currency = ctx.display;
  const company = invoice.company;
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const pageW = 595.28;
  const contentL = 40;
  const contentW = pageW - 80;
  const balance = Number(invoice.total) - Number(invoice.paidAmount);
  const paid = invoice.paymentStatus === 'PAID';

  // Hero
  doc.save();
  doc.rect(0, 0, pageW, 88).fill(DOC.primaryDark);
  doc.rect(0, 84, pageW, 4).fill(DOC.primary);
  doc.fillColor(DOC.white).font('Helvetica-Bold').fontSize(18).text(company?.name || 'Company', 40, 20, {
    width: 300,
  });
  doc.font('Helvetica').fontSize(8).fillColor('#C7D2FE');
  let hy = 44;
  if (company?.address) {
    doc.text(company.address, 40, hy, { width: 300 });
    hy += 11;
  }
  const contact = [company?.phone ? `Tel: ${company.phone}` : '', company?.email || '', company?.taxId ? `Tax: ${company.taxId}` : '']
    .filter(Boolean)
    .join('  ·  ');
  if (contact) doc.text(contact, 40, hy, { width: 300 });

  doc.fillColor(DOC.white).font('Helvetica-Bold').fontSize(20).text('INVOICE', 340, 20, {
    width: 215,
    align: 'right',
  });
  doc.font('Helvetica').fontSize(9).text(invoice.invoiceNo, 340, 44, { width: 215, align: 'right' });
  doc.text(`Date: ${(invoice.issuedAt || invoice.createdAt).toLocaleDateString()}`, 340, 58, {
    width: 215,
    align: 'right',
  });
  if (invoice.dueDate) {
    doc.text(`Due: ${invoice.dueDate.toLocaleDateString()}`, 340, 72, { width: 215, align: 'right' });
  }
  doc.restore();

  // Status badge
  let y = 108;
  doc.save();
  const badgeW = 70;
  doc.roundedRect(pageW - 40 - badgeW, y, badgeW, 18, 9).fill(paid ? DOC.successBg : DOC.warnBg);
  doc
    .fillColor(paid ? DOC.success : DOC.warn)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(invoice.paymentStatus, pageW - 40 - badgeW, y + 5, { width: badgeW, align: 'center' });
  doc.restore();

  y = 110;
  doc.save();
  doc.roundedRect(contentL, y, contentW / 2 - 8, 78, 8).fill(DOC.soft).strokeColor(DOC.line).stroke();
  doc.roundedRect(contentL + contentW / 2 + 8, y, contentW / 2 - 8, 78, 8).fill(DOC.soft).strokeColor(DOC.line).stroke();
  doc.fillColor(DOC.muted).font('Helvetica-Bold').fontSize(8).text('BILL TO', contentL + 12, y + 10);
  doc.fillColor(DOC.ink).font('Helvetica-Bold').fontSize(10).text(customerName(invoice.customer), contentL + 12, y + 26, {
    width: contentW / 2 - 28,
  });
  doc.font('Helvetica').fontSize(8).fillColor(DOC.muted);
  let by = y + 42;
  if (invoice.customer?.phone) {
    doc.text(invoice.customer.phone, contentL + 12, by);
    by += 12;
  }
  if (invoice.customer?.email) doc.text(invoice.customer.email, contentL + 12, by);

  const rx = contentL + contentW / 2 + 20;
  doc.fillColor(DOC.muted).font('Helvetica-Bold').fontSize(8).text('PAYMENT SUMMARY', rx, y + 10);
  doc.fillColor(DOC.ink).font('Helvetica').fontSize(9);
  doc.text(`Currency: ${currency}`, rx, y + 28);
  doc.text(`Total: ${moneyBase(invoice.total, ctx)}`, rx, y + 42);
  doc.text(`Paid: ${moneyBase(invoice.paidAmount, ctx)}`, rx, y + 54);
  doc.font('Helvetica-Bold').text(`Balance: ${moneyBase(balance, ctx)}`, rx, y + 66);
  doc.restore();

  y += 96;
  const cols: PdfCol[] = [
    { label: '#', x: contentL, w: 28, align: 'center' },
    { label: 'DESCRIPTION', x: contentL + 28, w: contentW * 0.36, align: 'left' },
    { label: 'QTY', x: contentL + 28 + contentW * 0.36, w: contentW * 0.12, align: 'right' },
    { label: 'UNIT PRICE', x: contentL + 28 + contentW * 0.48, w: contentW * 0.16, align: 'right' },
    { label: 'TAX', x: contentL + 28 + contentW * 0.64, w: contentW * 0.14, align: 'right' },
    { label: 'AMOUNT', x: contentL + 28 + contentW * 0.78, w: contentW * 0.16 - 28, align: 'right' },
  ];
  // Fix last column width to end at content edge
  cols[5] = {
    label: `AMT (${currency})`,
    x: contentL + contentW * 0.84,
    w: contentW * 0.16,
    align: 'right',
  };
  cols[1] = { label: 'DESCRIPTION', x: contentL + 28, w: contentW * 0.36 - 8, align: 'left' };
  cols[2] = { label: 'QTY', x: contentL + contentW * 0.42, w: contentW * 0.1, align: 'right' };
  cols[3] = { label: 'UNIT PRICE', x: contentL + contentW * 0.52, w: contentW * 0.16, align: 'right' };
  cols[4] = { label: 'TAX', x: contentL + contentW * 0.68, w: contentW * 0.14, align: 'right' };

  const tableStart = y;
  y = drawTableHeader(doc, cols, y, 22);
  invoice.items.forEach((item, idx) => {
    y = drawTableRow(
      doc,
      cols,
      [
        String(idx + 1),
        item.description,
        fmtNum(item.quantity, Number(item.quantity) % 1 ? 2 : 0),
        fmtNumBase(item.unitPrice, ctx),
        fmtNumBase(item.taxAmount, ctx),
        fmtNumBase(item.total, ctx),
      ],
      y,
      { alt: idx % 2 === 1, rowH: 20, fontSize: 9 }
    );
  });
  doc.strokeColor(DOC.line).lineWidth(0.8).roundedRect(contentL, tableStart, contentW, y - tableStart, 4).stroke();

  y += 16;
  drawTotalsBox(doc, contentL + contentW - 240, y, 240, [
    { label: 'Subtotal', value: moneyBase(invoice.subtotal, ctx) },
    { label: 'Tax', value: moneyBase(invoice.taxAmount, ctx) },
    ...(Number(invoice.discountAmount) > 0
      ? [{ label: 'Discount', value: `−${moneyBase(invoice.discountAmount, ctx)}` }]
      : []),
    { label: 'TOTAL', value: moneyBase(invoice.total, ctx), grand: true },
    { label: 'Amount paid', value: moneyBase(invoice.paidAmount, ctx) },
    { label: 'Balance due', value: moneyBase(balance, ctx) },
  ]);

  if (invoice.notes) {
    doc
      .fillColor(DOC.ink)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Notes', contentL, y + 8);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(DOC.muted)
      .text(invoice.notes, contentL, y + 22, { width: contentW * 0.5 });
  }

  doc
    .fillColor(DOC.muted)
    .font('Helvetica')
    .fontSize(8)
    .text(`${ctx.note} · Generated by Enterprise IMS`, contentL, 770, {
      width: contentW,
      align: 'center',
    });

  return streamToBuffer(doc);
}

// ═══════════════════════════════════════════════════════════
// Public API helpers
// ═══════════════════════════════════════════════════════════

export async function getSalePrintBundle(
  companyId: string | null | undefined,
  saleId: string,
  displayCurrency?: string | null
) {
  const cid = requireCompany(companyId);
  const sale = await loadSale(cid, saleId);
  const ctx = await resolvePrintMoney(cid, displayCurrency);
  const q = encodeURIComponent(ctx.display);
  return {
    type: 'receipt' as const,
    id: sale.id,
    number: sale.saleNo,
    title: `Receipt ${sale.saleNo}`,
    companyName: sale.company?.name || 'Enterprise IMS',
    customerName: customerName(sale.customer),
    customerEmail: sale.customer?.email || null,
    customerPhone: sale.customer?.phone || null,
    total: fromBase(sale.total, ctx),
    totalBase: Number(sale.total),
    currency: ctx.display,
    baseCurrency: ctx.base,
    currencyNote: ctx.note,
    date: sale.saleDate,
    shareText: buildShareTextReceipt(sale, ctx),
    formats: {
      pdfThermal80: `/api/v1/sales/${sale.id}/print/pdf?format=thermal80&currency=${q}`,
      pdfThermal58: `/api/v1/sales/${sale.id}/print/pdf?format=thermal58&currency=${q}`,
      pdfA4: `/api/v1/sales/${sale.id}/print/pdf?format=a4&currency=${q}`,
      html: `/api/v1/sales/${sale.id}/print/html?currency=${q}`,
      htmlAutoPrint: `/api/v1/sales/${sale.id}/print/html?autoPrint=1&currency=${q}`,
      text: `/api/v1/sales/${sale.id}/print/text?currency=${q}`,
      escpos: `/api/v1/sales/${sale.id}/print/escpos?currency=${q}`,
    },
  };
}

export async function getInvoicePrintBundle(
  companyId: string | null | undefined,
  invoiceId: string,
  displayCurrency?: string | null
) {
  const cid = requireCompany(companyId);
  const invoice = await loadInvoice(cid, invoiceId);
  const ctx = await resolvePrintMoney(cid, displayCurrency);
  const q = encodeURIComponent(ctx.display);
  return {
    type: 'invoice' as const,
    id: invoice.id,
    number: invoice.invoiceNo,
    title: `Invoice ${invoice.invoiceNo}`,
    companyName: invoice.company?.name || 'Company',
    customerName: customerName(invoice.customer),
    customerEmail: invoice.customer?.email || null,
    customerPhone: invoice.customer?.phone || null,
    total: fromBase(invoice.total, ctx),
    totalBase: Number(invoice.total),
    balance: fromBase(Number(invoice.total) - Number(invoice.paidAmount), ctx),
    currency: ctx.display,
    baseCurrency: ctx.base,
    currencyNote: ctx.note,
    date: invoice.issuedAt || invoice.createdAt,
    shareText: buildShareTextInvoice(invoice, ctx),
    formats: {
      pdf: `/api/v1/invoices/${invoice.id}/print/pdf?currency=${q}`,
      html: `/api/v1/invoices/${invoice.id}/print/html?currency=${q}`,
      htmlAutoPrint: `/api/v1/invoices/${invoice.id}/print/html?autoPrint=1&currency=${q}`,
      text: `/api/v1/invoices/${invoice.id}/print/text?currency=${q}`,
      escpos: `/api/v1/invoices/${invoice.id}/print/escpos?currency=${q}`,
    },
  };
}

function buildShareTextReceipt(sale: Awaited<ReturnType<typeof loadSale>>, ctx: PrintMoneyCtx) {
  return [
    `${sale.company?.name || 'Store'} — Sales Receipt`,
    `Receipt: ${sale.saleNo}`,
    `Date: ${sale.saleDate.toLocaleString()}`,
    `Customer: ${customerName(sale.customer)}`,
    `Total: ${moneyBase(sale.total, ctx)}`,
    `Currency: ${ctx.display}`,
    `Paid via: ${sale.paymentMethod}`,
    `Status: ${sale.paymentStatus}`,
    '',
    'Thank you for your business!',
  ].join('\n');
}

function buildShareTextInvoice(invoice: Awaited<ReturnType<typeof loadInvoice>>, ctx: PrintMoneyCtx) {
  const balance = Number(invoice.total) - Number(invoice.paidAmount);
  return [
    `${invoice.company?.name || 'Company'} — Invoice`,
    `Invoice: ${invoice.invoiceNo}`,
    `Date: ${(invoice.issuedAt || invoice.createdAt).toLocaleDateString()}`,
    `Bill To: ${customerName(invoice.customer)}`,
    `Total: ${moneyBase(invoice.total, ctx)}`,
    `Paid: ${moneyBase(invoice.paidAmount, ctx)}`,
    `Balance Due: ${moneyBase(balance, ctx)}`,
    `Currency: ${ctx.display}`,
    `Status: ${invoice.paymentStatus}`,
  ].join('\n');
}

export async function emailDocument(
  companyId: string | null | undefined,
  kind: 'receipt' | 'invoice',
  id: string,
  toEmail?: string,
  displayCurrency?: string | null
) {
  const cid = requireCompany(companyId);
  const moneyCtx = await resolvePrintMoney(cid, displayCurrency);
  if (kind === 'receipt') {
    const sale = await loadSale(cid, id);
    const email = toEmail || sale.customer?.email;
    if (!email) throw new ValidationError('No email address available for this customer');
    const pdf = await receiptPdf(cid, id, 'a4', displayCurrency);
    const text = buildPlainTextReceipt(sale, moneyCtx);
    const html = buildReceiptHtml(sale, { moneyCtx }).replace(
      /<div class="actions">[\s\S]*?<\/div>/,
      ''
    );
    const result = await sendDocumentEmail({
      to: email,
      subject: `Receipt ${sale.saleNo} — ${sale.company?.name || 'Enterprise IMS'}`,
      text,
      html,
      pdf,
      filename: `${sale.saleNo}.pdf`,
    });
    return {
      ...result,
      preview: result.sent ? undefined : text,
    };
  }

  const invoice = await loadInvoice(cid, id);
  const email = toEmail || invoice.customer?.email;
  if (!email) throw new ValidationError('No email address available for this customer');
  const pdf = await invoicePdfBuffer(cid, id, displayCurrency);
  const text = buildPlainTextInvoice(invoice, moneyCtx);
  const html = buildInvoiceHtml(invoice, { moneyCtx }).replace(
    /<div class="actions">[\s\S]*?<\/div>/,
    ''
  );
  const result = await sendDocumentEmail({
    to: email,
    subject: `Invoice ${invoice.invoiceNo} — ${invoice.company?.name || 'Enterprise IMS'}`,
    text,
    html,
    pdf,
    filename: `${invoice.invoiceNo}.pdf`,
  });
  return {
    ...result,
    preview: result.sent ? undefined : text,
  };
}


