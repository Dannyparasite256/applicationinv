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
   * True only when the user picks a currency in the top bar.
   * Location detection must not override a deliberate manual choice.
   */
  displayCurrencyLocked: boolean;
  /** Who last set display currency */
  displayCurrencySource: 'user' | 'location' | 'base' | 'unknown';
  /** Detected local currency from device/GPS/IP (ISO code) */
  locationCurrency: string | null;
  rates: Record<string, number>; // base units per 1 unit of code
  currencies: AppCurrency[];
  lastSyncedAt: string | null;
  liveSource: string | null;
  /**
   * Bumps whenever display/base/rates change so the app shell can remount
   * pages and every formatCurrency() call re-runs immediately.
   */
  uiRevision: number;
  setFromApi: (payload: {
    baseCurrency: string;
    currencies: AppCurrency[];
    liveSource?: string | null;
  }) => void;
  setDisplayCurrency: (code: string, opts?: { lock?: boolean }) => void;
  setBaseCurrency: (code: string) => void;
  setLocationCurrency: (code: string | null) => void;
  /**
   * Apply location-detected currency to the UI.
   * `force: true` overrides a previous manual lock (e.g. “Use my location”).
   */
  applyLocationDefault: (code: string, opts?: { lock?: boolean; force?: boolean }) => void;
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
      displayCurrencySource: 'unknown',
      locationCurrency: null,
      rates: { USD: 1 },
      currencies: [{ code: 'USD', name: 'US Dollar', symbol: '$', exchangeRate: 1, isBase: true }],
      lastSyncedAt: null,
      liveSource: null,
      uiRevision: 0,

      setFromApi: ({ baseCurrency, currencies, liveSource }) => {
        const base = (baseCurrency || 'USD').toUpperCase();
        const rates: Record<string, number> = { [base]: 1 };
        for (const c of currencies) {
          rates[c.code.toUpperCase()] = Number(c.exchangeRate) || 1;
        }
        rates[base] = 1;
        const prev = get();
        const {
          displayCurrency,
          displayCurrencyLocked,
          displayCurrencySource,
          locationCurrency,
          uiRevision,
        } = prev;
        let nextDisplay = displayCurrency;
        let nextSource = displayCurrencySource;

        if (displayCurrencyLocked && displayCurrencySource === 'user') {
          // Keep user's top-bar choice if still available; else fall back to base
          const stillValid = currencies.some(
            (c) => c.code.toUpperCase() === displayCurrency.toUpperCase() && c.isActive !== false
          );
          if (!stillValid) {
            nextDisplay = base;
            nextSource = 'base';
          }
        } else {
          // Prefer detected location currency (even before rate is in the list —
          // ensureCurrencyEnabled will add the rate shortly).
          const loc = (locationCurrency || '').toUpperCase();
          if (loc && /^[A-Z]{3}$/.test(loc)) {
            nextDisplay = loc;
            nextSource = 'location';
          } else if (!displayCurrency || displayCurrencySource === 'unknown') {
            nextDisplay = base;
            nextSource = 'base';
          }
        }

        // Avoid remount thrash when bootstrap / page sync re-applies the same rates
        const ratesUnchanged =
          Object.keys(rates).length === Object.keys(prev.rates).length &&
          Object.keys(rates).every((k) => prev.rates[k] === rates[k]);
        const listUnchanged =
          prev.currencies.length === currencies.length &&
          currencies.every((c, i) => {
            const p = prev.currencies[i];
            return (
              p &&
              p.code === c.code &&
              Number(p.exchangeRate) === Number(c.exchangeRate) &&
              p.isBase === c.isBase &&
              p.isActive === c.isActive
            );
          });
        const noVisualChange =
          prev.baseCurrency === base &&
          prev.displayCurrency === nextDisplay &&
          ratesUnchanged &&
          listUnchanged;

        set({
          baseCurrency: base,
          rates,
          currencies,
          lastSyncedAt: new Date().toISOString(),
          liveSource: liveSource ?? prev.liveSource,
          displayCurrency: nextDisplay,
          displayCurrencySource: nextSource,
          // Location-sourced display must stay unlocked so later GPS can refine
          displayCurrencyLocked:
            nextSource === 'user' ? displayCurrencyLocked : false,
          uiRevision: noVisualChange ? uiRevision : uiRevision + 1,
        });
      },

      setDisplayCurrency: (code, opts) => {
        const c = code.toUpperCase();
        const shouldLock = opts?.lock !== false;
        const prev = get().displayCurrency;
        if (prev === c) {
          if (shouldLock && !get().displayCurrencyLocked) {
            set({
              displayCurrencyLocked: true,
              displayCurrencySource: 'user',
            });
          }
          return;
        }
        set({
          displayCurrency: c,
          displayCurrencyLocked: shouldLock,
          displayCurrencySource: shouldLock ? 'user' : get().displayCurrencySource,
          uiRevision: get().uiRevision + 1,
        });
      },

      setBaseCurrency: (code) => {
        const c = code.toUpperCase();
        set({
          baseCurrency: c,
          displayCurrency: c,
          displayCurrencyLocked: true,
          displayCurrencySource: 'user',
          uiRevision: get().uiRevision + 1,
        });
      },

      setLocationCurrency: (code) => {
        set({ locationCurrency: code ? code.toUpperCase() : null });
      },

      applyLocationDefault: (code, opts) => {
        const c = code.toUpperCase();
        if (!/^[A-Z]{3}$/.test(c)) return;
        const { displayCurrencyLocked, displayCurrencySource, displayCurrency, uiRevision } =
          get();
        const force = opts?.force === true;

        // Only a deliberate top-bar pick blocks auto location (unless force)
        if (!force && displayCurrencyLocked && displayCurrencySource === 'user') {
          set({ locationCurrency: c });
          return;
        }

        if (displayCurrency === c) {
          set({
            locationCurrency: c,
            displayCurrencySource: 'location',
            displayCurrencyLocked: false,
          });
          return;
        }

        set({
          locationCurrency: c,
          displayCurrency: c,
          displayCurrencySource: 'location',
          // Location should never sticky-lock against future GPS refinements
          displayCurrencyLocked: false,
          uiRevision: uiRevision + 1,
        });
      },

      convert: (amount, from, to) => {
        const { baseCurrency, rates, displayCurrency } = get();
        const base = (baseCurrency || 'USD').toUpperCase();
        const f = (from || base).toUpperCase();
        const t = (to || displayCurrency || base).toUpperCase();
        if (!Number.isFinite(amount)) return 0;
        if (f === t) return amount;
        // rates[code] = units of base per 1 unit of code
        const fromRate = f === base ? 1 : rates[f];
        const toRate = t === base ? 1 : rates[t];
        if (fromRate == null || fromRate <= 0 || toRate == null || toRate <= 0) {
          // Missing live rate — avoid silently treating foreign currency as 1:1
          return amount;
        }
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
        displayCurrencySource: s.displayCurrencySource,
        locationCurrency: s.locationCurrency,
        rates: s.rates,
        currencies: s.currencies,
        lastSyncedAt: s.lastSyncedAt,
      }),
      // Migrate older persisted state that locked currency after IP detect
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<CurrencyState>;
        const merged = { ...current, ...p };
        // If locked but source missing/unknown, treat as not a hard user lock
        // so GPS can update (fixes "allowed location but currency stuck")
        if (
          merged.displayCurrencyLocked &&
          (!merged.displayCurrencySource || merged.displayCurrencySource === 'unknown')
        ) {
          merged.displayCurrencyLocked = false;
          merged.displayCurrencySource = 'unknown';
        }
        return merged;
      },
    }
  )
);
