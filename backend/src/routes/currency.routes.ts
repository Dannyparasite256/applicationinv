import { Router } from 'express';
import { authenticate, requireTenant, requirePermissions } from '../middleware/auth';
import * as currency from '../controllers/currency.controller';

const router = Router();

router.use(authenticate, requireTenant);

router.get('/', currency.list);
router.get('/live', currency.live);
router.get('/convert', currency.convert);
router.post('/convert', currency.convert);
router.post('/refresh', requirePermissions('settings.company'), currency.refresh);
router.put('/base', requirePermissions('settings.company'), currency.setBase);
router.post('/', requirePermissions('settings.company'), currency.upsert);

export default router;
