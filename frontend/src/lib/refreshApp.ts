import type { QueryClient } from '@tanstack/react-query';

/**
 * Query roots that show money / company state and should refresh after
 * currency, profile, product, or other app-wide changes.
 */
export const APP_DATA_QUERY_ROOTS = [
  'dashboard',
  'products',
  'products-mini',
  'pos-products',
  'inventory',
  'stock-levels',
  'low-stock',
  'sales',
  'customers',
  'suppliers',
  'purchases',
  'invoices',
  'invoices-summary',
  'invoice-detail',
  'company',
  'currencies',
  'users',
  'staff-pending',
  'staff-pending-count',
  'staff-all',
  'staff-access',
  'notifications',
  'reports',
  'accounting',
  'branches',
] as const;

/**
 * Immediately mark queries stale and refetch anything currently mounted.
 * Use after settings changes (currency, profile) and major mutations so
 * the open page updates without a manual browser refresh.
 */
export async function refreshAppData(
  qc: QueryClient,
  roots: readonly string[] = APP_DATA_QUERY_ROOTS
): Promise<void> {
  await Promise.all(
    roots.map((key) =>
      qc.invalidateQueries({
        queryKey: [key],
        refetchType: 'active',
      })
    )
  );
}

/** Refresh only currency-sensitive screens (display / rates change). */
export async function refreshMoneyViews(qc: QueryClient): Promise<void> {
  await refreshAppData(qc, [
    'dashboard',
    'products',
    'products-mini',
    'pos-products',
    'inventory',
    'stock-levels',
    'sales',
    'purchases',
    'invoices',
    'invoices-summary',
    'invoice-detail',
    'currencies',
    'reports',
  ]);
}
