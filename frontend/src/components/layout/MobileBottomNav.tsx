import { NavLink, useLocation } from 'react-router-dom';
import { Store, ShoppingCart, Users, LayoutGrid, LayoutDashboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { canAccessPath, isManager } from '@/lib/roleAccess';

/**
 * Cashier-first mobile bottom navigation.
 * Visible below lg; primary destinations only.
 */
export function MobileBottomNav() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const roles = user?.roles || [];
  const permissions = user?.permissions || [];
  const manager = isManager(roles);

  type Tab = {
    to: string;
    label: string;
    icon: typeof Store;
    match?: (path: string) => boolean;
    show: boolean;
  };

  const tabs: Tab[] = (
    [
      {
        to: '/app',
        label: 'Home',
        icon: LayoutDashboard,
        match: (p: string) => p === '/app' || p === '/app/',
        show: manager || roles.includes('ACCOUNTANT') || roles.includes('AUDITOR'),
      },
      {
        to: '/app/pos',
        label: 'POS',
        icon: Store,
        match: (p: string) => p.startsWith('/app/pos'),
        show: canAccessPath('/app/pos', roles, permissions),
      },
      {
        to: '/app/sales',
        label: 'Sales',
        icon: ShoppingCart,
        match: (p: string) => p.startsWith('/app/sales'),
        show: canAccessPath('/app/sales', roles, permissions),
      },
      {
        to: '/app/customers',
        label: 'Customers',
        icon: Users,
        match: (p: string) => p.startsWith('/app/customers'),
        show: canAccessPath('/app/customers', roles, permissions),
      },
      {
        to: manager ? '/app/reports' : '/app/products',
        label: 'More',
        icon: LayoutGrid,
        match: (p: string) =>
          !p.startsWith('/app/pos') &&
          !p.startsWith('/app/sales') &&
          !p.startsWith('/app/customers') &&
          p !== '/app' &&
          p !== '/app/',
        show: true,
      },
    ] as Tab[]
  ).filter((t) => t.show);

  // Cashiers without dashboard: lead with POS
  if (!tabs.some((t) => t.to === '/app') && tabs.some((t) => t.to === '/app/pos')) {
    // already fine
  }

  if (tabs.length < 2) return null;

  return (
    <nav
      className="mobile-bottom-nav lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border/80 bg-card/95 backdrop-blur-xl shadow-[0_-8px_30px_-12px_rgba(15,23,42,0.18)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Main"
    >
      <div className="flex items-stretch justify-around h-14 max-w-lg mx-auto px-1">
        {tabs.map((tab) => {
          const active = tab.match
            ? tab.match(location.pathname)
            : location.pathname.startsWith(tab.to);
          return (
            <NavLink
              key={tab.to + tab.label}
              to={tab.to}
              end={tab.to === '/app'}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 rounded-xl mx-0.5 my-1 transition-all duration-200',
                active
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground active:bg-muted/80'
              )}
            >
              <tab.icon
                className={cn('h-5 w-5 shrink-0', active && 'stroke-[2.25px]')}
                aria-hidden
              />
              <span className="text-[10px] font-semibold truncate max-w-full px-0.5">
                {tab.label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
