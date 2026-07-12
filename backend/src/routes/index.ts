import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './product.routes';
import saleRoutes from './sale.routes';
import opsRoutes from './ops.routes';
import platformRoutes from './platform.routes';
import currencyRoutes from './currency.routes';
import * as dashboardController from '../controllers/dashboard.controller';
import * as customerController from '../controllers/customer.controller';
import * as purchaseController from '../controllers/purchase.controller';
import * as hospitalController from '../controllers/hospital.controller';
import * as companyController from '../controllers/company.controller';
import { authenticate, requireTenant, requirePermissions, requireAnyPermission } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createCustomerSchema, createSupplierSchema, createPatientSchema } from '../validators/customer.validator';
import { createPurchaseSchema, receivePurchaseSchema } from '../validators/purchase.validator';
import { auditLog } from '../middleware/audit';
import { logoUpload } from '../middleware/upload';

const router = Router();

// Public health check (must stay before authenticated catch-all mounts)
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    message: 'Enterprise IMS API is healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

router.use('/auth', authRoutes);
router.use('/platform', platformRoutes);
router.use('/products', productRoutes);
router.use('/sales', saleRoutes);
router.use('/currencies', currencyRoutes);
router.use('/', opsRoutes);

// Dashboard
router.get('/dashboard', authenticate, requireTenant, dashboardController.stats);

// Customers & Suppliers
router.get('/customers', authenticate, requireTenant, requirePermissions('crm.customers.read'), customerController.listCustomers);
router.post('/customers', authenticate, requireTenant, requirePermissions('crm.customers.create'), validate(createCustomerSchema), auditLog('customers'), customerController.createCustomer);
router.get('/customers/:id', authenticate, requireTenant, requirePermissions('crm.customers.read'), customerController.getCustomer);
router.put('/customers/:id', authenticate, requireTenant, requirePermissions('crm.customers.create'), auditLog('customers'), customerController.updateCustomer);
router.get('/suppliers', authenticate, requireTenant, requirePermissions('purchases.read'), customerController.listSuppliers);
router.post('/suppliers', authenticate, requireTenant, requirePermissions('purchases.create'), validate(createSupplierSchema), auditLog('suppliers'), customerController.createSupplier);

// Purchases
router.get('/purchases', authenticate, requireTenant, requirePermissions('purchases.read'), purchaseController.list);
router.get('/purchases/:id', authenticate, requireTenant, requirePermissions('purchases.read'), purchaseController.getById);
router.post('/purchases', authenticate, requireTenant, requirePermissions('purchases.create'), validate(createPurchaseSchema), auditLog('purchases'), purchaseController.create);
router.post('/purchases/:id/receive', authenticate, requireTenant, requirePermissions('purchases.update'), validate(receivePurchaseSchema), auditLog('purchases'), purchaseController.receive);

// Hospital
router.get('/patients', authenticate, requireTenant, requirePermissions('hospital.patients.read'), hospitalController.listPatients);
router.post('/patients', authenticate, requireTenant, requirePermissions('hospital.patients.create'), validate(createPatientSchema), auditLog('patients'), hospitalController.createPatient);
router.get('/patients/:id', authenticate, requireTenant, requirePermissions('hospital.patients.read'), hospitalController.getPatient);
router.post('/appointments', authenticate, requireTenant, requirePermissions('hospital.appointments.create'), hospitalController.createAppointment);
router.post('/prescriptions', authenticate, requireTenant, requirePermissions('pharmacy.dispense'), hospitalController.createPrescription);
router.get('/lab-orders', authenticate, requireTenant, requirePermissions('laboratory.read'), hospitalController.listLabOrders);
router.post('/lab-orders', authenticate, requireTenant, requirePermissions('laboratory.create'), hospitalController.createLabOrder);

// Company / settings
router.get('/company', authenticate, requireTenant, companyController.getCompany);
router.put('/company', authenticate, requireTenant, requirePermissions('settings.company'), auditLog('company'), companyController.updateCompany);
router.post(
  '/company/logo',
  authenticate,
  requireTenant,
  requirePermissions('settings.company'),
  (req, res, next) => {
    logoUpload.single('logo')(req, res, (err: unknown) => {
      if (err) {
        next(err);
        return;
      }
      next();
    });
  },
  auditLog('company'),
  companyController.uploadLogo
);
router.get('/branches', authenticate, requireTenant, companyController.listBranches);
router.get('/warehouses', authenticate, requireTenant, companyController.listWarehouses);
router.get('/accounts', authenticate, requireTenant, requirePermissions('accounting.read'), companyController.listAccounts);
router.get('/employees', authenticate, requireTenant, requirePermissions('hr.employees.read'), companyController.listEmployees);
router.get(
  '/activity',
  authenticate,
  requireTenant,
  requireAnyPermission('reports.read', 'settings.company', 'dashboard.read', 'sales.read'),
  companyController.listActivity
);
router.get('/notifications', authenticate, companyController.listNotifications);
router.patch('/notifications/:id/read', authenticate, companyController.markNotificationRead);
router.post('/notifications/device', authenticate, companyController.registerDevice);

// Email status + test send
router.get('/email/status', authenticate, companyController.emailStatus);
router.post(
  '/email/test',
  authenticate,
  requireTenant,
  requirePermissions('settings.company'),
  async (req, res, next) => {
    req.query.to = req.body?.to || req.query.to;
    return companyController.emailStatus(req, res, next);
  }
);

export default router;
