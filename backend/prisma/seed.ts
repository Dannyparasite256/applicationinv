import {
  PrismaClient,
  RoleCode,
  UserStatus,
  ProductType,
  AccountType,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const PERMISSIONS = [
  // Inventory
  { module: 'inventory', action: 'products.read', code: 'inventory.products.read', name: 'View products' },
  { module: 'inventory', action: 'products.create', code: 'inventory.products.create', name: 'Create products' },
  { module: 'inventory', action: 'products.update', code: 'inventory.products.update', name: 'Update products' },
  { module: 'inventory', action: 'products.delete', code: 'inventory.products.delete', name: 'Delete products' },
  { module: 'inventory', action: 'stock.adjust', code: 'inventory.stock.adjust', name: 'Adjust stock' },
  { module: 'inventory', action: 'stock.transfer', code: 'inventory.stock.transfer', name: 'Transfer stock' },
  // Sales / POS
  { module: 'sales', action: 'read', code: 'sales.read', name: 'View sales' },
  { module: 'sales', action: 'create', code: 'sales.create', name: 'Create sales' },
  { module: 'pos', action: 'access', code: 'pos.access', name: 'Access POS' },
  // Purchases
  { module: 'purchases', action: 'read', code: 'purchases.read', name: 'View purchases' },
  { module: 'purchases', action: 'create', code: 'purchases.create', name: 'Create purchases' },
  { module: 'purchases', action: 'update', code: 'purchases.update', name: 'Update purchases' },
  // CRM
  { module: 'crm', action: 'customers.read', code: 'crm.customers.read', name: 'View customers' },
  { module: 'crm', action: 'customers.create', code: 'crm.customers.create', name: 'Create customers' },
  // Accounting
  { module: 'accounting', action: 'read', code: 'accounting.read', name: 'View accounting' },
  { module: 'accounting', action: 'write', code: 'accounting.write', name: 'Manage accounting' },
  // Hospital
  { module: 'hospital', action: 'patients.read', code: 'hospital.patients.read', name: 'View patients' },
  { module: 'hospital', action: 'patients.create', code: 'hospital.patients.create', name: 'Register patients' },
  { module: 'hospital', action: 'appointments.create', code: 'hospital.appointments.create', name: 'Create appointments' },
  // Pharmacy
  { module: 'pharmacy', action: 'dispense', code: 'pharmacy.dispense', name: 'Dispense prescriptions' },
  // Laboratory
  { module: 'laboratory', action: 'read', code: 'laboratory.read', name: 'View lab orders' },
  { module: 'laboratory', action: 'create', code: 'laboratory.create', name: 'Create lab orders' },
  // HR
  { module: 'hr', action: 'employees.read', code: 'hr.employees.read', name: 'View employees' },
  // Settings / Reports
  { module: 'settings', action: 'company', code: 'settings.company', name: 'Manage company settings' },
  { module: 'reports', action: 'read', code: 'reports.read', name: 'View reports' },
  { module: 'users', action: 'manage', code: 'users.manage', name: 'Manage users' },
];

const ROLE_CODES: { code: RoleCode; name: string }[] = [
  { code: 'SUPER_ADMIN', name: 'Super Admin' },
  { code: 'COMPANY_OWNER', name: 'Company Owner' },
  { code: 'ADMINISTRATOR', name: 'Administrator' },
  { code: 'BRANCH_MANAGER', name: 'Branch Manager' },
  { code: 'CASHIER', name: 'Cashier' },
  { code: 'STORE_MANAGER', name: 'Store Manager' },
  { code: 'WAREHOUSE_MANAGER', name: 'Warehouse Manager' },
  { code: 'ACCOUNTANT', name: 'Accountant' },
  { code: 'SALES_PERSON', name: 'Sales Person' },
  { code: 'PROCUREMENT_OFFICER', name: 'Procurement Officer' },
  { code: 'PHARMACIST', name: 'Pharmacist' },
  { code: 'DOCTOR', name: 'Doctor' },
  { code: 'NURSE', name: 'Nurse' },
  { code: 'RECEPTIONIST', name: 'Receptionist' },
  { code: 'LABORATORY_TECHNICIAN', name: 'Laboratory Technician' },
  { code: 'CUSTOMER', name: 'Customer' },
  { code: 'SUPPLIER', name: 'Supplier' },
  { code: 'AUDITOR', name: 'Auditor' },
];

async function main() {
  console.log('🌱 Seeding Enterprise IMS...');

  // Permissions
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      create: p,
      update: { name: p.name },
    });
  }
  const allPerms = await prisma.permission.findMany();
  console.log(`  ✓ ${allPerms.length} permissions`);

  // System roles (no company)
  for (const r of ROLE_CODES) {
    const existing = await prisma.role.findFirst({
      where: { companyId: null, code: r.code },
    });
    if (!existing) {
      await prisma.role.create({
        data: { code: r.code, name: r.name, isSystem: true, companyId: null },
      });
    }
  }

  // Attach all permissions to SUPER_ADMIN and COMPANY_OWNER system roles
  const superRole = await prisma.role.findFirst({ where: { code: 'SUPER_ADMIN', companyId: null } });
  const ownerRole = await prisma.role.findFirst({ where: { code: 'COMPANY_OWNER', companyId: null } });
  for (const role of [superRole, ownerRole]) {
    if (!role) continue;
    for (const perm of allPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        create: { roleId: role.id, permissionId: perm.id },
        update: {},
      });
    }
  }

  // Worker / staff role permission matrices (minimal job features)
  const rolePermMap: Record<string, string[]> = {
    ADMINISTRATOR: allPerms.map((p) => p.code),
    BRANCH_MANAGER: [
      'pos.access', 'sales.read', 'sales.create', 'inventory.products.read', 'inventory.products.create',
      'inventory.products.update', 'inventory.stock.adjust', 'inventory.stock.transfer',
      'crm.customers.read', 'crm.customers.create', 'purchases.read', 'purchases.create', 'purchases.update',
      'reports.read', 'hr.employees.read', 'users.manage',
    ],
    CASHIER: ['pos.access', 'sales.read', 'inventory.products.read', 'crm.customers.read', 'crm.customers.create'],
    STORE_MANAGER: [
      'pos.access', 'sales.read', 'sales.create', 'inventory.products.read', 'inventory.products.create',
      'inventory.products.update', 'inventory.stock.adjust', 'crm.customers.read', 'crm.customers.create', 'reports.read',
    ],
    WAREHOUSE_MANAGER: [
      'inventory.products.read', 'inventory.products.update', 'inventory.stock.adjust', 'inventory.stock.transfer',
      'purchases.read', 'purchases.update',
    ],
    ACCOUNTANT: [
      'accounting.read', 'accounting.write', 'sales.read', 'purchases.read', 'reports.read', 'crm.customers.read',
    ],
    SALES_PERSON: [
      'pos.access', 'sales.read', 'sales.create', 'inventory.products.read', 'crm.customers.read', 'crm.customers.create',
    ],
    PROCUREMENT_OFFICER: [
      'purchases.read', 'purchases.create', 'purchases.update', 'inventory.products.read', 'crm.customers.read',
    ],
    PHARMACIST: [
      'pharmacy.dispense', 'inventory.products.read', 'inventory.stock.adjust', 'pos.access', 'sales.read',
      'crm.customers.read',
    ],
    DOCTOR: ['hospital.patients.read', 'hospital.patients.create', 'hospital.appointments.create', 'pharmacy.dispense'],
    NURSE: ['hospital.patients.read', 'hospital.patients.create', 'hospital.appointments.create'],
    RECEPTIONIST: [
      'hospital.patients.read', 'hospital.patients.create', 'hospital.appointments.create', 'crm.customers.read',
      'crm.customers.create',
    ],
    LABORATORY_TECHNICIAN: ['laboratory.read', 'laboratory.create', 'hospital.patients.read'],
    AUDITOR: ['reports.read', 'accounting.read', 'sales.read', 'purchases.read', 'inventory.products.read'],
  };

  for (const [code, permCodes] of Object.entries(rolePermMap)) {
    const role = await prisma.role.findFirst({ where: { code: code as RoleCode, companyId: null } });
    if (!role) continue;
    for (const pCode of permCodes) {
      const perm = allPerms.find((p) => p.code === pCode);
      if (!perm) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        create: { roleId: role.id, permissionId: perm.id },
        update: {},
      });
    }
  }
  console.log('  ✓ Worker role permission matrices');

  // Demo company
  const company = await prisma.company.upsert({
    where: { slug: 'demo' },
    create: {
      name: 'Demo Enterprise',
      slug: 'demo',
      email: 'admin@demo.local',
      phone: '+10000000000',
      currency: 'USD',
      country: 'US',
      status: 'ACTIVE',
      address: '100 Business Ave',
      city: 'Metro City',
    },
    update: {},
  });

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'HQ' } },
    create: {
      companyId: company.id,
      code: 'HQ',
      name: 'Head Office',
      isHeadOffice: true,
      city: 'Metro City',
    },
    update: {},
  });

  const warehouse = await prisma.warehouse.upsert({
    where: { companyId_code: { companyId: company.id, code: 'MAIN' } },
    create: {
      companyId: company.id,
      branchId: branch.id,
      code: 'MAIN',
      name: 'Main Warehouse',
      isDefault: true,
    },
    update: {},
  });

  // Tenant roles + all perms for owner/admin
  let companyOwnerRole = await prisma.role.findFirst({
    where: { companyId: company.id, code: 'COMPANY_OWNER' },
  });
  if (!companyOwnerRole) {
    companyOwnerRole = await prisma.role.create({
      data: {
        companyId: company.id,
        code: 'COMPANY_OWNER',
        name: 'Company Owner',
        isSystem: true,
      },
    });
  }
  for (const perm of allPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: companyOwnerRole.id, permissionId: perm.id } },
      create: { roleId: companyOwnerRole.id, permissionId: perm.id },
      update: {},
    });
  }

  // Passwords come from env — never hardcode production/superadmin secrets in the repo
  const seedPassword =
    process.env.SEED_PASSWORD ||
    process.env.DEMO_PASSWORD ||
    process.env.SEED_ADMIN_PASSWORD;
  if (!seedPassword || seedPassword.length < 8) {
    throw new Error(
      'Set SEED_PASSWORD (min 8 chars) in .env before seeding. See docs/CREDENTIALS.example.md'
    );
  }
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@demo.local').toLowerCase();
  const superAdminEmail = (
    process.env.SEED_SUPERADMIN_EMAIL || 'superadmin@ims.local'
  ).toLowerCase();

  const passwordHash = await bcrypt.hash(seedPassword, 12);

  const admin = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: adminEmail } },
    create: {
      companyId: company.id,
      branchId: branch.id,
      email: adminEmail,
      passwordHash,
      firstName: 'System',
      lastName: 'Admin',
      status: UserStatus.ACTIVE,
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
    update: { passwordHash, status: UserStatus.ACTIVE },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: companyOwnerRole.id } },
    create: { userId: admin.id, roleId: companyOwnerRole.id },
    update: {},
  });

  // Demo approved cashier (worker with minimal features)
  let cashierRoleTenant = await prisma.role.findFirst({
    where: { companyId: company.id, code: 'CASHIER' },
  });
  if (!cashierRoleTenant) {
    const sysCashier = await prisma.role.findFirst({ where: { companyId: null, code: 'CASHIER' } });
    cashierRoleTenant = await prisma.role.create({
      data: {
        companyId: company.id,
        code: 'CASHIER',
        name: 'Cashier',
        isSystem: true,
      },
    });
    if (sysCashier) {
      const cps = await prisma.rolePermission.findMany({ where: { roleId: sysCashier.id } });
      if (cps.length) {
        await prisma.rolePermission.createMany({
          data: cps.map((p) => ({ roleId: cashierRoleTenant!.id, permissionId: p.permissionId })),
          skipDuplicates: true,
        });
      }
    }
  }

  const cashier = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'cashier@demo.local' } },
    create: {
      companyId: company.id,
      branchId: branch.id,
      email: 'cashier@demo.local',
      passwordHash,
      firstName: 'Maya',
      lastName: 'Cashier',
      status: UserStatus.ACTIVE,
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
    update: { passwordHash, status: UserStatus.ACTIVE },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: cashier.id, roleId: cashierRoleTenant.id } },
    create: { userId: cashier.id, roleId: cashierRoleTenant.id },
    update: {},
  });

  // Demo pending staff awaiting approval
  const pendingStaff = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: 'pending@demo.local' } },
    create: {
      companyId: company.id,
      branchId: branch.id,
      email: 'pending@demo.local',
      passwordHash,
      firstName: 'Sam',
      lastName: 'Pending',
      status: UserStatus.PENDING_VERIFICATION,
      emailVerified: false,
    },
    update: { passwordHash, status: UserStatus.PENDING_VERIFICATION },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: pendingStaff.id, roleId: cashierRoleTenant.id } },
    create: { userId: pendingStaff.id, roleId: cashierRoleTenant.id },
    update: {},
  });
  console.log('  ✓ Demo cashier (active) + pending staff');

  // Super admin (platform) — email/password from env only
  const superAdminRole = await prisma.role.findFirst({ where: { code: 'SUPER_ADMIN', companyId: null } });
  const superAdmin = await prisma.user.upsert({
    where: { companyId_email: { companyId: company.id, email: superAdminEmail } },
    create: {
      companyId: company.id,
      email: superAdminEmail,
      passwordHash,
      firstName: 'Super',
      lastName: 'Admin',
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
    update: { passwordHash },
  });
  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: superAdmin.id, roleId: superAdminRole.id } },
      create: { userId: superAdmin.id, roleId: superAdminRole.id },
      update: {},
    });
  }

  // Units, tax, category, brand
  const unit = await prisma.unit.upsert({
    where: { companyId_shortName: { companyId: company.id, shortName: 'pc' } },
    create: { companyId: company.id, name: 'Piece', shortName: 'pc', isBase: true },
    update: {},
  });

  const tax = await prisma.tax.upsert({
    where: { companyId_code: { companyId: company.id, code: 'VAT' } },
    create: { companyId: company.id, name: 'VAT 10%', code: 'VAT', rate: 10 },
    update: {},
  });

  const category = await prisma.category.upsert({
    where: { companyId_slug: { companyId: company.id, slug: 'general' } },
    create: { companyId: company.id, name: 'General', slug: 'general' },
    update: {},
  });

  const pharmaCat = await prisma.category.upsert({
    where: { companyId_slug: { companyId: company.id, slug: 'pharmacy' } },
    create: { companyId: company.id, name: 'Pharmacy', slug: 'pharmacy' },
    update: {},
  });

  await prisma.brand.upsert({
    where: { companyId_slug: { companyId: company.id, slug: 'generic' } },
    create: { companyId: company.id, name: 'Generic', slug: 'generic' },
    update: {},
  });

  // Sample products
  const products = [
    { name: 'Wireless Mouse', sku: 'PRD-000001', barcode: '8901000000011', costPrice: 8, sellingPrice: 15, type: ProductType.PRODUCT },
    { name: 'USB-C Cable', sku: 'PRD-000002', barcode: '8901000000028', costPrice: 3, sellingPrice: 9.99, type: ProductType.PRODUCT },
    { name: 'Notebook A5', sku: 'PRD-000003', barcode: '8901000000035', costPrice: 1.2, sellingPrice: 3.5, type: ProductType.PRODUCT },
    { name: 'Paracetamol 500mg', sku: 'PRD-000004', barcode: '8901000000042', costPrice: 0.5, sellingPrice: 2.0, type: ProductType.DRUG, categoryId: pharmaCat.id },
    { name: 'Amoxicillin 250mg', sku: 'PRD-000005', barcode: '8901000000059', costPrice: 1.5, sellingPrice: 5.0, type: ProductType.DRUG, categoryId: pharmaCat.id },
    { name: 'Consultation Fee', sku: 'SRV-000001', barcode: null, costPrice: 0, sellingPrice: 50, type: ProductType.SERVICE },
  ];

  for (const p of products) {
    const existing = await prisma.product.findFirst({ where: { companyId: company.id, sku: p.sku } });
    if (existing) continue;
    const product = await prisma.product.create({
      data: {
        companyId: company.id,
        categoryId: p.categoryId || category.id,
        unitId: unit.id,
        taxId: tax.id,
        name: p.name,
        sku: p.sku,
        slug: p.sku.toLowerCase(),
        barcode: p.barcode,
        costPrice: p.costPrice,
        sellingPrice: p.sellingPrice,
        type: p.type,
        trackInventory: p.type !== ProductType.SERVICE,
        trackBatch: p.type === ProductType.DRUG,
        trackExpiry: p.type === ProductType.DRUG,
        requiresPrescription: p.sku === 'PRD-000005',
        isActive: true,
        reorderLevel: 10,
      },
    });
    if (p.type !== ProductType.SERVICE) {
      await prisma.stockLevel.create({
        data: {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 100,
        },
      });
      await prisma.stockMovement.create({
        data: {
          companyId: company.id,
          productId: product.id,
          warehouseId: warehouse.id,
          type: 'OPENING',
          quantity: 100,
          unitCost: p.costPrice,
          reference: 'Seed opening stock',
        },
      });
    }
  }

  // Chart of accounts
  const accounts: { code: string; name: string; type: AccountType }[] = [
    { code: '1000', name: 'Cash', type: 'ASSET' },
    { code: '1100', name: 'Bank', type: 'ASSET' },
    { code: '1200', name: 'Accounts Receivable', type: 'ASSET' },
    { code: '1300', name: 'Inventory', type: 'ASSET' },
    { code: '2000', name: 'Accounts Payable', type: 'LIABILITY' },
    { code: '2100', name: 'VAT Payable', type: 'LIABILITY' },
    { code: '3000', name: 'Owner Equity', type: 'EQUITY' },
    { code: '4000', name: 'Sales Revenue', type: 'REVENUE' },
    { code: '5000', name: 'Cost of Goods Sold', type: 'COGS' },
    { code: '6000', name: 'Operating Expenses', type: 'EXPENSE' },
  ];
  for (const a of accounts) {
    await prisma.account.upsert({
      where: { companyId_code: { companyId: company.id, code: a.code } },
      create: { companyId: company.id, ...a, isSystem: true },
      update: {},
    });
  }

  // Sample customer & supplier
  await prisma.customer.upsert({
    where: { companyId_code: { companyId: company.id, code: 'CUS-000001' } },
    create: {
      companyId: company.id,
      code: 'CUS-000001',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+15550001111',
      type: 'individual',
    },
    update: {},
  });

  await prisma.supplier.upsert({
    where: { companyId_code: { companyId: company.id, code: 'SUP-000001' } },
    create: {
      companyId: company.id,
      code: 'SUP-000001',
      name: 'Global Supplies Ltd',
      email: 'orders@globalsupplies.example',
      phone: '+15550002222',
    },
    update: {},
  });

  // Sample patient
  await prisma.patient.upsert({
    where: { companyId_patientNo: { companyId: company.id, patientNo: 'PAT-000001' } },
    create: {
      companyId: company.id,
      branchId: branch.id,
      patientNo: 'PAT-000001',
      firstName: 'John',
      lastName: 'Patient',
      gender: 'MALE',
      phone: '+15550003333',
      bloodGroup: 'O+',
      allergies: ['Penicillin'],
      type: 'OUTPATIENT',
    },
    update: {},
  });

  // Department
  await prisma.department.upsert({
    where: { companyId_code: { companyId: company.id, code: 'GEN' } },
    create: {
      companyId: company.id,
      code: 'GEN',
      name: 'General Medicine',
    },
    update: {},
  });

  // Employee
  await prisma.employee.upsert({
    where: { companyId_employeeNo: { companyId: company.id, employeeNo: 'EMP-000001' } },
    create: {
      companyId: company.id,
      branchId: branch.id,
      userId: admin.id,
      employeeNo: 'EMP-000001',
      firstName: 'System',
      lastName: 'Admin',
      email: 'admin@demo.local',
      position: 'General Manager',
      status: 'ACTIVE',
      hireDate: new Date(),
      salary: 5000,
    },
    update: {},
  });

  // Extra retail products
  const extraProducts = [
    { name: 'Keyboard Mechanical', sku: 'PRD-000006', barcode: '8901000000066', costPrice: 25, sellingPrice: 59.99 },
    { name: 'HDMI Cable 2m', sku: 'PRD-000007', barcode: '8901000000073', costPrice: 2.5, sellingPrice: 8.5 },
    { name: 'Office Chair', sku: 'PRD-000008', barcode: '8901000000080', costPrice: 80, sellingPrice: 149 },
    { name: 'Bottled Water 500ml', sku: 'PRD-000009', barcode: '8901000000097', costPrice: 0.2, sellingPrice: 1 },
    { name: 'Ballpoint Pen Pack', sku: 'PRD-000010', barcode: '8901000000103', costPrice: 1, sellingPrice: 3.5 },
  ];
  for (const p of extraProducts) {
    const existing = await prisma.product.findFirst({ where: { companyId: company.id, sku: p.sku } });
    if (existing) continue;
    const product = await prisma.product.create({
      data: {
        companyId: company.id,
        categoryId: category.id,
        unitId: unit.id,
        taxId: tax.id,
        name: p.name,
        sku: p.sku,
        slug: p.sku.toLowerCase(),
        barcode: p.barcode,
        costPrice: p.costPrice,
        sellingPrice: p.sellingPrice,
        type: ProductType.PRODUCT,
        trackInventory: true,
        isActive: true,
        reorderLevel: 15,
      },
    });
    await prisma.stockLevel.create({
      data: { productId: product.id, warehouseId: warehouse.id, quantity: 50 },
    });
  }

  // Demo sales history for dashboard charts
  const saleCount = await prisma.sale.count({ where: { companyId: company.id } });
  if (saleCount === 0) {
    const stocked = await prisma.product.findMany({
      where: { companyId: company.id, deletedAt: null, trackInventory: true },
      take: 5,
    });
    const customer = await prisma.customer.findFirst({ where: { companyId: company.id } });
    for (let d = 13; d >= 0; d--) {
      const day = new Date();
      day.setDate(day.getDate() - d);
      day.setHours(10 + (d % 6), 15, 0, 0);
      const product = stocked[d % stocked.length];
      if (!product) continue;
      const qty = 1 + (d % 3);
      const unitPrice = Number(product.sellingPrice);
      const lineSub = unitPrice * qty;
      const taxAmt = lineSub * 0.1;
      const total = lineSub + taxAmt;
      const saleNo = `POS-${day.getFullYear()}-${String(1000 + (13 - d)).padStart(6, '0')}`;
      await prisma.sale.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          warehouseId: warehouse.id,
          saleNo,
          customerId: d % 2 === 0 ? customer?.id : null,
          cashierId: admin.id,
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          subtotal: lineSub,
          taxAmount: taxAmt,
          discountAmount: 0,
          total,
          paidAmount: total,
          paymentMethod: d % 3 === 0 ? 'CARD' : 'CASH',
          saleDate: day,
          items: {
            create: [
              {
                productId: product.id,
                productName: product.name,
                sku: product.sku,
                quantity: qty,
                unitPrice,
                discount: 0,
                taxAmount: taxAmt,
                total,
              },
            ],
          },
          payments: {
            create: [{ amount: total, method: d % 3 === 0 ? 'CARD' : 'CASH' }],
          },
        },
      });
    }
    console.log('  ✓ Sample sales history (14 days)');
  }

  // Sample invoice
  const invCount = await prisma.invoice.count({ where: { companyId: company.id } });
  if (invCount === 0) {
    const customer = await prisma.customer.findFirst({ where: { companyId: company.id } });
    await prisma.invoice.create({
      data: {
        companyId: company.id,
        invoiceNo: `INV-${new Date().getFullYear()}-000001`,
        customerId: customer?.id,
        status: 'SENT',
        paymentStatus: 'UNPAID',
        subtotal: 100,
        taxAmount: 10,
        total: 110,
        issuedAt: new Date(),
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        items: {
          create: [
            {
              description: 'Professional services',
              quantity: 1,
              unitPrice: 100,
              taxAmount: 10,
              total: 110,
            },
          ],
        },
      },
    });
    console.log('  ✓ Sample invoice');
  }

  // In-app welcome notification
  await prisma.notification.create({
    data: {
      companyId: company.id,
      userId: admin.id,
      channel: 'IN_APP',
      title: 'Welcome to Enterprise IMS',
      body: 'Your demo workspace is ready. Try POS, inventory, invoices, and reports.',
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  console.log('');
  console.log('✅ Seed complete');
  console.log('─────────────────────────────────────');
  console.log(`  Demo login email:  ${adminEmail}`);
  console.log(`  Super admin email: ${superAdminEmail}`);
  console.log('  Password:          (from SEED_PASSWORD in .env — not printed)');
  console.log('  Company:           Demo Enterprise (slug: demo)');
  console.log('  Store passwords only in .env / docs/CREDENTIALS.local.md (gitignored)');
  console.log('─────────────────────────────────────');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
