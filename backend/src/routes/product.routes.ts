import { Router } from 'express';
import * as productController from '../controllers/product.controller';
import { authenticate, requireTenant, requirePermissions } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createProductSchema,
  updateProductSchema,
  createCategorySchema,
  createBrandSchema,
} from '../validators/product.validator';
import { auditLog } from '../middleware/audit';

const router = Router();

router.use(authenticate, requireTenant);

router.get('/', requirePermissions('inventory.products.read'), productController.list);
router.get('/low-stock', requirePermissions('inventory.products.read'), productController.lowStock);
router.get('/expiring', requirePermissions('inventory.products.read'), productController.expiring);
router.get('/categories', requirePermissions('inventory.products.read'), productController.categories);
router.post(
  '/categories',
  requirePermissions('inventory.products.create'),
  validate(createCategorySchema),
  auditLog('categories'),
  productController.createCategory
);
router.get('/brands', requirePermissions('inventory.products.read'), productController.brands);
router.post(
  '/brands',
  requirePermissions('inventory.products.create'),
  validate(createBrandSchema),
  auditLog('brands'),
  productController.createBrand
);
router.get('/barcode/:barcode', requirePermissions('inventory.products.read'), productController.getByBarcode);
router.get('/:id', requirePermissions('inventory.products.read'), productController.getById);
router.post(
  '/',
  requirePermissions('inventory.products.create'),
  validate(createProductSchema),
  auditLog('products'),
  productController.create
);
router.put(
  '/:id',
  requirePermissions('inventory.products.update'),
  validate(updateProductSchema),
  auditLog('products'),
  productController.update
);
router.delete(
  '/:id',
  requirePermissions('inventory.products.delete'),
  auditLog('products'),
  productController.remove
);

export default router;
