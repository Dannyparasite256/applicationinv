import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Search,
  Trash2,
  Plus,
  Minus,
  CreditCard,
  Banknote,
  WifiOff,
  ShoppingCart,
  Keyboard,
  Printer,
  RefreshCw,
  Users,
  Share2,
  Download,
  CloudOff,
  Camera,
  PackageSearch,
  Star,
  Clock,
  DoorOpen,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getErrorMessage } from '@/lib/api';
import { formatCurrency, parseMoneyToBase, displayCurrencyCode } from '@/lib/utils';
import { getMediaUrl } from '@/lib/media';
import { usePosStore } from '@/stores/posStore';
import { useNetworkStore } from '@/stores/networkStore';
import { useCurrencyStore } from '@/stores/currencyStore';
import { useAuthStore } from '@/stores/authStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { canRefundOrDeleteSales } from '@/lib/roleAccess';
import { getCachedProductByBarcode, getCachedProducts } from '@/lib/offline/db';
import { queueOfflineSale, runSyncEngine, refreshOfflineCatalog } from '@/lib/offline/syncEngine';
import { downloadPdf } from '@/lib/printShare';
import { scanBarcode } from '@/native/barcodeScan';
import { celebrateSuccess } from '@/lib/feedback';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { PrintShareDialog } from '@/components/shared/PrintShareDialog';
import { SuccessBurst } from '@/components/shared/SuccessBurst';
import { staggerItem } from '@/components/shared/PageTransition';

interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  sellingPrice: string | number;
  trackInventory: boolean;
  stockQty?: number;
  imageUrl?: string | null;
  tax?: { rate: string | number } | null;
}

/** Min characters before product search fires (avoids dumping the whole catalog) */
const SEARCH_MIN = 1;

export function PosPage() {
  const navigate = useNavigate();
  const scanRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const defaultPay = usePreferencesStore((s) => s.posDefaultPayment) as 'CASH' | 'CARD' | 'MOBILE_MONEY';
  const setPosDefaultPayment = usePreferencesStore((s) => s.setPosDefaultPayment);
  const favorites = usePreferencesStore((s) => s.posFavorites);
  const recent = usePreferencesStore((s) => s.posRecent);
  const toggleFavorite = usePreferencesStore((s) => s.toggleFavorite);
  const pushRecent = usePreferencesStore((s) => s.pushRecent);
  const completeOnboardingStep = usePreferencesStore((s) => s.completeOnboardingStep);
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD' | 'MOBILE_MONEY'>(
    defaultPay === 'CARD' || defaultPay === 'MOBILE_MONEY' ? defaultPay : 'CASH'
  );
  const [tendered, setTendered] = useState('');
  const online = useNetworkStore((s) => s.online);
  const syncing = useNetworkStore((s) => s.syncing);
  const pendingCount = useNetworkStore((s) => s.pendingCount);
  const displayCurrency = useCurrencyStore((s) => s.displayCurrency);
  const baseCurrency = useCurrencyStore((s) => s.baseCurrency);
  const currencies = useCurrencyStore((s) => s.currencies);
  const convert = useCurrencyStore((s) => s.convert);
  const [payCurrency, setPayCurrency] = useState(displayCurrency);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [lastSaleNo, setLastSaleNo] = useState<string | null>(null);
  const [lastSaleTotal, setLastSaleTotal] = useState<number | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const [customerId, setCustomerIdLocal] = useState<string>('');
  const [redeemPoints, setRedeemPoints] = useState('');
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountInput, setDiscountInput] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [shiftNotes, setShiftNotes] = useState('');
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [lastCustomerPhone, setLastCustomerPhone] = useState<string | null>(null);
  const qc = useQueryClient();

  // Debounce search so we don't spam the API on every keystroke
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => window.clearTimeout(t);
  }, [query]);

  // Prefetch offline catalog once when online (search still required to show results)
  useEffect(() => {
    if (online) void refreshOfflineCatalog();
  }, [online]);

  const {
    cart,
    addItem,
    updateQty,
    removeItem,
    clearCart,
    cartTotal,
    discountAmount,
    setDiscount,
    offlineQueue,
    setCustomerId,
  } = usePosStore();

  const totals = cartTotal();
  const queued = Math.max(offlineQueue.length, pendingCount);

  // Keep payment currency in sync with app display currency when user switches top-bar currency
  useEffect(() => {
    setPayCurrency(displayCurrency);
  }, [displayCurrency]);

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        scanRef.current?.focus();
      }
      if (e.key === 'F9') {
        e.preventDefault();
        handleCheckout();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, payMethod, tendered, online]);

  const searchTerm = debouncedQuery;
  const canSearch = searchTerm.length >= SEARCH_MIN;

  // Search-only product lookup — do not load the full catalog onto the POS screen
  const {
    data: products,
    isFetching: searchingProducts,
    isError: searchError,
  } = useQuery({
    queryKey: ['pos-products-search', searchTerm, online],
    enabled: canSearch,
    queryFn: async () => {
      if (!online) {
        return (await getCachedProducts(searchTerm)) as Product[];
      }
      try {
        const res = await api.get('/products', {
          params: { search: searchTerm, limit: 20, isActive: true },
        });
        // Warm offline cache in the background (not shown until user searches)
        void refreshOfflineCatalog();
        return (res.data.data || []) as Product[];
      } catch {
        return (await getCachedProducts(searchTerm)) as Product[];
      }
    },
    staleTime: 15_000,
  });

  const { data: customers } = useQuery({
    queryKey: ['pos-customers', online],
    queryFn: async () => {
      if (!online) {
        const { getCachedCustomers } = await import('@/lib/offline/db');
        return getCachedCustomers();
      }
      try {
        return (await api.get('/customers', { params: { limit: 100 } })).data.data as Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          businessName?: string;
          code: string;
          phone?: string;
          balance?: number | string;
          creditLimit?: number | string;
          loyaltyPoints?: number;
        }>;
      } catch {
        const { getCachedCustomers } = await import('@/lib/offline/db');
        return getCachedCustomers();
      }
    },
  });

  const selectedCustomer = (customers || []).find((c) => c.id === customerId);

  const staffUserId = useAuthStore((s) => s.user?.id);
  const authUser = useAuthStore((s) => s.user);
  const canReverseSales = canRefundOrDeleteSales(authUser?.roles || [], authUser?.permissions || []);

  const { data: shift } = useQuery({
    queryKey: ['current-shift', staffUserId],
    queryFn: async () => {
      if (!online) return null;
      const res = await api.get('/sales/shifts/current');
      return res.data.data as { id: string; shiftNo: string } | null;
    },
    enabled: online && !!staffUserId,
  });

  const openShift = useMutation({
    mutationFn: async () => {
      const res = await api.post('/sales/shifts/open', { openingCash: 0 });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Shift opened');
      qc.invalidateQueries({ queryKey: ['current-shift', staffUserId] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  /** Refresh dashboard KPIs, sales lists, stock, reports after any sale change */
  const refreshEverywhereAfterSaleChange = () => {
    const keys = [
      'sales',
      'dashboard',
      'products',
      'products-mini',
      'pos-products-search',
      'pos-products',
      'stock-levels',
      'stock-movements',
      'low-stock',
      'current-shift',
      'reports',
      'report-sales',
      'report-profit',
    ];
    for (const key of keys) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
    void qc.refetchQueries({ queryKey: ['dashboard'], type: 'all' });
    void qc.refetchQueries({ queryKey: ['sales'], type: 'all' });
    void qc.refetchQueries({ queryKey: ['products'], type: 'all' });
  };

  const checkout = useMutation({
    mutationFn: async () => {
      const currentCart = usePosStore.getState().cart;
      if (!currentCart.length) {
        throw new Error('Cart is empty — search and add a product first');
      }

      // Soft stock check (tracked items) — treat missing stockQty as 0 so zero-stock products never reach the API
      for (const line of currentCart) {
        if (!line.trackInventory) continue;
        const available = line.stockQty != null ? Number(line.stockQty) : 0;
        if (line.quantity > available) {
          throw new Error(
            `Not enough stock for ${line.name} (available ${available}, in cart ${line.quantity}). Receive stock first.`
          );
        }
      }

      // Ensure a shift exists when online (auto-open so Charge never blocks)
      let shiftId = shift?.id as string | undefined;
      if (online && !shiftId) {
        try {
          const opened = await api.post('/sales/shifts/open', { openingCash: 0 });
          shiftId = opened.data?.data?.id as string | undefined;
          void qc.invalidateQueries({ queryKey: ['current-shift'] });
        } catch {
          // "already open" or network — sale does not require a shift
          shiftId = undefined;
        }
      }

      // Prefer settling in company base currency to avoid FX edge-cases on mobile
      const cartTotals = usePosStore.getState().cartTotal();
      const totalBase = Math.round((Number(cartTotals.total) || 0) * 10000) / 10000;
      const payCur = (payCurrency || baseCurrency || 'USD').toUpperCase();
      const baseCur = (baseCurrency || 'USD').toUpperCase();

      let paidInPayCur = convert(totalBase, baseCur, payCur);
      if (payMethod === 'CASH' && tendered) {
        const t = parseFloat(tendered);
        if (Number.isFinite(t) && t > 0) {
          paidInPayCur = Math.max(t, paidInPayCur);
        }
      }
      if (!Number.isFinite(paidInPayCur) || paidInPayCur <= 0) {
        // Safe fallback: charge full total in base currency
        paidInPayCur = totalBase > 0 ? totalBase : 0.01;
      }

      const rates = useCurrencyStore.getState().rates;
      const rate = payCur === baseCur ? 1 : rates[payCur] ?? 1;

      const payload = {
        currency: payCur,
        items: currentCart.map((c) => ({
          productId: c.productId,
          quantity: Number(c.quantity),
          unitPrice: Number(c.unitPrice),
          discount: Number(c.discount) || 0,
        })),
        payments: [
          {
            method: payMethod,
            amount: Math.round(paidInPayCur * 10000) / 10000,
            currency: payCur,
            exchangeRate: rate > 0 ? rate : 1,
          },
        ],
        // Discount is optional — only send when user enabled and entered a value
        discountAmount: applyDiscount
          ? Math.max(0, Number(usePosStore.getState().discountAmount) || 0)
          : 0,
        shiftId: shiftId || null,
        customerId: customerId || null,
        redeemPoints: customerId && redeemPoints ? Math.floor(Number(redeemPoints) || 0) : 0,
      };

      if (!online) {
        await queueOfflineSale(payload);
        return { offline: true as const, data: undefined };
      }
      try {
        const res = await api.post('/sales', payload);
        const body = res.data as {
          success?: boolean;
          data?: { id: string; saleNo: string; paymentStatus?: string; total?: number };
          message?: string;
        };
        if (!body?.data?.id) {
          throw new Error(body?.message || 'Sale was not recorded (empty response)');
        }
        return { offline: false as const, data: body.data };
      } catch (e) {
        if (!navigator.onLine || (e as { code?: string })?.code === 'ERR_NETWORK') {
          await queueOfflineSale(payload);
          return { offline: true as const, data: undefined };
        }
        throw e;
      }
    },
    onSuccess: (result) => {
      if (result.offline) {
        void celebrateSuccess('Sale saved offline', 'Will sync when you’re back online');
        clearCart();
        setTendered('');
        setQuery('');
        setApplyDiscount(false);
        setDiscountInput('');
        setDiscount(0);
        setShowSuccess(true);
        setLastSaleTotal(totals.total);
      } else {
        const sale = result.data;
        void celebrateSuccess(
          sale?.saleNo ? `Sale ${sale.saleNo} complete` : 'Sale recorded',
          formatCurrency(Number(sale?.total ?? totals.total))
        );
        setLastSaleId(sale?.id || null);
        setLastSaleNo(sale?.saleNo || null);
        setLastSaleTotal(Number(sale?.total ?? totals.total));
        setLastCustomerPhone(selectedCustomer?.phone || null);
        setShowSuccess(true);
        clearCart();
        setTendered('');
        setCustomerIdLocal('');
        setCustomerId(null);
        setRedeemPoints('');
        setQuery('');
        setApplyDiscount(false);
        setDiscountInput('');
        setDiscount(0);
        completeOnboardingStep('sale');
      }
      setPosDefaultPayment(payMethod);
      refreshEverywhereAfterSaleChange();
      scanRef.current?.focus();
    },
    onError: (e) => toast.error(getErrorMessage(e) || 'Could not record sale'),
  });

  const closeShift = useMutation({
    mutationFn: async () => {
      if (!shift?.id) throw new Error('No open shift');
      const cash = parseFloat(closingCash);
      if (!Number.isFinite(cash) || cash < 0) throw new Error('Enter closing cash amount');
      return (
        await api.post(`/sales/shifts/${shift.id}/close`, {
          closingCash: cash,
          notes: shiftNotes || undefined,
        })
      ).data.data as {
        openingCash?: number;
        closingCash?: number;
        expectedCash?: number;
        difference?: number;
      };
    },
    onSuccess: async (data) => {
      const exp = data?.expectedCash != null ? formatCurrency(Number(data.expectedCash)) : null;
      const diff =
        data?.difference != null ? formatCurrency(Number(data.difference)) : null;
      toast.success('Shift closed', {
        description: [exp ? `Expected ${exp}` : null, diff ? `Difference ${diff}` : null]
          .filter(Boolean)
          .join(' · ') || undefined,
      });
      const closedId = (data as { id?: string })?.id || shift?.id;
      if (closedId) {
        try {
          const { useAuthStore } = await import('@/stores/authStore');
          const { getApiBaseUrl } = await import('@/lib/config');
          const token = useAuthStore.getState().accessToken;
          const res = await fetch(
            `${getApiBaseUrl()}/sales/shifts/${closedId}/z-report.pdf`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (res.ok) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `z-report-${closedId.slice(0, 8)}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            toast.message('Z-report PDF downloaded');
          }
        } catch {
          /* optional */
        }
      }
      setShowCloseShift(false);
      setClosingCash('');
      setShiftNotes('');
      void qc.invalidateQueries({ queryKey: ['current-shift'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const favoriteIds = favorites;
  const recentIds = recent.map((r) => r.id);
  const pinIds = [...new Set([...favoriteIds, ...recentIds])].slice(0, 16);
  const { data: pinnedProducts } = useQuery({
    queryKey: ['pos-pinned', pinIds.join(',')],
    enabled: pinIds.length > 0 && !debouncedQuery.trim(),
    staleTime: 60_000,
    queryFn: async () => {
      // Load from catalog cache / search by fetching products list and filtering
      const res = await api.get('/products', { params: { limit: 100 } });
      const list = (res.data?.data || []) as Product[];
      const map = new Map(list.map((p) => [p.id, p]));
      return pinIds.map((id) => map.get(id)).filter(Boolean) as Product[];
    },
  });

  const syncOffline = useMutation({
    mutationFn: async () => runSyncEngine(),
    onSuccess: (data) => {
      if (data.synced) toast.success(`Synced ${data.synced} offline sale(s)`);
      else toast.message('No pending offline sales');
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const openLastReceipt = (doAutoPrint = false) => {
    if (!lastSaleId) return;
    setAutoPrint(doAutoPrint);
    setPrintOpen(true);
  };

  const deleteLastSale = useMutation({
    mutationFn: async () => {
      if (!lastSaleId) throw new Error('No sale to delete');
      return api.post(`/sales/${lastSaleId}/void`, {
        reason: 'Mistake — deleted from POS',
      });
    },
    onSuccess: () => {
      toast.success('Sale deleted — stock & dashboard updated');
      setLastSaleId(null);
      setLastSaleNo(null);
      refreshEverywhereAfterSaleChange();
    },
    onError: (e) => toast.error(getErrorMessage(e) || 'Could not delete sale'),
  });

  const addProduct = (p: Product) => {
    const stock = p.stockQty != null ? Number(p.stockQty) : 0;
    if (p.trackInventory && stock <= 0) {
      toast.error(
        `${p.name} has no stock (0). Add stock under Inventory or set initial quantity when registering the product.`
      );
      return;
    }
    // Cap quantity when already in cart above available stock
    const existing = usePosStore.getState().cart.find((c) => c.productId === p.id);
    if (p.trackInventory && existing && existing.quantity >= stock) {
      toast.error(`Only ${stock} in stock for ${p.name}`);
      return;
    }
    addItem({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      unitPrice: Number(p.sellingPrice),
      taxRate: p.tax ? Number(p.tax.rate) : 0,
      trackInventory: p.trackInventory,
      stockQty: stock,
    });
    pushRecent(p.id);
    toast.message(`Added ${p.name}`);
  };

  const handleScan = async (value: string) => {
    const code = value.trim();
    if (!code) return;
    try {
      let p: Product | undefined;
      if (online) {
        try {
          const res = await api.get(`/products/barcode/${encodeURIComponent(code)}`);
          p = res.data.data as Product;
        } catch {
          // Fall through to search / cache
          p = await getCachedProductByBarcode(code);
        }
      } else {
        p = await getCachedProductByBarcode(code);
      }
      if (!p) {
        // Treat as text search term so results appear in the list
        setQuery(code);
        toast.message('No exact barcode match — searching catalog');
        return;
      }
      addProduct(p);
      setQuery('');
      if (scanRef.current) scanRef.current.value = '';
    } catch {
      setQuery(code);
    }
  };

  const scanWithCamera = async () => {
    try {
      setScanning(true);
      const code = await scanBarcode({ title: 'Scan product barcode' });
      if (!code) {
        toast.message('Scan cancelled');
        return;
      }
      await handleScan(code);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Camera scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleCheckout = () => {
    if (!cart.length) {
      toast.error('Cart is empty — search and add a product first');
      return;
    }
    checkout.mutate();
  };

  const totalInPayCur = convert(totals.total, baseCurrency, payCurrency);
  const change =
    payMethod === 'CASH' && tendered
      ? Math.max(0, parseFloat(tendered) - totalInPayCur)
      : 0;

  return (
    <div className="h-[calc(100dvh-var(--app-topbar-total,var(--app-topbar-h)))] max-h-[calc(100dvh-var(--app-topbar-total,var(--app-topbar-h)))] flex flex-col lg:flex-row min-h-0 min-w-0 w-full max-w-full overflow-hidden">
      {lastSaleId && (
        <PrintShareDialog
          open={printOpen}
          onClose={() => {
            setPrintOpen(false);
            setAutoPrint(false);
          }}
          type="receipt"
          id={lastSaleId}
          autoPrint={autoPrint}
        />
      )}

      {/* Product search + results — scrolls independently */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 border-r border-border lg:max-h-none max-h-[42%]">
        <div className="p-2 sm:p-3 border-b border-border space-y-1.5 sm:space-y-2 bg-gradient-to-r from-card via-card to-primary/5 shrink-0 min-w-0">
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <h1 className="text-base sm:text-lg font-bold flex items-center gap-1.5 tracking-tight min-w-0">
              <span className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg sm:rounded-xl bg-primary/15 text-primary shrink-0">
                <ShoppingCart className="h-4 w-4" />
              </span>
              <span className="truncate">POS</span>
            </h1>
            <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap justify-end shrink-0 max-w-[70%]">
              {!online && (
                <Badge variant="warning" className="gap-1 animate-pulse text-[10px] px-1.5">
                  <WifiOff className="h-3 w-3" /> Off
                </Badge>
              )}
              {queued > 0 && <Badge variant="secondary" className="text-[10px]">{queued}</Badge>}
              {shift ? (
                <>
                  <Badge variant="success" className="text-[10px] truncate max-w-[6rem]">
                    Shift open
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs px-2"
                    onClick={() => setShowCloseShift((v) => !v)}
                  >
                    <DoorOpen className="h-3.5 w-3.5" /> Close
                  </Button>
                </>
              ) : online ? (
                <Button size="sm" className="h-7 text-xs px-2" onClick={() => openShift.mutate()} loading={openShift.isPending}>
                  Open Shift
                </Button>
              ) : (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <CloudOff className="h-3 w-3" /> Offline
                </Badge>
              )}
              {online && queued > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs px-2"
                  loading={syncOffline.isPending || syncing}
                  onClick={() => syncOffline.mutate()}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Sync
                </Button>
              )}
            </div>
          </div>

          {showCloseShift && shift && (
            <div className="rounded-xl border border-border bg-card p-3 space-y-2">
              <p className="text-xs font-semibold">Close shift</p>
              <Input
                type="number"
                placeholder="Closing cash counted"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
              />
              <Input
                placeholder="Notes (optional)"
                value={shiftNotes}
                onChange={(e) => setShiftNotes(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" loading={closeShift.isPending} onClick={() => closeShift.mutate()}>
                  Confirm close
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowCloseShift(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <SuccessBurst
            open={showSuccess && !!(lastSaleId || lastSaleTotal != null)}
            title={lastSaleNo ? `Sale ${lastSaleNo} complete` : 'Sale complete'}
            subtitle={
              lastSaleTotal != null
                ? `Total ${formatCurrency(lastSaleTotal)}${customerId ? ' · customer saved on ticket' : ''}`
                : undefined
            }
            onClose={() => setShowSuccess(false)}
            actions={[
              {
                label: 'New sale',
                onClick: () => {
                  setShowSuccess(false);
                  scanRef.current?.focus();
                },
              },
              ...(lastSaleId
                ? [
                    {
                      label: 'Print',
                      variant: 'outline' as const,
                      onClick: () => openLastReceipt(true),
                    },
                    {
                      label: 'Share',
                      variant: 'secondary' as const,
                      onClick: () => openLastReceipt(false),
                    },
                    ...(lastCustomerPhone
                      ? [
                          {
                            label: 'WhatsApp',
                            variant: 'secondary' as const,
                            onClick: () => {
                              void import('@/lib/printShare').then(({ shareWhatsApp }) => {
                                shareWhatsApp(
                                  `Thank you! Sale ${lastSaleNo || ''} total ${formatCurrency(lastSaleTotal || 0)}.`,
                                  lastCustomerPhone
                                );
                              });
                            },
                          },
                        ]
                      : []),
                    {
                      label: 'PDF',
                      variant: 'secondary' as const,
                      onClick: () =>
                        downloadPdf('receipt', lastSaleId, {
                          format: 'thermal80',
                          filename: `${lastSaleNo || 'receipt'}.pdf`,
                        })
                          .then(() => toast.success('Receipt PDF ready'))
                          .catch((e) =>
                            toast.error(e instanceof Error ? e.message : 'PDF failed')
                          ),
                    },
                  ]
                : []),
            ]}
          />

          <AnimatePresence>
            {lastSaleId && !showSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-success/10 border border-success/30 px-3 py-2.5 text-sm shadow-sm"
              >
                <span>
                  Last sale <strong className="font-mono">{lastSaleNo}</strong> completed
                </span>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => openLastReceipt(true)}>
                    <Printer className="h-3.5 w-3.5" /> Print
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      downloadPdf('receipt', lastSaleId, {
                        format: 'thermal80',
                        filename: `${lastSaleNo || 'receipt'}.pdf`,
                      })
                        .then(() => toast.success('Receipt PDF ready'))
                        .catch((e) => toast.error(e instanceof Error ? e.message : 'PDF failed'))
                    }
                  >
                    <Download className="h-3.5 w-3.5" /> PDF
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openLastReceipt(false)}>
                    <Share2 className="h-3.5 w-3.5" /> Share
                  </Button>
                  {canReverseSales && (
                    <Button
                      size="sm"
                      variant="destructive"
                      loading={deleteLastSale.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete sale ${lastSaleNo || ''}?\nStock will be restored. Use this for mistakes only.`
                          )
                        ) {
                          deleteLastSale.mutate();
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex gap-1.5 sm:gap-2 min-w-0">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={scanRef}
                className="pl-8 h-10 sm:h-11 text-sm sm:text-base shadow-sm"
                placeholder={online ? 'Search name, SKU…' : 'Search offline…'}
                value={query}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleScan((e.target as HTMLInputElement).value);
                  }
                }}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-10 sm:h-11 w-10 sm:w-11 px-0 shrink-0"
              title="Scan barcode with camera"
              loading={scanning}
              onClick={() => void scanWithCamera()}
            >
              <Camera className="h-5 w-5" />
            </Button>
          </div>
          <p className="hidden sm:flex text-[11px] text-muted-foreground items-center gap-1 flex-wrap">
            <Keyboard className="h-3 w-3" /> Search · scan · Enter · F9 charge
            {!online && ' · offline cache'}
          </p>
        </div>

        <motion.div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 sm:p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5 sm:gap-2 content-start"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.03 } } }}
        >
          {!canSearch && (
            <div className="col-span-full space-y-3 py-4">
              {(pinnedProducts?.length || 0) > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1 px-1">
                    <Star className="h-3 w-3 text-primary" /> Favorites & recent
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5 sm:gap-2">
                    {pinnedProducts!.map((p) => (
                      <div key={p.id} className="relative">
                        <button
                          type="button"
                          onClick={() => addProduct(p)}
                          className="w-full rounded-lg sm:rounded-xl border border-border bg-card p-2 sm:p-3 text-left hover:border-primary hover:shadow-md transition-colors"
                        >
                          <p className="font-medium text-xs sm:text-sm line-clamp-2">{p.name}</p>
                          <p className="mt-2 font-bold text-primary text-sm">
                            {formatCurrency(Number(p.sellingPrice))}
                          </p>
                        </button>
                        <button
                          type="button"
                          className="absolute top-1.5 right-1.5 p-1 rounded-md bg-background/80"
                          aria-label="Toggle favorite"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(p.id);
                          }}
                        >
                          <Star
                            className={`h-3.5 w-3.5 ${
                              favoriteIds.includes(p.id)
                                ? 'fill-primary text-primary'
                                : 'text-muted-foreground'
                            }`}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col items-center justify-center text-center py-8 px-4 text-muted-foreground gap-3">
                <PackageSearch className="h-10 w-10 opacity-40" />
                <div>
                  <p className="font-medium text-foreground">Search for products</p>
                  <p className="text-sm mt-1 max-w-sm">
                    Type a name, SKU, or barcode. Star items to pin them here for faster checkout.
                  </p>
                </div>
              </div>
            </div>
          )}
          {canSearch && searchingProducts && (
            <p className="col-span-full text-center text-sm text-muted-foreground py-10">Searching…</p>
          )}
          {canSearch && !searchingProducts && searchError && (
            <p className="col-span-full text-center text-sm text-destructive py-10">
              Search failed — check connection and try again
            </p>
          )}
          {canSearch &&
            !searchingProducts &&
            (products || []).map((p) => (
              <motion.div
                key={p.id}
                variants={staggerItem}
                className="relative rounded-lg sm:rounded-xl border border-border bg-card shadow-sm min-w-0"
              >
                <button
                  type="button"
                  onClick={() => addProduct(p)}
                  className="w-full p-2 sm:p-3 text-left hover:border-primary"
                >
                  <div className="flex gap-2 items-start pr-5">
                    {p.imageUrl ? (
                      <img
                        src={getMediaUrl(p.imageUrl) || ''}
                        alt=""
                        className="h-10 w-10 sm:h-11 sm:w-11 rounded-lg object-cover border border-border shrink-0 bg-muted"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-lg bg-muted/80 border border-border shrink-0 flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                        {p.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-xs sm:text-sm line-clamp-2 min-h-[2.25rem] break-safe">
                        {p.name}
                      </p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground font-mono mt-0.5 truncate">
                        {p.sku}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-bold text-primary">
                      {formatCurrency(Number(p.sellingPrice))}
                    </span>
                    {p.trackInventory && (
                      <span className="text-xs text-muted-foreground">Qty {p.stockQty ?? 0}</span>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  className="absolute top-1.5 right-1.5 p-1 rounded-md hover:bg-muted"
                  onClick={() => toggleFavorite(p.id)}
                  aria-label="Favorite"
                >
                  <Star
                    className={`h-3.5 w-3.5 ${
                      favoriteIds.includes(p.id) ? 'fill-primary text-primary' : 'text-muted-foreground'
                    }`}
                  />
                </button>
              </motion.div>
            ))}
          {canSearch && !searchingProducts && !searchError && !products?.length && (
            <div className="col-span-full text-center py-10 space-y-3">
              <p className="text-sm text-muted-foreground">No products match “{searchTerm}”</p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  navigate(
                    `/app/products?new=1&barcode=${encodeURIComponent(searchTerm)}&q=${encodeURIComponent(searchTerm)}`
                  )
                }
              >
                Create product with this code
              </Button>
            </div>
          )}
        </motion.div>
      </div>

      {/* Cart + checkout — Charge is always sticky at the bottom (no need to open discount first) */}
      <div className="w-full lg:w-[min(400px,38vw)] xl:w-[420px] flex flex-col min-h-0 flex-1 lg:flex-none bg-card/80 backdrop-blur-sm border-t lg:border-t-0 lg:border-l border-border max-w-full">
        <div className="px-2.5 sm:px-3 py-2 border-b border-border flex items-center justify-between shrink-0 min-w-0">
          <h2 className="font-semibold text-sm sm:text-base truncate">Cart ({cart.length})</h2>
          {cart.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearCart}>
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>

        {/* Scrollable: cart lines + optional extras */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 sm:p-3 space-y-2">
          {cart.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-8">
              Scan or tap products to add
            </p>
          )}
          <AnimatePresence initial={false}>
            {cart.map((item) => (
              <motion.div
                key={item.productId}
                layout
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12, height: 0 }}
                className="rounded-lg sm:rounded-xl border border-border p-2 sm:p-2.5 bg-background/60 shadow-sm min-w-0"
              >
                <div className="flex justify-between gap-2 min-w-0">
                  <p className="text-xs sm:text-sm font-medium line-clamp-1 min-w-0">{item.name}</p>
                  <button
                    onClick={() => removeItem(item.productId)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => updateQty(item.productId, item.quantity - 1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => updateQty(item.productId, item.quantity + 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    {formatCurrency(item.unitPrice * item.quantity - item.discount)}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Optional options — scroll if needed; never hide Charge */}
          <div className="space-y-2 pt-1">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  value={customerId}
                  onChange={(e) => {
                    setCustomerIdLocal(e.target.value);
                    setCustomerId(e.target.value || null);
                    setRedeemPoints('');
                  }}
                >
                  <option value="">Walk-in customer</option>
                  {(customers || []).map((c) => {
                    const bal = Number(c.balance || 0);
                    const pts = Number(c.loyaltyPoints || 0);
                    return (
                      <option key={c.id} value={c.id}>
                        {c.businessName || `${c.firstName || ''} ${c.lastName || ''}`.trim()} ({c.code})
                        {bal > 0 ? ` · owe ${bal}` : ''}
                        {pts > 0 ? ` · ${pts} pts` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              {selectedCustomer && (
                <p className="text-[10px] text-muted-foreground px-0.5">
                  Balance {formatCurrency(Number(selectedCustomer.balance || 0))}
                  {Number(selectedCustomer.creditLimit || 0) > 0
                    ? ` · Credit limit ${formatCurrency(Number(selectedCustomer.creditLimit))}`
                    : ''}
                  {` · ${Number(selectedCustomer.loyaltyPoints || 0)} loyalty pts`}
                </p>
              )}
              {customerId && Number(selectedCustomer?.loyaltyPoints || 0) > 0 && (
                <Input
                  type="number"
                  min={0}
                  max={Number(selectedCustomer?.loyaltyPoints || 0)}
                  placeholder={`Redeem points (max ${selectedCustomer?.loyaltyPoints || 0})`}
                  value={redeemPoints}
                  onChange={(e) => setRedeemPoints(e.target.value)}
                  className="h-8 text-xs"
                />
              )}
            </div>

            <div className="rounded-xl border border-border bg-background/50 p-2.5 space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={applyDiscount}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setApplyDiscount(on);
                    if (!on) {
                      setDiscountInput('');
                      setDiscount(0);
                    }
                  }}
                />
                <span className="font-medium">Apply discount</span>
                <span className="text-xs text-muted-foreground">(optional)</span>
              </label>
              {applyDiscount && (
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={`Discount (${displayCurrencyCode()})`}
                  value={discountInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDiscountInput(v);
                    // Typed in display currency → store discount in company base
                    const n = parseMoneyToBase(v);
                    setDiscount(n > 0 ? n : 0);
                  }}
                />
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'CASH' as const, icon: Banknote, label: 'Cash' },
                  { id: 'CARD' as const, icon: CreditCard, label: 'Card' },
                  { id: 'MOBILE_MONEY' as const, icon: CreditCard, label: 'Mobile' },
                ] as const
              ).map((m) => (
                <motion.button
                  key={m.id}
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setPayMethod(m.id)}
                  className={`rounded-xl border p-2 text-xs font-medium flex flex-col items-center gap-0.5 transition-colors ${
                    payMethod === m.id
                      ? 'border-primary bg-primary/10 text-primary shadow-sm'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <m.icon className="h-4 w-4" />
                  {m.label}
                </motion.button>
              ))}
            </div>

            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Payment currency</label>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm font-semibold"
                value={payCurrency}
                onChange={(e) => {
                  setPayCurrency(e.target.value);
                  setTendered('');
                }}
              >
                {(currencies.filter((c) => c.isActive !== false).length
                  ? currencies.filter((c) => c.isActive !== false)
                  : [{ code: payCurrency, name: payCurrency, symbol: payCurrency, exchangeRate: 1 }]
                ).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} {c.symbol ? `(${c.symbol})` : ''}
                    {c.isBase ? ' · base' : ''}
                  </option>
                ))}
              </select>
              {payCurrency !== baseCurrency && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Due: {formatCurrency(totals.total, { currency: payCurrency })} · base {baseCurrency}
                </p>
              )}
            </div>

            {payMethod === 'CASH' && (
              <div className="space-y-1">
                <Input
                  type="number"
                  placeholder={`Amount tendered (${payCurrency})`}
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                />
                {tendered && (
                  <p className="text-sm text-muted-foreground">
                    Change:{' '}
                    <span className="font-semibold text-foreground">
                      {formatCurrency(change, {
                        currency: payCurrency,
                        from: payCurrency,
                        raw: true,
                      })}
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sticky checkout footer — always visible without opening discount */}
        <div className="shrink-0 border-t border-border p-2 sm:p-3 space-y-1.5 bg-card shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)] pb-[max(0.5rem,env(safe-area-inset-bottom))] min-w-0">
          <div className="space-y-0.5 text-sm min-w-0">
            <div className="flex justify-between text-muted-foreground text-[11px] gap-2">
              <span className="shrink-0">Subtotal + tax</span>
              <span className="tabular-nums truncate">
                {formatCurrency(totals.subtotal + totals.tax)}
              </span>
            </div>
            {applyDiscount && discountAmount > 0 && (
              <div className="flex justify-between text-[11px] text-muted-foreground gap-2">
                <span>Discount</span>
                <span className="tabular-nums text-destructive">−{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm sm:text-base font-bold gap-2 min-w-0">
              <span className="shrink-0">Total</span>
              <span className="tabular-nums text-primary truncate">
                {formatCurrency(totals.total, { currency: payCurrency })}
              </span>
            </div>
          </div>

          <Button
            className="w-full h-11 sm:h-12 text-sm sm:text-base font-semibold shadow-lg shadow-primary/25"
            size="lg"
            loading={checkout.isPending}
            onClick={handleCheckout}
            disabled={!cart.length || checkout.isPending}
          >
            <span className="truncate">
              {online ? 'Charge' : 'Save offline'}{' '}
              {cart.length
                ? formatCurrency(totals.total, { currency: payCurrency })
                : ''}
            </span>
          </Button>
          <p className="text-[9px] sm:text-[10px] text-center text-muted-foreground leading-tight">
            Discount optional · F9 to charge
          </p>
        </div>
      </div>
    </div>
  );
}
