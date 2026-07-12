import { Request, Response } from 'express';
import * as invoiceService from '../services/invoice.service';
import * as inventoryOps from '../services/inventoryOps.service';
import * as reportService from '../services/report.service';
import * as pdfService from '../services/pdf.service';
import * as printService from '../services/print.service';
import * as userAdmin from '../services/userAdmin.service';
import * as saleService from '../services/sale.service';
import { success, created, paginated } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { getPagination } from '../utils/pagination';
import { UserStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { ForbiddenError } from '../utils/errors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';

// ── Invoices ──────────────────────────────────────────────
export const listInvoices = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  const { data, total } = await invoiceService.listInvoices(req.companyId, {
    ...pagination,
    status: req.query.status as string | undefined,
    paymentStatus: req.query.paymentStatus as string | undefined,
    customerId: req.query.customerId as string | undefined,
  });
  return paginated(res, data, pagination.page, pagination.limit, total);
});

export const getInvoice = asyncHandler(async (req: Request, res: Response) => {
  return success(res, await invoiceService.getInvoice(req.companyId, req.params.id));
});

export const invoiceSummary = asyncHandler(async (req: Request, res: Response) => {
  return success(res, await invoiceService.invoiceSummary(req.companyId));
});

export const createInvoice = asyncHandler(async (req: Request, res: Response) => {
  return created(res, await invoiceService.createInvoice(req.companyId, req.body), 'Invoice created');
});

export const invoiceFromSale = asyncHandler(async (req: Request, res: Response) => {
  return created(
    res,
    await invoiceService.createInvoiceFromSale(req.companyId, req.params.saleId),
    'Invoice created from sale'
  );
});

export const payInvoice = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await invoiceService.recordInvoicePayment(req.companyId, req.params.id, req.body),
    'Payment recorded'
  );
});

export const voidInvoice = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await invoiceService.voidInvoice(req.companyId, req.params.id, req.body?.reason),
    'Invoice voided'
  );
});

export const deleteInvoice = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await invoiceService.deleteInvoice(req.companyId, req.params.id),
    'Invoice deleted'
  );
});

export const invoicePdf = asyncHandler(async (req: Request, res: Response) => {
  const buf = await printService.invoicePdfBuffer(req.companyId, req.params.id);
  const download = req.query.download === '1' || req.query.download === 'true';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="invoice-${req.params.id}.pdf"`
  );
  return res.send(buf);
});

// ── Inventory ops ─────────────────────────────────────────
export const stockLevels = asyncHandler(async (req: Request, res: Response) => {
  return success(res, await inventoryOps.listStockLevels(req.companyId, req.query.warehouseId as string));
});

export const stockMovements = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  const { data, total } = await inventoryOps.listMovements(req.companyId, {
    ...pagination,
    productId: req.query.productId as string | undefined,
    warehouseId: req.query.warehouseId as string | undefined,
  });
  return paginated(res, data, pagination.page, pagination.limit, total);
});

export const adjustStock = asyncHandler(async (req: Request, res: Response) => {
  return created(
    res,
    await inventoryOps.adjustStock(req.companyId, req.user!.id, req.body),
    'Stock adjusted'
  );
});

export const createTransfer = asyncHandler(async (req: Request, res: Response) => {
  return created(
    res,
    await inventoryOps.createTransfer(req.companyId, req.user!.id, req.body),
    'Transfer completed'
  );
});

export const listTransfers = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  const { data, total } = await inventoryOps.listTransfers(req.companyId, pagination);
  return paginated(res, data, pagination.page, pagination.limit, total);
});

// ── Reports ───────────────────────────────────────────────
export const salesReport = asyncHandler(async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  return success(res, await reportService.salesReport(req.companyId, from, to));
});

export const inventoryReport = asyncHandler(async (req: Request, res: Response) => {
  return success(res, await reportService.inventoryReport(req.companyId));
});

export const profitReport = asyncHandler(async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  return success(res, await reportService.profitReport(req.companyId, from, to));
});

export const customerBalances = asyncHandler(async (req: Request, res: Response) => {
  return success(res, await reportService.customerBalances(req.companyId));
});

export const exportSalesExcel = asyncHandler(async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  const buf = await reportService.exportSalesExcel(req.companyId, from, to);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="sales-report.xlsx"');
  return res.send(buf);
});

export const exportInventoryExcel = asyncHandler(async (req: Request, res: Response) => {
  const buf = await reportService.exportInventoryExcel(req.companyId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory-report.xlsx"');
  return res.send(buf);
});

export const exportSalesCsv = asyncHandler(async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  const csv = await reportService.salesCsv(req.companyId, from, to);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sales-report.csv"');
  return res.send(csv);
});

// ── Report PDFs (table layout) ────────────────────────────
export const salesReportPdf = asyncHandler(async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  const { salesReportPdf: build } = await import('../services/reportPdf.service');
  const buf = await build(req.companyId, from, to);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="sales-report.pdf"');
  return res.send(buf);
});

export const inventoryReportPdf = asyncHandler(async (req: Request, res: Response) => {
  const { inventoryReportPdf: build } = await import('../services/reportPdf.service');
  const buf = await build(req.companyId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory-report.pdf"');
  return res.send(buf);
});

export const profitReportPdf = asyncHandler(async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  const { profitReportPdf: build } = await import('../services/reportPdf.service');
  const buf = await build(req.companyId, from, to);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="profit-report.pdf"');
  return res.send(buf);
});

export const customerBalancesPdf = asyncHandler(async (req: Request, res: Response) => {
  const { customerBalancesPdf: build } = await import('../services/reportPdf.service');
  const buf = await build(req.companyId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="customer-balances.pdf"');
  return res.send(buf);
});

// ── PDF receipt (legacy + enhanced) ───────────────────────
function queryCurrency(req: { query: Record<string, unknown> }): string | undefined {
  const c = req.query.currency;
  return typeof c === 'string' && c.trim() ? c.trim() : undefined;
}

export const saleReceiptPdf = asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as 'thermal80' | 'thermal58' | 'a4') || 'a4';
  const download = req.query.download === '1' || req.query.download === 'true';
  const buf = await printService.receiptPdf(req.companyId, req.params.id, format, queryCurrency(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="receipt-${req.params.id}-${format}.pdf"`
  );
  return res.send(buf);
});

// ── Print / Share suite ───────────────────────────────────
export const salePrintMeta = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await printService.getSalePrintBundle(req.companyId, req.params.id, queryCurrency(req))
  );
});

export const salePrintHtml = asyncHandler(async (req: Request, res: Response) => {
  const sale = await printService.loadSale(req.companyId!, req.params.id);
  const moneyCtx = await printService.resolvePrintMoney(req.companyId!, queryCurrency(req));
  const html = printService.buildReceiptHtml(sale, {
    autoPrint: req.query.autoPrint === '1' || req.query.autoPrint === 'true',
    moneyCtx,
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(html);
});

export const salePrintText = asyncHandler(async (req: Request, res: Response) => {
  const sale = await printService.loadSale(req.companyId!, req.params.id);
  const moneyCtx = await printService.resolvePrintMoney(req.companyId!, queryCurrency(req));
  const text = printService.buildPlainTextReceipt(sale, moneyCtx);
  const download = req.query.download !== '0';
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${sale.saleNo}.txt"`
  );
  return res.send(text);
});

export const salePrintEscPos = asyncHandler(async (req: Request, res: Response) => {
  const sale = await printService.loadSale(req.companyId!, req.params.id);
  const moneyCtx = await printService.resolvePrintMoney(req.companyId!, queryCurrency(req));
  const width = req.query.width === '32' ? 32 : 42;
  const buf = printService.buildEscPosReceipt(sale, width as 32 | 42, moneyCtx);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${sale.saleNo}.bin"`);
  res.setHeader('X-Print-Protocol', 'ESC/POS');
  res.setHeader('X-Printer-Compatible', 'RawBT,QZ Tray,PrintNode,Generic Thermal');
  return res.send(buf);
});

export const invoicePrintMeta = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await printService.getInvoicePrintBundle(req.companyId, req.params.id, queryCurrency(req))
  );
});

export const invoicePrintHtml = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await printService.loadInvoice(req.companyId!, req.params.id);
  const moneyCtx = await printService.resolvePrintMoney(req.companyId!, queryCurrency(req));
  const html = printService.buildInvoiceHtml(invoice, {
    autoPrint: req.query.autoPrint === '1' || req.query.autoPrint === 'true',
    moneyCtx,
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(html);
});

export const invoicePrintText = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await printService.loadInvoice(req.companyId!, req.params.id);
  const moneyCtx = await printService.resolvePrintMoney(req.companyId!, queryCurrency(req));
  const text = printService.buildPlainTextInvoice(invoice, moneyCtx);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNo}.txt"`);
  return res.send(text);
});

export const invoicePrintEscPos = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await printService.loadInvoice(req.companyId!, req.params.id);
  const moneyCtx = await printService.resolvePrintMoney(req.companyId!, queryCurrency(req));
  const buf = printService.buildEscPosInvoice(invoice, 42, moneyCtx);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNo}.bin"`);
  res.setHeader('X-Print-Protocol', 'ESC/POS');
  return res.send(buf);
});

export const invoicePrintPdf = asyncHandler(async (req: Request, res: Response) => {
  const download = req.query.download === '1' || req.query.download === 'true';
  const buf = await printService.invoicePdfBuffer(req.companyId, req.params.id, queryCurrency(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="invoice-${req.params.id}.pdf"`
  );
  return res.send(buf);
});

export const salePrintPdf = asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as 'thermal80' | 'thermal58' | 'a4') || 'a4';
  const download = req.query.download === '1' || req.query.download === 'true';
  const buf = await printService.receiptPdf(
    req.companyId,
    req.params.id,
    format,
    queryCurrency(req)
  );
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="receipt-${req.params.id}-${format}.pdf"`
  );
  return res.send(buf);
});

export const shareEmail = asyncHandler(async (req: Request, res: Response) => {
  const kind =
    req.params.kind === 'invoice' || req.baseUrl?.includes('invoice') || req.originalUrl.includes('/invoices/')
      ? 'invoice'
      : 'receipt';
  const result = await printService.emailDocument(
    req.companyId,
    kind,
    req.params.id,
    req.body?.to,
    req.body?.currency || queryCurrency(req)
  );
  return success(res, result, result.sent ? 'Email sent' : 'Email not sent');
});

export const refundSale = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await saleService.refundSale(req.companyId, req.user!.id, req.params.id, req.body),
    'Sale refunded'
  );
});

export const syncOffline = asyncHandler(async (req: Request, res: Response) => {
  const sales = Array.isArray(req.body.sales) ? req.body.sales : [];
  const results = await saleService.syncOfflineSales(req.companyId, req.user!.id, sales);
  return success(res, results, 'Offline sales processed');
});

// ── Users / org ───────────────────────────────────────────
export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  const { data, total } = await userAdmin.listUsers(req.companyId, {
    ...pagination,
    status: req.query.status as UserStatus | undefined,
    pendingOnly: req.query.pending === 'true' || req.query.pendingOnly === 'true',
  });
  return paginated(res, data, pagination.page, pagination.limit, total);
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await userAdmin.createUser(req.companyId, req.body);
  return created(
    res,
    user,
    user.pendingApproval ? 'Staff created — pending approval' : 'User created'
  );
});

export const updateUserStatus = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await userAdmin.updateUserStatus(req.companyId, req.params.id, req.body.status as UserStatus)
  );
});

export const approveStaff = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await userAdmin.approveStaff(req.companyId, req.params.id, req.user!.id),
    'Staff approved'
  );
});

export const rejectStaff = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await userAdmin.rejectStaff(req.companyId, req.params.id, req.user!.id, req.body?.reason),
    'Staff rejected'
  );
});

export const pendingStaffCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await userAdmin.countPendingStaff(req.companyId);
  return success(res, { count });
});

export const getStaff = asyncHandler(async (req: Request, res: Response) => {
  return success(res, await userAdmin.getStaff(req.companyId, req.params.id));
});

export const updateStaff = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await userAdmin.updateStaff(req.companyId, req.params.id, req.user!.id, req.body),
    'Staff updated'
  );
});

export const listPermissions = asyncHandler(async (_req: Request, res: Response) => {
  return success(res, await userAdmin.listPermissionCatalog());
});

export const getStaffPermissions = asyncHandler(async (req: Request, res: Response) => {
  return success(res, await userAdmin.getStaffPermissions(req.companyId, req.params.id));
});

export const setStaffPermissions = asyncHandler(async (req: Request, res: Response) => {
  const codes = Array.isArray(req.body?.permissions)
    ? req.body.permissions
    : Array.isArray(req.body?.codes)
      ? req.body.codes
      : [];
  return success(
    res,
    await userAdmin.setStaffPermissions(req.companyId, req.params.id, req.user!.id, codes),
    'Staff access updated'
  );
});

export const resetStaffPermissions = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await userAdmin.resetStaffPermissions(req.companyId, req.params.id, req.user!.id),
    'Staff access reset to role defaults'
  );
});

export const setStaffPassword = asyncHandler(async (req: Request, res: Response) => {
  const password =
    req.body.password && String(req.body.password).length >= 8
      ? String(req.body.password)
      : userAdmin.generateTempPassword();
  return success(
    res,
    await userAdmin.setStaffPassword(req.companyId, req.params.id, req.user!.id, password),
    'Password updated'
  );
});

export const deleteStaff = asyncHandler(async (req: Request, res: Response) => {
  return success(
    res,
    await userAdmin.deleteStaff(req.companyId, req.params.id, req.user!.id),
    'Staff deleted'
  );
});

export const generatePassword = asyncHandler(async (_req: Request, res: Response) => {
  return success(res, { password: userAdmin.generateTempPassword() });
});

export const listRoles = asyncHandler(async (req: Request, res: Response) => {
  return success(res, await userAdmin.listRoles(req.companyId));
});

export const createBranch = asyncHandler(async (req: Request, res: Response) => {
  return created(res, await userAdmin.createBranch(req.companyId, req.body));
});

export const createWarehouse = asyncHandler(async (req: Request, res: Response) => {
  return created(res, await userAdmin.createWarehouse(req.companyId, req.body));
});

export const createEmployee = asyncHandler(async (req: Request, res: Response) => {
  return created(res, await userAdmin.createEmployee(req.companyId, req.body));
});

// ── Purchase get ──────────────────────────────────────────
export const getPurchase = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: req.params.id, companyId: req.companyId },
    include: {
      supplier: true,
      items: { include: { product: { select: { id: true, name: true, sku: true } } } },
    },
  });
  return success(res, po);
});

// ── Upload ────────────────────────────────────────────────
const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: (env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp|pdf|csv|xlsx/.test(path.extname(file.originalname).toLowerCase()) ||
      file.mimetype.startsWith('image/');
    cb(null, ok);
  },
});

export const uploadFile = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  const url = `/uploads/${file.filename}`;
  return created(res, { url, filename: file.filename, size: file.size, mimetype: file.mimetype });
});

// ── Taxes / Units ─────────────────────────────────────────
export const listTaxes = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  return success(res, await prisma.tax.findMany({ where: { companyId: req.companyId, isActive: true } }));
});

export const listUnits = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  return success(res, await prisma.unit.findMany({ where: { companyId: req.companyId } }));
});

export const createTax = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  const tax = await prisma.tax.create({
    data: {
      companyId: req.companyId,
      name: req.body.name,
      code: req.body.code,
      rate: req.body.rate,
      isInclusive: req.body.isInclusive ?? false,
    },
  });
  return created(res, tax);
});
