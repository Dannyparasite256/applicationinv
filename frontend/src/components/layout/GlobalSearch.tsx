import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  BarChart3,
  Calculator,
  Command,
  FileText,
  HeartPulse,
  LayoutDashboard,
  Package,
  Search,
  Settings,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { canAccessPath } from '@/lib/roleAccess';

type QuickLink = {
  id: string;
  label: string;
  hint: string;
  to: string;
  icon: LucideIcon;
  keywords: string[];
};

type ProductHit = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  sellingPrice?: number | string;
};

const QUICK_LINKS: QuickLink[] = [
  {
    id: 'dash',
    label: 'Dashboard',
    hint: 'Overview & KPIs',
    to: '/app',
    icon: LayoutDashboard,
    keywords: ['home', 'overview', 'kpi'],
  },
  {
    id: 'pos',
    label: 'POS',
    hint: 'Point of sale',
    to: '/app/pos',
    icon: Store,
    keywords: ['cashier', 'checkout', 'till'],
  },
  {
    id: 'products',
    label: 'Products',
    hint: 'Catalog & prices',
    to: '/app/products',
    icon: Package,
    keywords: ['inventory', 'sku', 'stock', 'item'],
  },
  {
    id: 'sales',
    label: 'Sales',
    hint: 'Orders & history',
    to: '/app/sales',
    icon: ShoppingCart,
    keywords: ['orders', 'receipts'],
  },
  {
    id: 'customers',
    label: 'Customers',
    hint: 'CRM contacts',
    to: '/app/customers',
    icon: Users,
    keywords: ['client', 'crm'],
  },
  {
    id: 'purchases',
    label: 'Purchases',
    hint: 'Stock orders',
    to: '/app/purchases',
    icon: Truck,
    keywords: ['supplier', 'po'],
  },
  {
    id: 'invoices',
    label: 'Invoices',
    hint: 'Billing',
    to: '/app/invoices',
    icon: FileText,
    keywords: ['bill', 'invoice'],
  },
  {
    id: 'reports',
    label: 'Reports',
    hint: 'Analytics',
    to: '/app/reports',
    icon: BarChart3,
    keywords: ['analytics', 'profit'],
  },
  {
    id: 'accounting',
    label: 'Accounting',
    hint: 'Books & ledger',
    to: '/app/accounting',
    icon: Calculator,
    keywords: ['ledger', 'books'],
  },
  {
    id: 'hospital',
    label: 'Hospital',
    hint: 'Patients',
    to: '/app/hospital',
    icon: HeartPulse,
    keywords: ['patient', 'clinic'],
  },
  {
    id: 'settings',
    label: 'Settings',
    hint: 'Profile, currency, staff',
    to: '/app/settings',
    icon: Settings,
    keywords: ['profile', 'currency', 'font', 'staff'],
  },
];

const PLACEHOLDERS = [
  'Search products, pages, customers…',
  'Try “POS” or a product name…',
  'Jump to sales, stock, invoices…',
  'Find anything in your business…',
];

function matchQuery(q: string, ...parts: Array<string | null | undefined>) {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return parts.some((p) => (p || '').toLowerCase().includes(n));
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const roles = useAuthStore((s) => s.user?.roles || []);
  const permissions = useAuthStore((s) => s.user?.permissions || []);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [focused, setFocused] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(t);
  }, [query]);

  // Rotating placeholder when idle
  useEffect(() => {
    if (focused || query) return;
    const t = window.setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 3200);
    return () => window.clearInterval(t);
  }, [focused, query]);

  const open = focused || mobileOpen;

  const allowedLinks = useMemo(
    () => QUICK_LINKS.filter((l) => canAccessPath(l.to, roles, permissions)),
    [roles, permissions]
  );

  const pageHits = useMemo(() => {
    const q = debounced.toLowerCase();
    if (!q) return allowedLinks.slice(0, 6);
    return allowedLinks
      .filter(
        (l) =>
          matchQuery(q, l.label, l.hint, l.to, ...l.keywords)
      )
      .slice(0, 8);
  }, [allowedLinks, debounced]);

  const canSearchProducts = canAccessPath('/app/products', roles, permissions);

  const { data: productHits = [], isFetching: productsLoading } = useQuery({
    queryKey: ['global-search-products', debounced],
    enabled: open && canSearchProducts && debounced.length >= 1,
    staleTime: 15_000,
    queryFn: async () => {
      const res = await api.get('/products', {
        params: { search: debounced, limit: 8 },
      });
      return (res.data?.data || []) as ProductHit[];
    },
  });

  type ResultRow =
    | { kind: 'page'; item: QuickLink }
    | { kind: 'product'; item: ProductHit };

  const rows: ResultRow[] = useMemo(() => {
    const out: ResultRow[] = pageHits.map((item) => ({ kind: 'page' as const, item }));
    if (debounced) {
      for (const item of productHits) {
        out.push({ kind: 'product', item });
      }
    }
    return out;
  }, [pageHits, productHits, debounced]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced, open]);

  const go = useCallback(
    (row: ResultRow) => {
      if (row.kind === 'page') {
        navigate(row.item.to);
      } else {
        navigate(`/app/products?q=${encodeURIComponent(row.item.name || '')}`);
      }
      setQuery('');
      setFocused(false);
      setMobileOpen(false);
      inputRef.current?.blur();
    },
    [navigate]
  );

  const onKeyDown = (e: { key: string; preventDefault: () => void }) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setFocused(false);
      setMobileOpen(false);
      setQuery('');
      inputRef.current?.blur();
      return;
    }
    if (!rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[activeIndex] || rows[0];
      if (row) go(row);
    }
  };

  // Click outside (desktop)
  useEffect(() => {
    if (!focused) return;
    const onDoc = (ev: MouseEvent) => {
      if (!shellRef.current?.contains(ev.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [focused]);

  // ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.matchMedia('(max-width: 767px)').matches) {
          setMobileOpen(true);
        } else {
          setFocused(true);
          window.setTimeout(() => inputRef.current?.focus(), 10);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      window.setTimeout(() => mobileInputRef.current?.focus(), 80);
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileOpen]);

  const showPanel = focused && (rows.length > 0 || debounced.length > 0 || productsLoading);

  const resultsList = (compact?: boolean) => (
    <div className={cn('overflow-y-auto overscroll-contain', compact ? 'max-h-[min(60dvh,22rem)]' : 'flex-1')}>
      {!debounced && (
        <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-primary" />
          Quick jump
        </p>
      )}
      {debounced && pageHits.length > 0 && (
        <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pages
        </p>
      )}
      {pageHits.map((item, i) => {
        const idx = rows.findIndex((r) => r.kind === 'page' && r.item.id === item.id);
        const active = idx === activeIndex;
        const Icon = item.icon;
        return (
          <motion.button
            key={item.id}
            type="button"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.18) }}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
              active ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/80'
            )}
            onMouseEnter={() => setActiveIndex(idx)}
            onClick={() => go({ kind: 'page', item })}
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors',
                active
                  ? 'border-primary/30 bg-primary text-primary-foreground shadow-glow'
                  : 'border-border/60 bg-muted/50 text-primary'
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold truncate">{item.label}</span>
              <span className="block text-[11px] text-muted-foreground truncate">{item.hint}</span>
            </span>
            <ArrowRight
              className={cn(
                'h-4 w-4 shrink-0 transition-all',
                active ? 'text-primary translate-x-0 opacity-100' : 'opacity-0 -translate-x-1'
              )}
            />
          </motion.button>
        );
      })}

      {debounced && canSearchProducts && (
        <>
          <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t border-border/50 mt-1">
            Products {productsLoading ? '· searching…' : productHits.length ? `· ${productHits.length}` : ''}
          </p>
          {productHits.map((item, i) => {
            const idx = rows.findIndex((r) => r.kind === 'product' && r.item.id === item.id);
            const active = idx === activeIndex;
            return (
              <motion.button
                key={item.id}
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.035, 0.2) }}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                  active ? 'bg-primary/10' : 'hover:bg-muted/80'
                )}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => go({ kind: 'product', item })}
              >
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
                    active
                      ? 'border-primary/30 bg-primary text-primary-foreground'
                      : 'border-border/60 bg-muted/50 text-muted-foreground'
                  )}
                >
                  <Package className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">{item.name}</span>
                  <span className="block text-[11px] text-muted-foreground truncate font-mono">
                    {[item.sku, item.barcode].filter(Boolean).join(' · ') || 'Product'}
                  </span>
                </span>
                {item.sellingPrice != null && (
                  <span className="text-xs font-semibold tabular-nums text-primary shrink-0">
                    {formatCurrency(Number(item.sellingPrice))}
                  </span>
                )}
              </motion.button>
            );
          })}
          {!productsLoading && productHits.length === 0 && (
            <p className="px-3 py-3 text-xs text-muted-foreground">No products match “{debounced}”</p>
          )}
        </>
      )}

      {debounced && !pageHits.length && !productHits.length && !productsLoading && (
        <div className="px-4 py-8 text-center">
          <Search className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm font-medium">No results</p>
          <p className="text-xs text-muted-foreground mt-1">Try another product or page name</p>
        </div>
      )}
    </div>
  );

  const desktopBar = (
    <div ref={shellRef} className="relative hidden md:block flex-1 max-w-xl min-w-0 mr-auto">
      <motion.div
        layout
        animate={{
          scale: focused ? 1.01 : 1,
        }}
        transition={{ type: 'spring', stiffness: 420, damping: 28 }}
        className={cn(
          'global-search-shell group relative rounded-2xl transition-shadow duration-300',
          focused && 'z-50'
        )}
      >
        {/* Animated gradient border / glow */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-[1px] rounded-2xl opacity-0"
          animate={{
            opacity: focused ? 1 : 0,
            background: focused
              ? 'linear-gradient(120deg, hsl(var(--primary) / 0.55), hsl(199 89% 48% / 0.45), hsl(var(--primary) / 0.35))'
              : 'transparent',
          }}
          transition={{ duration: 0.25 }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-2 rounded-3xl blur-xl"
          animate={{
            opacity: focused ? 0.35 : 0,
            scale: focused ? 1 : 0.95,
          }}
          style={{
            background:
              'radial-gradient(circle at 30% 50%, hsl(var(--primary) / 0.35), transparent 65%)',
          }}
        />

        <div
          className={cn(
            'relative flex items-center gap-2 rounded-2xl border bg-muted/40 backdrop-blur-md px-3 h-10 transition-colors duration-200',
            focused
              ? 'border-transparent bg-card shadow-elevated'
              : 'border-border/50 hover:border-primary/25 hover:bg-muted/60'
          )}
        >
          <motion.span
            animate={{
              rotate: focused || query ? 0 : [0, -12, 12, 0],
              scale: focused ? 1.08 : 1,
            }}
            transition={
              focused || query
                ? { type: 'spring', stiffness: 400, damping: 20 }
                : { duration: 2.4, repeat: Infinity, repeatDelay: 3.2 }
            }
            className={cn(
              'shrink-0 transition-colors',
              focused ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <Search className="h-4 w-4" />
          </motion.span>

          <div className="relative flex-1 min-w-0 h-full">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onKeyDown={onKeyDown}
              className="absolute inset-0 w-full bg-transparent text-sm font-medium outline-none placeholder:text-transparent"
              placeholder={PLACEHOLDERS[0]}
              aria-label="Search app"
              autoComplete="off"
              spellCheck={false}
            />
            {/* Animated placeholder */}
            {!query && !focused && (
              <div className="pointer-events-none absolute inset-0 flex items-center overflow-hidden">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={placeholderIdx}
                    initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
                    animate={{ opacity: 0.55, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    className="text-sm text-muted-foreground truncate"
                  >
                    {PLACEHOLDERS[placeholderIdx]}
                  </motion.span>
                </AnimatePresence>
              </div>
            )}
            {!query && focused && (
              <span className="pointer-events-none absolute inset-0 flex items-center text-sm text-muted-foreground/50 truncate">
                Type to search products & pages…
              </span>
            )}
          </div>

          <AnimatePresence>
            {query ? (
              <motion.button
                type="button"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted hover:bg-muted-foreground/15 text-muted-foreground"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </motion.button>
            ) : (
              <motion.kbd
                initial={{ opacity: 0 }}
                animate={{ opacity: focused ? 0 : 1 }}
                className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-border/70 bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-sm"
              >
                <Command className="h-2.5 w-2.5" />K
              </motion.kbd>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {showPanel && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-border/80 bg-card/95 backdrop-blur-xl shadow-elevated"
            >
              <div className="h-0.5 w-full bg-gradient-to-r from-primary via-sky-400 to-primary bg-[length:200%_100%] animate-[search-shimmer_2.2s_linear_infinite]" />
              {resultsList(true)}
              <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground bg-muted/30">
                <span>↑↓ navigate · Enter open · Esc close</span>
                <span className="font-medium text-primary/80">Live search</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );

  const mobileTrigger = (
    <motion.button
      type="button"
      whileTap={{ scale: 0.92 }}
      className="topbar-action md:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground shrink-0 relative"
      aria-label="Search"
      onClick={() => setMobileOpen(true)}
    >
      <Search className="h-4.5 w-4.5 h-[1.125rem] w-[1.125rem]" />
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-xl border border-primary/30"
        animate={{ opacity: [0.15, 0.45, 0.15], scale: [1, 1.08, 1] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.button>
  );

  const mobileOverlay =
    typeof document !== 'undefined' &&
    createPortal(
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-[80] flex flex-col bg-background/95 backdrop-blur-xl md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ y: -24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 360, damping: 30 }}
              className="pt-[max(0.75rem,env(safe-area-inset-top))] px-3 pb-2 border-b border-border/60"
            >
              <div className="flex items-center gap-2">
                <div className="relative flex flex-1 items-center gap-2 rounded-2xl border border-primary/30 bg-card px-3 h-12 shadow-glow">
                  <motion.span
                    animate={{ scale: [1, 1.12, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity }}
                    className="text-primary"
                  >
                    <Search className="h-5 w-5" />
                  </motion.span>
                  <input
                    ref={mobileInputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    className="flex-1 min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                    placeholder="Search products & pages…"
                    autoComplete="off"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  {query && (
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                      onClick={() => setQuery('')}
                      aria-label="Clear"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="h-12 px-3 rounded-2xl text-sm font-semibold text-primary"
                  onClick={() => {
                    setMobileOpen(false);
                    setQuery('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="flex-1 min-h-0 overflow-hidden flex flex-col"
            >
              {resultsList(false)}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    );

  return (
    <>
      {desktopBar}
      {mobileTrigger}
      {mobileOverlay}
    </>
  );
}
