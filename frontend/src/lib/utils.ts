import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useCurrencyStore } from '@/stores/currencyStore';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Round money to 4 dp for storage / API (avoids float noise) */
export function roundMoney(n: number, places = 4): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * Company **base** amount → user's **display** currency amount.
 * Use when loading stored prices into edit fields.
 */
export function toDisplayMoney(baseAmount: number | string): number {
  const num = typeof baseAmount === 'string' ? parseFloat(baseAmount) : baseAmount;
  if (!Number.isFinite(num)) return 0;
  const store = useCurrencyStore.getState();
  return roundMoney(store.convert(num, store.baseCurrency, store.displayCurrency), 4);
}

/**
 * User's **display** currency amount → company **base** for API save.
 * Use when submitting product/invoice/POS edit forms.
 */
export function toBaseMoney(displayAmount: number | string): number {
  const num = typeof displayAmount === 'string' ? parseFloat(displayAmount) : displayAmount;
  if (!Number.isFinite(num)) return 0;
  const store = useCurrencyStore.getState();
  return roundMoney(store.convert(num, store.displayCurrency, store.baseCurrency), 4);
}

/**
 * Format a base-currency amount as a clean string for controlled number inputs
 * (in the user's current display currency).
 */
export function moneyInputFromBase(baseAmount: number | string): string {
  const n = toDisplayMoney(baseAmount);
  if (n === 0) return '';
  // Trim trailing zeros for nicer editing
  return String(Number(n.toFixed(4)));
}

/**
 * Parse an input field (display currency) → base amount for the API.
 */
export function parseMoneyToBase(input: string | number): number {
  if (typeof input === 'number') return toBaseMoney(input);
  const cleaned = String(input).replace(/,/g, '').trim();
  if (!cleaned) return 0;
  return toBaseMoney(cleaned);
}

/** Current display currency code (e.g. UGX) for labels next to price fields */
export function displayCurrencyCode(): string {
  const s = useCurrencyStore.getState();
  return (s.displayCurrency || s.baseCurrency || 'USD').toUpperCase();
}

/**
 * Format a money value for display.
 * Values are assumed to be in company **base** currency unless `options.from` is set.
 * Converts into the app-wide display currency (or `options.currency` override).
 */
export function formatCurrency(
  value: number | string,
  currencyOrOptions?:
    | string
    | {
        /** Force output currency (default: app display currency) */
        currency?: string;
        /** Source currency of the value (default: company base) */
        from?: string;
        /** Skip conversion — format the number as-is in given currency */
        raw?: boolean;
      }
) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  const store = useCurrencyStore.getState();
  let currency = store.displayCurrency || store.baseCurrency || 'USD';
  let from = store.baseCurrency || 'USD';
  let raw = false;

  if (typeof currencyOrOptions === 'string') {
    // Back-compat: second arg was currency code for output
    currency = currencyOrOptions || currency;
  } else if (currencyOrOptions) {
    if (currencyOrOptions.currency) currency = currencyOrOptions.currency;
    if (currencyOrOptions.from) from = currencyOrOptions.from;
    if (currencyOrOptions.raw) raw = true;
  }

  const amount = raw ? num || 0 : store.convert(num || 0, from, currency);

  // UGX and similar have no minor units in everyday use — avoid always forcing .00
  const noCents = new Set(['UGX', 'JPY', 'KRW', 'VND', 'RWF', 'XOF', 'XAF', 'CLP']);
  const fraction = noCents.has((currency || '').toUpperCase()) ? 0 : 2;

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: fraction,
      maximumFractionDigits: fraction,
    }).format(amount);
  } catch {
    return `${currency || 'USD'} ${amount.toFixed(fraction)}`;
  }
}

export function formatNumber(value: number | string) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat().format(num || 0);
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function getInitials(first?: string | null, last?: string | null) {
  return `${first?.[0] || ''}${last?.[0] || ''}`.toUpperCase() || '?';
}
