import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AppCurrency {
  id?: string;
  code: string;
  name: string;
  symbol: string;
  exchangeRate: number;
  isBase?: boolean;
  isActive?: boolean;
  lastSyncedAt?: string | null;
}

interface CurrencyState {
  /** Company accounting base (prices stored in this) */
  baseCurrency: string;
  /** UI display / payment tender currency — applies app-wide when changed */
  displayCurrency: string;
  /**
   * True once the user picks a currency in the top bar (or we applied a location default).
   * Prevents overwriting their choice on every page load.
   */
  displayCurrencyLocked: boolean;
  /** Detected local currency from device/IP (ISO code) */
  locationCurrency: string | null;
  rates: Record<string, number>; // base units per 1 unit of code
  currencies: AppCurrency[];
  lastSyncedAt: string | null;
  liveSource: string | null;
  setFromApi: (payload: {
    baseCurrency: string;
    currencies: AppCurrency[];
    liveSource?: string | null;
  }) => void;
  setDisplayCurrency: (code: string, opts?: { lock?: boolean }) => void;
  setBaseCurrency: (code: string) => void;
  setLocationCurrency: (code: string | null) => void;
  applyLocationDefault: (code: string, opts?: { lock?: boolean }) => void;
  /**
   * Convert amount from one currency to another using stored rates.
   * Defaults: from=base, to=display
   */
  convert: (amount: number, from?: string, to?: string) => number;
  /** Format amount stored in base currency into display currency */
  formatFromBase: (amount: number | string, opts?: { currency?: string; compact?: boolean }) => string;
  getSymbol: (code?: string) => string;
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value || 0);
  } catch {
    return `${currency || 'USD'} ${(value || 0).toFixed(2)}`;
  }
}

export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set, get) => ({
      baseCurrency: 'USD',
      displayCurrency: 'USD',
      displayCurrencyLocked: false,
      locationCurrency: null,
      rates: { USD: 1 },
      currencies: [{ code: 'USD', name: 'US Dollar', symbol: '$', exchangeRate: 1, isBase: true }],
      lastSyncedAt: null,
      liveSource: null,

      setFromApi: ({ baseCurrency, currencies, liveSource }) => {
        const base = (baseCurrency || 'USD').toUpperCase();
        const rates: Record<string, number> = { [base]: 1 };
        for (const c of currencies) {
          rates[c.code.toUpperCase()] = Number(c.exchangeRate) || 1;
        }
        rates[base] = 1;
        const { displayCurrency, displayCurrencyLocked, locationCurrency } = get();
        let nextDisplay = displayCurrency;
        if (displayCurrencyLocked) {
          const stillValid = currencies.some(
            (c) => c.code.toUpperCase() === displayCurrency.toUpperCase() && c.isActive !== false
          );
          if (!stillValid) nextDisplay = base;
        } else {
          // Prefer location currency if company has it enabled; else company base
          const loc = (locationCurrency || '').toUpperCase();
          const hasLoc = loc
            ? currencies.some((c) => c.code.toUpperCase() === loc && c.isActive !== false)
            : false;
          nextDisplay = hasLoc ? loc : base;
        }
        set({
          baseCurrency: base,
          rates,
          currencies,
          lastSyncedAt: new Date().toISOString(),
          liveSource: liveSource ?? get().liveSource,
          displayCurrency: nextDisplay,
        });
      },

      setDisplayCurrency: (code, opts) => {
        const c = code.toUpperCase();
        set({
          displayCurrency: c,
          displayCurrencyLocked: opts?.lock === false ? get().displayCurrencyLocked : true,
        });
      },

      setBaseCurrency: (code) => {
        const c = code.toUpperCase();
        set({ baseCurrency: c, displayCurrency: c, displayCurrencyLocked: true });
      },

      setLocationCurrency: (code) => {
        set({ locationCurrency: code ? code.toUpperCase() : null });
      },

      applyLocationDefault: (code, opts) => {
        const c = code.toUpperCase();
        if (!/^[A-Z]{3}$/.test(c)) return;
        const { displayCurrencyLocked } = get();
        if (displayCurrencyLocked) {
          // User already chose — only remember location, don't override
          set({ locationCurrency: c });
          return;
        }
        set({
          locationCurrency: c,
          displayCurrency: c,
          // Lock after IP refine so we don't thrash; device-only guess stays unlocked
          displayCurrencyLocked: opts?.lock === true,
        });
      },

      convert: (amount, from, to) => {
        const { baseCurrency, rates, displayCurrency } = get();
        const f = (from || baseCurrency).toUpperCase();
        const t = (to || displayCurrency).toUpperCase();
        if (!Number.isFinite(amount)) return 0;
        if (f === t) return amount;
        const fromRate = rates[f] ?? (f === baseCurrency ? 1 : undefined);
        const toRate = rates[t] ?? (t === baseCurrency ? 1 : undefined);
        if (!fromRate || !toRate) return amount; // fallback no conversion
        const inBase = amount * fromRate;
        return toRate === 0 ? 0 : inBase / toRate;
      },

      formatFromBase: (amount, opts) => {
        const num = typeof amount === 'string' ? parseFloat(amount) : amount;
        const { baseCurrency, displayCurrency, convert } = get();
        const target = (opts?.currency || displayCurrency || baseCurrency).toUpperCase();
        const converted = convert(num || 0, baseCurrency, target);
        return formatMoney(converted, target);
      },

      getSymbol: (code) => {
        const c = (code || get().displayCurrency).toUpperCase();
        return get().currencies.find((x) => x.code.toUpperCase() === c)?.symbol || c;
      },
    }),
    {
      name: 'eims-currency',
      partialize: (s) => ({
        baseCurrency: s.baseCurrency,
        displayCurrency: s.displayCurrency,
        displayCurrencyLocked: s.displayCurrencyLocked,
        locationCurrency: s.locationCurrency,
        rates: s.rates,
        currencies: s.currencies,
        lastSyncedAt: s.lastSyncedAt,
      }),
    }
  )
);
