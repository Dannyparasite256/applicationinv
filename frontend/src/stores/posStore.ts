import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartItem {
  productId: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unitPrice: number;
  quantity: number;
  discount: number;
  taxRate: number;
  trackInventory: boolean;
  stockQty?: number;
}

interface PosState {
  cart: CartItem[];
  customerId: string | null;
  discountAmount: number;
  notes: string;
  /** UI-only list of offline sale markers (IndexedDB is source of truth for sync) */
  offlineQueue: Array<{ offlineId: string; payload: unknown; createdAt: string }>;
  addItem: (item: Omit<CartItem, 'quantity' | 'discount'> & { quantity?: number }) => void;
  updateQty: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  setDiscount: (amount: number) => void;
  setCustomerId: (id: string | null) => void;
  setNotes: (notes: string) => void;
  clearCart: () => void;
  cartTotal: () => { subtotal: number; tax: number; total: number };
  /** Track offline sale for UI badge only — does not own the sync queue */
  trackOfflineSale: (offlineId: string, payload: unknown) => void;
  /** @deprecated use trackOfflineSale — kept for older call sites */
  queueOfflineSale: (payload: unknown) => void;
  removeOfflineSale: (offlineId: string) => void;
  clearOfflineQueue: () => void;
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      cart: [],
      customerId: null,
      discountAmount: 0,
      notes: '',
      offlineQueue: [],
      addItem: (item) => {
        const cart = [...get().cart];
        const idx = cart.findIndex((c) => c.productId === item.productId);
        const addQty = item.quantity || 1;
        if (idx >= 0) {
          let next = cart[idx].quantity + addQty;
          if (cart[idx].trackInventory && cart[idx].stockQty != null) {
            next = Math.min(next, Math.max(0, cart[idx].stockQty!));
          }
          cart[idx] = { ...cart[idx], quantity: next };
        } else {
          let qty = addQty;
          if (item.trackInventory && item.stockQty != null) {
            qty = Math.min(qty, Math.max(0, item.stockQty));
          }
          if (qty <= 0) return;
          cart.push({
            productId: item.productId,
            name: item.name,
            sku: item.sku,
            barcode: item.barcode,
            unitPrice: item.unitPrice,
            quantity: qty,
            discount: 0,
            taxRate: item.taxRate || 0,
            trackInventory: item.trackInventory,
            stockQty: item.stockQty,
          });
        }
        set({ cart });
      },
      updateQty: (productId, quantity) => {
        if (quantity <= 0) {
          set({ cart: get().cart.filter((c) => c.productId !== productId) });
          return;
        }
        set({
          cart: get().cart.map((c) => {
            if (c.productId !== productId) return c;
            let qty = quantity;
            if (c.trackInventory && c.stockQty != null) {
              qty = Math.min(qty, Math.max(0, c.stockQty));
            }
            return { ...c, quantity: qty };
          }),
        });
      },
      removeItem: (productId) => set({ cart: get().cart.filter((c) => c.productId !== productId) }),
      setDiscount: (discountAmount) => set({ discountAmount }),
      setCustomerId: (customerId) => set({ customerId }),
      setNotes: (notes) => set({ notes }),
      clearCart: () => set({ cart: [], discountAmount: 0, notes: '', customerId: null }),
      cartTotal: () => {
        const { cart, discountAmount } = get();
        let subtotal = 0;
        let tax = 0;
        for (const item of cart) {
          const line = item.unitPrice * item.quantity - item.discount;
          subtotal += line;
          tax += (line * item.taxRate) / 100;
        }
        return {
          subtotal,
          tax,
          total: Math.max(0, subtotal + tax - discountAmount),
        };
      },
      trackOfflineSale: (offlineId, payload) => {
        const exists = get().offlineQueue.some((q) => q.offlineId === offlineId);
        if (exists) return;
        set({
          offlineQueue: [
            ...get().offlineQueue,
            { offlineId, payload, createdAt: new Date().toISOString() },
          ],
        });
      },
      queueOfflineSale: (payload) => {
        // Backward-compatible: generate id if missing
        const base = payload && typeof payload === 'object' ? { ...(payload as object) } : {};
        const offlineId =
          typeof (base as { offlineId?: string }).offlineId === 'string'
            ? (base as { offlineId: string }).offlineId
            : `off-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        get().trackOfflineSale(offlineId, { ...base, offlineId, isOffline: true });
      },
      removeOfflineSale: (offlineId) =>
        set({ offlineQueue: get().offlineQueue.filter((q) => q.offlineId !== offlineId) }),
      clearOfflineQueue: () => set({ offlineQueue: [] }),
    }),
    {
      name: 'eims-pos',
      partialize: (s) => ({
        // Don't persist cart across sessions (avoids stale stock qty)
        // Keep offlineQueue markers for migration only
        offlineQueue: s.offlineQueue,
      }),
    }
  )
);
