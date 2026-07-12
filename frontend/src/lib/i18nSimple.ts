import { usePreferencesStore } from '@/stores/preferencesStore';

/** Short / large labels for cashier mode */
const SIMPLE: Record<string, string> = {
  Dashboard: 'Home',
  POS: 'Sell',
  Products: 'Items',
  Inventory: 'Stock',
  Sales: 'Sales',
  Purchases: 'Buy',
  Customers: 'People',
  Suppliers: 'Suppliers',
  Invoices: 'Bills',
  Reports: 'Reports',
  Settings: 'Setup',
  'Charge sale': 'Pay',
  'New sale': 'Again',
  Search: 'Find',
  Favorites: '★ Saved',
  Recent: 'Recent',
  Clear: 'Clear',
  Sync: 'Sync',
  Offline: 'No net',
};

export function tLabel(label: string): string {
  const mode = usePreferencesStore.getState().labelMode;
  if (mode !== 'simple') return label;
  return SIMPLE[label] || label;
}

export function useLabel(label: string): string {
  const mode = usePreferencesStore((s) => s.labelMode);
  if (mode !== 'simple') return label;
  return SIMPLE[label] || label;
}
