import { Router } from 'express';
import * as ops from '../controllers/ops.controller';
import {
  authenticate,
  requireTenant,
  requirePermissions,
  requireAnyPermission,
  requireSalesAdmin,
} from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { z } from 'zod';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate, requireTenant);

// Invoices
router.get('/invoices', requirePermissions('sales.read'), ops.listInvoices);
router.get('/invoices/summary', requirePermissions('sales.read'), ops.invoiceSummary);
router.get('/invoices/:id', requirePermissions('sales.read'), ops.getInvoice);
router.get('/invoices/:id/pdf', requirePermissions('sales.read'), ops.invoicePdf);
router.post(
  '/invoices',
  requirePermissions('sales.create'),
  validate(
    z.object({
      customerId: z.string().uuid().optional().nullable(),
      dueDate: z.coerce.date().optional().nullable(),
      notes: z.string().optional().nullable(),
      discountAmount: z.coerce.number().min(0).default(0),
      items: z
        .array(
          z.object({
            productId: z.string().uuid().optional().nullable(),
            description: z.string().min(1),
            quantity: z.coerce.number().positive(),
            unitPrice: z.coerce.number().min(0),
            discount: z.coerce.number().min(0).optional(),
            taxAmount: z.coerce.number().min(0).optional(),
            taxRate: z.coerce.number().min(0).optional(), // convenience: % tax if taxAmount omitted
          })
        )
        .min(1),
    })
  ),
  auditLog('invoices'),
  ops.createInvoice
);
router.post('/invoices/from-sale/:saleId', requirePermissions('sales.create'), auditLog('invoices'), ops.invoiceFromSale);
router.post(
  '/invoices/:id/payments',
  requirePermissions('sales.create'),
  validate(
    z.object({
      amount: z.coerce.number().positive(),
      method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHEQUE', 'CREDIT', 'OTHER']),
      reference: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      currency: z.string().trim().min(3).max(3).optional().nullable(),
      exchangeRate: z.coerce.number().positive().optional().nullable(),
    })
  ),
  auditLog('payments'),
  ops.payInvoice
);
router.post(
  '/invoices/:id/void',
  requirePermissions('sales.create'),
  validate(z.object({ reason: z.string().max(500).optional().nullable() })),
  auditLog('invoices'),
  ops.voidInvoice
);
router.delete(
  '/invoices/:id',
  requirePermissions('sales.create'),
  auditLog('invoices'),
  ops.deleteInvoice
);

// Inventory ops
router.get('/stock', requirePermissions('inventory.products.read'), ops.stockLevels);
router.get('/stock/movements', requirePermissions('inventory.products.read'), ops.stockMovements);
router.get('/stock/transfers', requirePermissions('inventory.stock.transfer'), ops.listTransfers);
router.post(
  '/stock/adjust',
  requirePermissions('inventory.stock.adjust'),
  validate(
    z.object({
      warehouseId: z.string().uuid(),
      reason: z.string().min(1),
      notes: z.string().optional().nullable(),
      items: z.array(z.object({ productId: z.string().uuid(), countedQty: z.coerce.number().min(0) })).min(1),
    })
  ),
  auditLog('stock_adjust'),
  ops.adjustStock
);
router.post(
  '/stock/transfers',
  requirePermissions('inventory.stock.transfer'),
  validate(
    z.object({
      fromWarehouseId: z.string().uuid(),
      toWarehouseId: z.string().uuid(),
      notes: z.string().optional().nullable(),
      items: z.array(z.object({ productId: z.string().uuid(), quantity: z.coerce.number().positive() })).min(1),
    })
  ),
  auditLog('stock_transfer'),
  ops.createTransfer
);

// Sales extras + print/share (sales.read OR pos.access so cashiers can print receipts)
router.get('/sales/:id/receipt.pdf', requireAnyPermission('sales.read', 'pos.access'), ops.saleReceiptPdf);
router.get('/sales/:id/print', requireAnyPermission('sales.read', 'pos.access'), ops.salePrintMeta);
router.get('/sales/:id/print/pdf', requireAnyPermission('sales.read', 'pos.access'), ops.salePrintPdf);
router.get('/sales/:id/print/html', requireAnyPermission('sales.read', 'pos.access'), ops.salePrintHtml);
router.get('/sales/:id/print/text', requireAnyPermission('sales.read', 'pos.access'), ops.salePrintText);
router.get('/sales/:id/print/escpos', requireAnyPermission('sales.read', 'pos.access'), ops.salePrintEscPos);
router.post('/sales/:id/share/email', requireAnyPermission('sales.read', 'pos.access'), ops.shareEmail);
// Managers only — staff cannot refund via this alias either
router.post('/sales/:id/refund', requireSalesAdmin, auditLog('refunds'), ops.refundSale);
router.post('/sales/sync-offline', requirePermissions('pos.access'), ops.syncOffline);

// Invoice print/share (in addition to existing /invoices/:id/pdf)
router.get('/invoices/:id/print', requirePermissions('sales.read'), ops.invoicePrintMeta);
router.get('/invoices/:id/print/pdf', requirePermissions('sales.read'), ops.invoicePrintPdf);
router.get('/invoices/:id/print/html', requirePermissions('sales.read'), ops.invoicePrintHtml);
router.get('/invoices/:id/print/text', requirePermissions('sales.read'), ops.invoicePrintText);
router.get('/invoices/:id/print/escpos', requirePermissions('sales.read'), ops.invoicePrintEscPos);
router.post('/invoices/:id/share/email', requirePermissions('sales.read'), async (req, res, next) => {
  req.params.kind = 'invoice';
  return ops.shareEmail(req, res, next);
});

// Reports
router.get('/reports/sales', requirePermissions('reports.read'), ops.salesReport);
router.get('/reports/inventory', requirePermissions('reports.read'), ops.inventoryReport);
router.get('/reports/profit', requirePermissions('reports.read'), ops.profitReport);
router.get('/reports/product-profit', requirePermissions('reports.read'), ops.productProfitReport);
router.get('/reports/customer-balances', requirePermissions('reports.read'), ops.customerBalances);
router.get('/reports/sales.xlsx', requirePermissions('reports.read'), ops.exportSalesExcel);
router.get('/reports/inventory.xlsx', requirePermissions('reports.read'), ops.exportInventoryExcel);
router.get('/reports/sales.csv', requirePermissions('reports.read'), ops.exportSalesCsv);
router.get('/reports/customers.csv', requirePermissions('reports.read'), ops.exportCustomersCsv);
router.get('/reports/products.csv', requirePermissions('reports.read'), ops.exportProductsCsv);
router.get('/reports/expenses.csv', requirePermissions('reports.read'), ops.exportExpensesCsv);
router.get(
  '/reports/backup.txt',
  requireAnyPermission('reports.read', 'settings.company'),
  ops.exportBackup
);

// Expenses (operating costs for net profit)
router.get('/expenses', requireAnyPermission('accounting.read', 'reports.read'), ops.listExpenses);
router.post(
  '/expenses',
  requireAnyPermission('accounting.read', 'settings.company', 'reports.read'),
  auditLog('expenses'),
  ops.createExpense
);
router.delete(
  '/expenses/:id',
  requireAnyPermission('accounting.read', 'settings.company'),
  auditLog('expenses'),
  ops.deleteExpense
);
router.get('/reports/sales.pdf', requirePermissions('reports.read'), ops.salesReportPdf);
router.get('/reports/inventory.pdf', requirePermissions('reports.read'), ops.inventoryReportPdf);
router.get('/reports/profit.pdf', requirePermissions('reports.read'), ops.profitReportPdf);
router.get(
  '/reports/customer-balances.pdf',
  requirePermissions('reports.read'),
  ops.customerBalancesPdf
);
router.get('/reports/ar-aging', requirePermissions('reports.read'), ops.arAgingReport);
router.get('/reports/ar-aging.pdf', requirePermissions('reports.read'), ops.arAgingPdf);

// Users & org (static paths before :id)
router.get('/users/pending/count', requirePermissions('users.manage'), ops.pendingStaffCount);
router.get('/users/generate-password', requirePermissions('users.manage'), ops.generatePassword);
router.get('/permissions', requirePermissions('users.manage'), ops.listPermissions);
router.get('/users', requirePermissions('users.manage'), ops.listUsers);
router.get('/users/:id', requirePermissions('users.manage'), ops.getStaff);
router.get(
  '/users/:id/permissions',
  requirePermissions('users.manage'),
  ops.getStaffPermissions
);
router.put(
  '/users/:id/permissions',
  requirePermissions('users.manage'),
  validate(
    z.object({
      permissions: z.array(z.string().min(1)).optional(),
      codes: z.array(z.string().min(1)).optional(),
    })
  ),
  auditLog('users'),
  ops.setStaffPermissions
);
router.post(
  '/users/:id/permissions/reset',
  requirePermissions('users.manage'),
  auditLog('users'),
  ops.resetStaffPermissions
);
router.post(
  '/users',
  requirePermissions('users.manage'),
  validate(
    z.object({
      email: z.string().email(),
      password: z.string().min(8).optional(), // optional — server can generate
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      phone: z.string().optional(),
      branchId: z.string().uuid().optional().nullable(),
      roleCode: z.string().optional(),
    })
  ),
  auditLog('users'),
  ops.createUser
);
router.put(
  '/users/:id',
  requirePermissions('users.manage'),
  validate(
    z.object({
      email: z.string().email().optional(),
      firstName: z.string().min(1).optional(),
      lastName: z.string().min(1).optional(),
      phone: z.string().optional().nullable(),
      branchId: z.string().uuid().optional().nullable(),
      roleCode: z.string().optional(),
    })
  ),
  auditLog('users'),
  ops.updateStaff
);
router.post(
  '/users/:id/password',
  requirePermissions('users.manage'),
  validate(
    z.object({
      password: z.string().min(8).optional(),
    })
  ),
  auditLog('users'),
  ops.setStaffPassword
);
router.delete('/users/:id', requirePermissions('users.manage'), auditLog('users'), ops.deleteStaff);
router.patch('/users/:id/status', requirePermissions('users.manage'), auditLog('users'), ops.updateUserStatus);
router.post('/users/:id/approve', requirePermissions('users.manage'), auditLog('users'), ops.approveStaff);
router.post(
  '/users/:id/reject',
  requirePermissions('users.manage'),
  validate(z.object({ reason: z.string().max(500).optional() })),
  auditLog('users'),
  ops.rejectStaff
);
router.get('/roles', requirePermissions('users.manage'), ops.listRoles);
router.post('/branches', requirePermissions('settings.company'), auditLog('branches'), ops.createBranch);
router.post('/warehouses', requirePermissions('settings.company'), auditLog('warehouses'), ops.createWarehouse);
router.post(
  '/employees',
  requirePermissions('hr.employees.read'),
  validate(
    z.object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      position: z.string().optional(),
      salary: z.coerce.number().optional(),
      branchId: z.string().uuid().optional(),
    })
  ),
  auditLog('employees'),
  ops.createEmployee
);

router.get('/purchases/:id', requirePermissions('purchases.read'), ops.getPurchase);
router.get('/taxes', ops.listTaxes);
router.post('/taxes', requirePermissions('settings.company'), ops.createTax);
router.get('/units', ops.listUnits);

// Product photos (stored as durable data URLs so web / Android / desktop all see the same image)
router.post(
  '/uploads',
  requireAnyPermission('inventory.products.create', 'inventory.products.update'),
  ops.upload.single('file'),
  ops.uploadFile
);

export default router;
