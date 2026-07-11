/**
 * Role / permission based access for worker UI.
 * Managers see full menus; staff see only job-related modules.
 */

export type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  superAdminOnly?: boolean;
  /** Permission codes — any match grants access */
  permissions?: string[];
  /** Role codes that always see this item (even without explicit permission list match) */
  roles?: string[];
  /** If true, only full managers see it */
  managerOnly?: boolean;
};

const MANAGER_ROLES = new Set([
  'SUPER_ADMIN',
  'COMPANY_OWNER',
  'ADMINISTRATOR',
  'BRANCH_MANAGER',
]);

/** Default home route per role after login */
export function getDefaultHome(roles: string[] = []): string {
  if (roles.includes('SUPER_ADMIN')) return '/app/platform';
  if (roles.some((r) => MANAGER_ROLES.has(r))) return '/app';
  if (roles.includes('CASHIER') || roles.includes('SALES_PERSON')) return '/app/pos';
  if (roles.includes('WAREHOUSE_MANAGER')) return '/app/inventory';
  if (roles.includes('ACCOUNTANT')) return '/app/accounting';
  if (roles.includes('PHARMACIST')) return '/app/pharmacy';
  if (roles.includes('DOCTOR') || roles.includes('NURSE') || roles.includes('RECEPTIONIST')) {
    return '/app/hospital';
  }
  if (roles.includes('LABORATORY_TECHNICIAN')) return '/app/laboratory';
  if (roles.includes('PROCUREMENT_OFFICER')) return '/app/purchases';
  return '/app';
}

export function isManager(roles: string[] = []): boolean {
  return roles.some((r) => MANAGER_ROLES.has(r));
}

/**
 * Who may refund or delete sales.
 * Cashiers / sales staff can record sales only — reversals need a manager.
 */
const SALES_ADMIN_ROLES = new Set([
  'SUPER_ADMIN',
  'COMPANY_OWNER',
  'ADMINISTRATOR',
  'BRANCH_MANAGER',
  'STORE_MANAGER',
]);

export function canRefundOrDeleteSales(
  roles: string[] = [],
  permissions: string[] = []
): boolean {
  if (roles.some((r) => SALES_ADMIN_ROLES.has(r))) return true;
  return (
    permissions.includes('sales.refund') ||
    permissions.includes('sales.delete') ||
    permissions.includes('sales.void') ||
    permissions.includes('*')
  );
}

export function canAccessNav(
  item: NavItem,
  roles: string[] = [],
  permissions: string[] = []
): boolean {
  if (item.superAdminOnly) {
    return roles.includes('SUPER_ADMIN');
  }

  // Full managers see everything (except platform unless super admin)
  if (isManager(roles) && !item.superAdminOnly) {
    if (item.managerOnly === false) return true;
    return true;
  }

  if (item.managerOnly) return false;

  if (item.roles?.some((r) => roles.includes(r))) return true;

  // Empty permissions array = open to any authenticated user
  if (item.permissions && item.permissions.length === 0) {
    return true;
  }

  if (item.permissions?.length) {
    return item.permissions.some(
      (p) => permissions.includes(p) || permissions.includes('*')
    );
  }

  // No restriction defined — hide from pure workers
  return false;
}

/** Filter sidebar items for current user */
export function filterNavForUser<T extends NavItem>(
  items: T[],
  roles: string[] = [],
  permissions: string[] = []
): T[] {
  return items.filter((item) => canAccessNav(item, roles, permissions));
}

/** Route path access check */
export function canAccessPath(
  path: string,
  roles: string[] = [],
  permissions: string[] = []
): boolean {
  if (isManager(roles)) {
    if (path.startsWith('/app/platform')) return roles.includes('SUPER_ADMIN');
    return true;
  }

  const map: Array<{ prefix: string; permissions?: string[]; roles?: string[] }> = [
    { prefix: '/app/platform', roles: ['SUPER_ADMIN'] },
    { prefix: '/app/pos', permissions: ['pos.access'] },
    { prefix: '/app/products', permissions: ['inventory.products.read'] },
    { prefix: '/app/inventory', permissions: ['inventory.products.read', 'inventory.stock.adjust'] },
    { prefix: '/app/sales', permissions: ['sales.read'] },
    { prefix: '/app/purchases', permissions: ['purchases.read'] },
    { prefix: '/app/customers', permissions: ['crm.customers.read'] },
    { prefix: '/app/suppliers', permissions: ['purchases.read'] },
    { prefix: '/app/invoices', permissions: ['sales.read', 'accounting.read'] },
    { prefix: '/app/accounting', permissions: ['accounting.read'] },
    { prefix: '/app/hospital', permissions: ['hospital.patients.read'] },
    { prefix: '/app/pharmacy', permissions: ['pharmacy.dispense', 'inventory.products.read'] },
    { prefix: '/app/laboratory', permissions: ['laboratory.read'] },
    { prefix: '/app/hr', permissions: ['hr.employees.read'], roles: ['ADMINISTRATOR', 'COMPANY_OWNER'] },
    { prefix: '/app/reports', permissions: ['reports.read'] },
    { prefix: '/app/staff', permissions: ['users.manage'] },
    { prefix: '/app/settings', permissions: ['settings.company', 'users.manage'] },
    { prefix: '/app', permissions: [] }, // dashboard — allow if logged in (workers get simple home)
  ];

  // Exact dashboard
  if (path === '/app' || path === '/app/') return true;

  for (const rule of map) {
    if (path === rule.prefix || path.startsWith(rule.prefix + '/')) {
      if (rule.roles?.some((r) => roles.includes(r))) return true;
      if (!rule.permissions?.length) return true;
      if (permissions.includes('*')) return true;
      return rule.permissions.some((p) => permissions.includes(p) || permissions.includes('*'));
    }
  }
  return false;
}
