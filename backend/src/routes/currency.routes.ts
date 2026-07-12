import { Router } from 'express';
import { authenticate, requireTenant, requirePermissions } from '../middleware/auth';
import * as currency from '../controllers/currency.controller';

const router = Router();

router.use(authenticate, requireTenant);

router.get('/', currency.list);
router.get('/live', currency.live);
router.get('/convert', currency.convert);
router.post('/convert', currency.convert);
// Any logged-in company user can refresh live FX (read-only market data)
router.post('/refresh', currency.refresh);
router.put('/base', requirePermissions('settings.company'), currency.setBase);
router.post('/', requirePermissions('settings.company'), currency.upsert);

export default router;
