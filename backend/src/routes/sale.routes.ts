import { Router } from 'express';
import * as saleController from '../controllers/sale.controller';
import * as ops from '../controllers/ops.controller';
import {
  authenticate,
  requireTenant,
  requirePermissions,
  requireSalesAdmin,
} from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createSaleSchema, openShiftSchema, closeShiftSchema } from '../validators/sale.validator';
import { auditLog } from '../middleware/audit';

const router = Router();

router.use(authenticate, requireTenant);

router.get('/', requirePermissions('sales.read'), saleController.list);
router.get('/shifts/current', requirePermissions('pos.access'), saleController.currentShift);
router.post(
  '/shifts/open',
  requirePermissions('pos.access'),
  validate(openShiftSchema),
  saleController.openShift
);
router.post(
  '/shifts/:id/close',
  requirePermissions('pos.access'),
  validate(closeShiftSchema),
  saleController.closeShift
);
router.get(
  '/shifts/:id/z-report.pdf',
  requirePermissions('pos.access'),
  saleController.zReportPdf
);
// Offline bulk sync must be registered before /:id
router.post('/sync-offline', requirePermissions('pos.access'), ops.syncOffline);
router.post(
  '/',
  requirePermissions('pos.access'),
  validate(createSaleSchema),
  auditLog('sales'),
  saleController.create
);
router.get('/:id', requirePermissions('sales.read'), saleController.getById);
// Refund / delete / void — managers only (not cashiers / sales staff)
router.post(
  '/:id/refund',
  requireSalesAdmin,
  auditLog('refunds'),
  saleController.refund
);
router.delete(
  '/:id',
  requireSalesAdmin,
  auditLog('sales'),
  saleController.remove
);
// Also accept POST void for clients that cannot send DELETE easily
router.post(
  '/:id/void',
  requireSalesAdmin,
  auditLog('sales'),
  saleController.remove
);

export default router;
