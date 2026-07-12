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

/**
 * Search icon only in the top bar.
 * The full search bar + results appear after the user taps the icon (or presses Ctrl/⌘K).
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const roles = useAuthStore((s) => s.user?.roles || []);
  const permissions = useAuthStore((s) => s.user?.permissions || []);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setDebounced('');
    setActiveIndex(0);
  }, []);

  const openSearch = useCallback(() => {
    setOpen(true);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 220);
    return () => window.clearTimeout(t);
  }, [query]);

  // Rotating placeholder while open and empty
  useEffect(() => {
    if (!open || query) return;
    const t = window.setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 3200);
    return () => window.clearInterval(t);
  }, [open, query]);

  // Focus input when panel opens
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Ctrl/⌘K opens · Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const allowedLinks = useMemo(
    () => QUICK_LINKS.filter((l) => canAccessPath(l.to, roles, permissions)),
    [roles, permissions]
  );

  const pageHits = useMemo(() => {
    const q = debounced.toLowerCase();
    if (!q) return allowedLinks.slice(0, 6);
    return allowedLinks
      .filter((l) => matchQuery(q, l.label, l.hint, l.to, ...l.keywords))
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
      close();
    },
    [navigate, close]
  );

  const onKeyDown = (e: { key: string; preventDefault: () => void }) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
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

  const resultsList = (
    <div className="overflow-y-auto overscroll-contain flex-1 min-h-0">
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
            Products{' '}
            {productsLoading
              ? '· searching…'
              : productHits.length
                ? `· ${productHits.length}`
                : ''}
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
            <p className="px-3 py-3 text-xs text-muted-foreground">
              No products match “{debounced}”
            </p>
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

  const iconButton = (
    <motion.button
      type="button"
      whileTap={{ scale: 0.92 }}
      whileHover={{ scale: 1.05 }}
      className="topbar-action relative inline-flex h-10 w-10 sm:h-9 sm:w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-primary hover:bg-muted/80 shrink-0 transition-colors"
      aria-label="Search"
      title="Search (Ctrl+K)"
      onClick={openSearch}
    >
      <motion.span
        animate={{ rotate: [0, -10, 10, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 3.5 }}
      >
        <Search className="h-[1.125rem] w-[1.125rem]" />
      </motion.span>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl border border-primary/25"
        animate={{ opacity: [0.12, 0.4, 0.12], scale: [1, 1.06, 1] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.button>
  );

  const panel =
    typeof document !== 'undefined' &&
    createPortal(
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[80] flex flex-col sm:items-center sm:justify-start sm:pt-[min(12vh,5rem)] sm:px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {/* Backdrop */}
            <motion.button
              type="button"
              aria-label="Close search"
              className="absolute inset-0 bg-background/80 backdrop-blur-md sm:bg-black/45 sm:backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
            />

            {/* Search card */}
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Search"
              initial={{ opacity: 0, y: -28, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="relative z-10 flex flex-col w-full h-full sm:h-auto sm:max-h-[min(78dvh,36rem)] sm:max-w-xl sm:rounded-2xl sm:border sm:border-border/80 sm:bg-card sm:shadow-elevated sm:overflow-hidden bg-background"
            >
              {/* Gradient accent line */}
              <div className="h-0.5 w-full shrink-0 bg-gradient-to-r from-primary via-sky-400 to-primary bg-[length:200%_100%] animate-[search-shimmer_2.2s_linear_infinite]" />

              {/* Search input row */}
              <div className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3 pb-3 border-b border-border/60">
                <motion.div
                  className="relative flex flex-1 items-center gap-2 rounded-2xl border border-primary/35 bg-card sm:bg-muted/40 px-3 h-12 shadow-glow"
                  initial={{ scale: 0.97 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 24 }}
                >
                  <motion.span
                    animate={{ scale: [1, 1.12, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity }}
                    className="text-primary shrink-0"
                  >
                    <Search className="h-5 w-5" />
                  </motion.span>

                  <div className="relative flex-1 min-w-0 h-full">
                    <input
                      ref={inputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={onKeyDown}
                      className="absolute inset-0 w-full bg-transparent text-base sm:text-sm font-medium outline-none"
                      placeholder=""
                      aria-label="Search products and pages"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {!query && (
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
                  </div>

                  {query ? (
                    <button
                      type="button"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted hover:bg-muted-foreground/15 text-muted-foreground"
                      onClick={() => {
                        setQuery('');
                        inputRef.current?.focus();
                      }}
                      aria-label="Clear search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-border/70 bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-sm shrink-0">
                      <Command className="h-2.5 w-2.5" />K
                    </kbd>
                  )}
                </motion.div>

                <button
                  type="button"
                  className="h-12 px-3 rounded-2xl text-sm font-semibold text-primary shrink-0 hover:bg-primary/10 transition-colors"
                  onClick={close}
                >
                  Cancel
                </button>
              </div>

              {resultsList}

              <div className="hidden sm:flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground bg-muted/30 shrink-0">
                <span>↑↓ navigate · Enter open · Esc close</span>
                <span className="font-medium text-primary/80">Live search</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    );

  return (
    <>
      {iconButton}
      {panel}
    </>
  );
}
