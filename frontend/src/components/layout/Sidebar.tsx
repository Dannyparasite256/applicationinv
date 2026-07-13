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
import { filterNavForUser, type NavItem } from '@/lib/roleAccess';
import { BrandMark } from '@/components/shared/BrandMark';
import { tLabel } from '@/lib/i18nSimple';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type NavDef = NavItem & {
  icon: typeof LayoutDashboard;
  superAdminOnly?: boolean;
  end?: boolean;
};

const nav: NavDef[] = [
  {
    to: '/app',
    label: 'Dashboard',
    icon: LayoutDashboard,
    end: true,
    permissions: [],
    roles: [
      'SUPER_ADMIN',
      'COMPANY_OWNER',
      'ADMINISTRATOR',
      'BRANCH_MANAGER',
      'STORE_MANAGER',
      'ACCOUNTANT',
      'AUDITOR',
    ],
  },
  { to: '/app/platform', label: 'All Businesses', icon: Shield, superAdminOnly: true },
  {
    to: '/app/staff',
    label: 'Staff',
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
  {
    to: '/app/suppliers',
    label: 'Suppliers',
    icon: Truck,
    permissions: ['purchases.read', 'purchases.create'],
  },
  {
    to: '/app/invoices',
    label: 'Invoices',
    icon: FileText,
    permissions: ['sales.read', 'accounting.read'],
  },
  { to: '/app/accounting', label: 'Accounting', icon: Calculator, permissions: ['accounting.read'] },
  {
    to: '/app/hospital',
    label: 'Hospital',
    icon: HeartPulse,
    permissions: ['hospital.patients.read'],
  },
  {
    to: '/app/pharmacy',
    label: 'Pharmacy',
    icon: Pill,
    permissions: ['pharmacy.dispense', 'inventory.products.read'],
    roles: ['PHARMACIST'],
  },
  {
    to: '/app/laboratory',
    label: 'Laboratory',
    icon: FlaskConical,
    permissions: ['laboratory.read'],
  },
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

const GROUPS: { id: string; label: string; paths: string[] }[] = [
  { id: 'home', label: 'Overview', paths: ['/app', '/app/platform', '/app/staff'] },
  {
    id: 'sell',
    label: 'Sell',
    paths: ['/app/pos', '/app/sales', '/app/customers', '/app/invoices'],
  },
  {
    id: 'stock',
    label: 'Stock',
    paths: ['/app/products', '/app/inventory', '/app/purchases', '/app/suppliers'],
  },
  { id: 'money', label: 'Money', paths: ['/app/accounting', '/app/reports'] },
  {
    id: 'industry',
    label: 'Industry',
    paths: ['/app/hospital', '/app/pharmacy', '/app/laboratory'],
  },
  { id: 'team', label: 'Business', paths: ['/app/hr', '/app/settings'] },
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

  if (isSuperAdmin) {
    const platform = nav.find((n) => n.to === '/app/platform');
    items = items.filter((i) => i.to !== '/app/platform');
    if (platform) {
      const homeIdx = items.findIndex((i) => i.to === '/app');
      items.splice(homeIdx >= 0 ? homeIdx + 1 : 0, 0, platform);
    }
  }

  if (!items.some((i) => i.to === '/app')) {
    const home = nav.find((n) => n.to === '/app');
    if (home) items.unshift(home);
  }

  if (!items.some((i) => i.to === '/app/pos') && permissions.includes('pos.access')) {
    const pos = nav.find((n) => n.to === '/app/pos');
    if (pos) items.splice(1, 0, pos);
  }

  const { data: pendingCount } = useQuery({
    queryKey: ['staff-pending-count'],
    enabled:
      permissions.includes('users.manage') || isSuperAdmin || roles.includes('COMPANY_OWNER'),
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

  const { data: company } = useQuery({
    queryKey: ['company'],
    queryFn: async () =>
      (await api.get('/company')).data.data as { name?: string; logoUrl?: string | null },
    staleTime: 30_000,
    enabled: Boolean(user?.companyId || user?.company?.id),
  });

  const companyName = company?.name || user?.company?.name || 'Enterprise IMS';
  const companyLogoUrl = company?.logoUrl ?? user?.company?.logoUrl;

  const grouped = GROUPS.map((g) => ({
    ...g,
    items: items.filter((i) => g.paths.includes(i.to)),
  })).filter((g) => g.items.length > 0);

  // Any items not in a group
  const known = new Set(GROUPS.flatMap((g) => g.paths));
  const orphan = items.filter((i) => !known.has(i.to));
  if (orphan.length) {
    grouped.push({ id: 'other', label: 'More', paths: [], items: orphan });
  }

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border/60 bg-card/90 backdrop-blur-2xl transition-all duration-300 z-40 min-h-0',
        mobile
          ? 'fixed inset-y-0 left-0 w-[min(16.5rem,88vw)] max-w-full shadow-elevated pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)]'
          : open
            ? 'w-[15rem]'
            : 'w-[4.25rem]',
        mobile && !open && '-translate-x-full'
      )}
    >
      <div className="app-topbar border-b border-border/60 shrink-0">
        <div className="app-topbar-inner gap-2.5 px-3">
          <BrandMark
            logoUrl={companyLogoUrl}
            name={companyName}
            className="h-9 w-9 text-xs ring-2 ring-primary/10 shrink-0"
          />
          {(open || mobile) && (
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold text-sm font-display tracking-tight">{companyName}</p>
              <p className="truncate text-[10px] text-muted-foreground font-medium">Workspace</p>
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
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 space-y-3 overscroll-contain">
        {grouped.map((group) => (
          <div key={group.id} className="space-y-0.5">
            {(open || mobile) && (
              <p className="section-label px-2.5 pt-1 pb-1">{group.label}</p>
            )}
            {group.items.map((item) => (
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
                        : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                  )
                }
              >
                <item.icon className="shrink-0 h-[17px] w-[17px]" />
                {(open || mobile) && (
                  <span className="truncate flex-1">{tLabel(item.label)}</span>
                )}
                {(open || mobile) &&
                  item.to === '/app/staff' &&
                  (pendingCount || 0) > 0 && (
                    <span className="ml-auto rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 min-w-[1.25rem] text-center">
                      {pendingCount}
                    </span>
                  )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {(open || mobile) && (
        <div className="p-3 border-t border-border/60 shrink-0">
          <p className="text-[10px] text-muted-foreground text-center">Enterprise IMS</p>
        </div>
      )}
    </aside>
  );
}
