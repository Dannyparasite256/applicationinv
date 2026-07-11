import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Store,
  Users,
  Truck,
  FileText,
  HeartPulse,
  Pill,
  FlaskConical,
  Calculator,
  UserCog,
  BarChart3,
  Settings,
  ChevronLeft,
  Boxes,
  Shield,
  UserCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { filterNavForUser } from '@/lib/roleAccess';
import { getMediaUrl, brandInitials } from '@/lib/media';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

const nav = [
  {
    to: '/app',
    label: 'Dashboard',
    icon: LayoutDashboard,
    end: true,
    permissions: [], // all authenticated
    roles: ['SUPER_ADMIN', 'COMPANY_OWNER', 'ADMINISTRATOR', 'BRANCH_MANAGER', 'STORE_MANAGER', 'ACCOUNTANT', 'AUDITOR'],
  },
  { to: '/app/platform', label: 'All Businesses', icon: Shield, superAdminOnly: true },
  {
    to: '/app/staff',
    label: 'Staff & Approvals',
    icon: UserCheck,
    permissions: ['users.manage'],
    roles: ['COMPANY_OWNER', 'ADMINISTRATOR', 'BRANCH_MANAGER'],
  },
  { to: '/app/pos', label: 'POS', icon: Store, permissions: ['pos.access'] },
  { to: '/app/products', label: 'Products', icon: Package, permissions: ['inventory.products.read'] },
  {
    to: '/app/inventory',
    label: 'Inventory',
    icon: Boxes,
    permissions: ['inventory.products.read', 'inventory.stock.adjust'],
  },
  { to: '/app/sales', label: 'Sales', icon: ShoppingCart, permissions: ['sales.read'] },
  { to: '/app/purchases', label: 'Purchases', icon: Truck, permissions: ['purchases.read'] },
  { to: '/app/customers', label: 'Customers', icon: Users, permissions: ['crm.customers.read'] },
  { to: '/app/suppliers', label: 'Suppliers', icon: Truck, permissions: ['purchases.read', 'purchases.create'] },
  {
    to: '/app/invoices',
    label: 'Invoices',
    icon: FileText,
    permissions: ['sales.read', 'accounting.read'],
  },
  { to: '/app/accounting', label: 'Accounting', icon: Calculator, permissions: ['accounting.read'] },
  { to: '/app/hospital', label: 'Hospital', icon: HeartPulse, permissions: ['hospital.patients.read'] },
  {
    to: '/app/pharmacy',
    label: 'Pharmacy',
    icon: Pill,
    permissions: ['pharmacy.dispense', 'inventory.products.read'],
    roles: ['PHARMACIST'],
  },
  { to: '/app/laboratory', label: 'Laboratory', icon: FlaskConical, permissions: ['laboratory.read'] },
  {
    to: '/app/hr',
    label: 'HR',
    icon: UserCog,
    permissions: ['hr.employees.read'],
    roles: ['COMPANY_OWNER', 'ADMINISTRATOR'],
  },
  { to: '/app/reports', label: 'Reports', icon: BarChart3, permissions: ['reports.read'] },
  {
    to: '/app/settings',
    label: 'Settings',
    icon: Settings,
    permissions: ['settings.company', 'users.manage'],
    roles: ['COMPANY_OWNER', 'ADMINISTRATOR'],
  },
];

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  mobile?: boolean;
  onNavigate?: () => void;
}

export function Sidebar({ open, onToggle, mobile, onNavigate }: SidebarProps) {
  const user = useAuthStore((s) => s.user);
  const roles = user?.roles || [];
  const permissions = user?.permissions || [];
  const isSuperAdmin = roles.includes('SUPER_ADMIN');

  let items = filterNavForUser(nav, roles, permissions).filter((item) => {
    if (item.superAdminOnly) return isSuperAdmin;
    return true;
  });

  // Super admin: always pin "All Businesses" near the top so registered tenants are easy to open
  if (isSuperAdmin) {
    const platform = nav.find((n) => n.to === '/app/platform');
    items = items.filter((i) => i.to !== '/app/platform');
    if (platform) {
      const homeIdx = items.findIndex((i) => i.to === '/app');
      items.splice(homeIdx >= 0 ? homeIdx + 1 : 0, 0, platform);
    }
  }

  // Always ensure home exists
  if (!items.some((i) => i.to === '/app')) {
    const home = nav.find((n) => n.to === '/app');
    if (home) items.unshift(home);
  }

  // Ensure cashiers still see POS if permission present
  if (!items.some((i) => i.to === '/app/pos') && permissions.includes('pos.access')) {
    const pos = nav.find((n) => n.to === '/app/pos');
    if (pos) items.splice(1, 0, pos);
  }

  const { data: pendingCount } = useQuery({
    queryKey: ['staff-pending-count'],
    enabled: permissions.includes('users.manage') || isSuperAdmin || roles.includes('COMPANY_OWNER'),
    queryFn: async () => {
      try {
        const res = await api.get('/users/pending/count');
        return res.data.data.count as number;
      } catch {
        return 0;
      }
    },
    refetchInterval: 60_000,
  });

  const companyName = user?.company?.name || 'Enterprise IMS';
  const logoSrc = getMediaUrl(user?.company?.logoUrl);

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border/80 bg-card/95 backdrop-blur-2xl transition-all duration-300 z-40 min-h-0',
        mobile
          ? 'fixed inset-y-0 left-0 w-[min(16.5rem,86vw)] max-w-full shadow-elevated pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]'
          : open
            ? 'w-[14.5rem]'
            : 'w-[4rem]',
        mobile && !open && '-translate-x-full'
      )}
    >
      <div className="app-topbar flex items-center gap-2.5 border-b border-border/80 px-3 shrink-0">
        <div className="brand-mark h-9 w-9 text-xs ring-2 ring-primary/10 shrink-0">
          {logoSrc ? (
            <img src={logoSrc} alt={companyName} className="h-full w-full object-cover" />
          ) : (
            brandInitials(companyName)
          )}
        </div>
        {(open || mobile) && (
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-sm font-display tracking-tight">{companyName}</p>
            <p className="truncate text-[10px] text-muted-foreground font-medium">
              Business workspace
            </p>
          </div>
        )}
        {!mobile && (
          <button
            onClick={onToggle}
            className="ml-auto rounded-xl p-1.5 hover:bg-muted text-muted-foreground transition-colors shrink-0"
            aria-label="Toggle sidebar"
          >
            <ChevronLeft className={cn('h-4 w-4 transition-transform', !open && 'rotate-180')} />
          </button>
        )}
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 space-y-0.5 overscroll-contain">
        {(open || mobile) && (
          <p className="section-label px-2.5 pt-1 pb-1.5">Menu</p>
        )}
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-all duration-200 min-w-0',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-glow'
                  : item.superAdminOnly
                    ? 'text-primary hover:bg-primary/10'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            <item.icon className="shrink-0 h-[17px] w-[17px]" />
            {(open || mobile) && (
              <span className="flex-1 flex items-center justify-between gap-2 min-w-0">
                <span className="truncate">{item.label}</span>
                {item.to === '/app/staff' && (pendingCount || 0) > 0 && (
                  <span className="rounded-full bg-warning text-warning-foreground text-[10px] px-1.5 py-0.5 font-bold shrink-0">
                    {pendingCount}
                  </span>
                )}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {(open || mobile) && (
        <div className="border-t border-border p-3 space-y-0.5 shrink-0">
          <p className="text-[11px] text-muted-foreground truncate">
            Role: {roles[0]?.replace(/_/g, ' ') || 'User'}
          </p>
          <p className="text-[10px] text-muted-foreground">Enterprise IMS</p>
        </div>
      )}
    </aside>
  );
}
