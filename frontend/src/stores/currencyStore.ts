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
  rates: Record<string, number>; // base units per 1 unit of code
  currencies: AppCurrency[];
  lastSyncedAt: string | null;
  liveSource: string | null;
  setFromApi: (payload: {
    baseCurrency: string;
    currencies: AppCurrency[];
    liveSource?: string | null;
  }) => void;
  setDisplayCurrency: (code: string) => void;
  setBaseCurrency: (code: string) => void;
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
        const display = get().displayCurrency;
        const stillValid = currencies.some((c) => c.code.toUpperCase() === display.toUpperCase() && c.isActive !== false);
        set({
          baseCurrency: base,
          rates,
          currencies,
          lastSyncedAt: new Date().toISOString(),
          liveSource: liveSource ?? get().liveSource,
          displayCurrency: stillValid ? display : base,
        });
      },

      setDisplayCurrency: (code) => {
        const c = code.toUpperCase();
        set({ displayCurrency: c });
      },

      setBaseCurrency: (code) => {
        const c = code.toUpperCase();
        set({ baseCurrency: c, displayCurrency: c });
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
        rates: s.rates,
        currencies: s.currencies,
        lastSyncedAt: s.lastSyncedAt,
      }),
    }
  )
);
