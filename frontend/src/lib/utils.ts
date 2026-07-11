import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useCurrencyStore } from '@/stores/currencyStore';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || 'USD'} ${amount.toFixed(2)}`;
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
