import { Router } from 'express';
import { z } from 'zod';
import * as platformController from '../controllers/platform.controller';
import { authenticate, requireRoles } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { auditLog } from '../middleware/audit';
import { RoleCode } from '@prisma/client';

const router = Router();

router.use(authenticate, requireRoles(RoleCode.SUPER_ADMIN));

/**
 * Platform Super Admin — monitor all registered businesses
 */
router.get('/overview', platformController.overview);
router.get('/companies', platformController.listCompanies);
router.get('/companies/:id', platformController.getCompany);
router.get('/companies/:id/sales', platformController.companySales);
router.get('/companies/:id/sales/:saleId', platformController.companySaleDetail);
router.get('/companies/:id/credentials', platformController.companyCredentials);
router.post(
  '/companies/:id/users/:userId/password',
  validate(
    z.object({
      /** Optional custom password; omit to auto-generate a strong temp password */
      password: z.string().min(8).max(128).optional().nullable(),
    })
  ),
  auditLog('platform'),
  platformController.resetCompanyUserPassword
);
router.patch(
  '/companies/:id/status',
  validate(
    z.object({
      status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL', 'EXPIRED', 'CANCELLED']),
      note: z.string().max(500).optional(),
    })
  ),
  auditLog('platform'),
  platformController.updateStatus
);
router.get('/activity', platformController.activity);

export default router;
