import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface CachedProduct {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  sellingPrice: string | number;
  trackInventory: boolean;
  stockQty?: number;
  /** Durable data URL or path — same photo on all devices */
  imageUrl?: string | null;
  tax?: { rate: string | number } | null;
  isActive?: boolean;
}

export interface CachedCustomer {
  id: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  code: string;
  email?: string | null;
  phone?: string | null;
}

export type SyncOpType = 'sale' | 'invoice_payment' | 'generic';

export interface SyncQueueItem {
  id: string;
  type: SyncOpType;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body: unknown;
  createdAt: string;
  retries: number;
  lastError?: string;
  status: 'pending' | 'syncing' | 'failed' | 'done';
}

export interface OfflineMeta {
  key: string;
  value: unknown;
  updatedAt: string;
}

interface EimsDB extends DBSchema {
  products: {
    key: string;
    value: CachedProduct;
    indexes: { 'by-barcode': string; 'by-sku': string };
  };
  customers: {
    key: string;
    value: CachedCustomer;
  };
  syncQueue: {
    key: string;
    value: SyncQueueItem;
    indexes: { 'by-status': string; 'by-created': string };
  };
  meta: {
    key: string;
    value: OfflineMeta;
  };
  snapshots: {
    key: string;
    value: { key: string; data: unknown; updatedAt: string };
  };
}

const DB_NAME = 'eims-offline';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<EimsDB>> | null = null;

export function getOfflineDb() {
  if (!dbPromise) {
    dbPromise = openDB<EimsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('products')) {
          const products = db.createObjectStore('products', { keyPath: 'id' });
          products.createIndex('by-barcode', 'barcode');
          products.createIndex('by-sku', 'sku');
        }
        if (!db.objectStoreNames.contains('customers')) {
          db.createObjectStore('customers', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          const q = db.createObjectStore('syncQueue', { keyPath: 'id' });
          q.createIndex('by-status', 'status');
          q.createIndex('by-created', 'createdAt');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function cacheProducts(products: CachedProduct[]) {
  const db = await getOfflineDb();
  const tx = db.transaction('products', 'readwrite');
  await Promise.all(products.map((p) => tx.store.put(p)));
  await tx.done;
  await setMeta('productsCachedAt', new Date().toISOString());
  await setMeta('productsCount', products.length);
}

export async function getCachedProducts(search?: string): Promise<CachedProduct[]> {
  const db = await getOfflineDb();
  const all = await db.getAll('products');
  if (!search?.trim()) return all.slice(0, 48);
  const q = search.trim().toLowerCase();
  return all
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q)
    )
    .slice(0, 48);
}

export async function getCachedProductByBarcode(code: string): Promise<CachedProduct | undefined> {
  const db = await getOfflineDb();
  const all = await db.getAllFromIndex('products', 'by-barcode', code);
  if (all[0]) return all[0];
  const products = await db.getAll('products');
  return products.find(
    (p) => p.barcode === code || p.sku === code || p.id === code
  );
}

export async function cacheCustomers(customers: CachedCustomer[]) {
  const db = await getOfflineDb();
  const tx = db.transaction('customers', 'readwrite');
  await Promise.all(customers.map((c) => tx.store.put(c)));
  await tx.done;
  await setMeta('customersCachedAt', new Date().toISOString());
}

export async function getCachedCustomers(): Promise<CachedCustomer[]> {
  const db = await getOfflineDb();
  return db.getAll('customers');
}

export async function enqueueSync(item: Omit<SyncQueueItem, 'id' | 'createdAt' | 'retries' | 'status'>) {
  const db = await getOfflineDb();
  const record: SyncQueueItem = {
    ...item,
    id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
    retries: 0,
    status: 'pending',
  };
  await db.put('syncQueue', record);
  return record;
}

export async function listPendingSync(): Promise<SyncQueueItem[]> {
  const db = await getOfflineDb();
  const all = await db.getAll('syncQueue');
  return all
    .filter((i) => i.status === 'pending' || i.status === 'failed')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function updateSyncItem(item: SyncQueueItem) {
  const db = await getOfflineDb();
  await db.put('syncQueue', item);
}

export async function removeSyncItem(id: string) {
  const db = await getOfflineDb();
  await db.delete('syncQueue', id);
}

export async function countPendingSync(): Promise<number> {
  const items = await listPendingSync();
  return items.length;
}

export async function setMeta(key: string, value: unknown) {
  const db = await getOfflineDb();
  await db.put('meta', { key, value, updatedAt: new Date().toISOString() });
}

export async function getMeta<T = unknown>(key: string): Promise<T | null> {
  const db = await getOfflineDb();
  const row = await db.get('meta', key);
  return (row?.value as T) ?? null;
}

export async function saveSnapshot(key: string, data: unknown) {
  const db = await getOfflineDb();
  await db.put('snapshots', { key, data, updatedAt: new Date().toISOString() });
}

export async function loadSnapshot<T = unknown>(key: string): Promise<T | null> {
  const db = await getOfflineDb();
  const row = await db.get('snapshots', key);
  return (row?.data as T) ?? null;
}
