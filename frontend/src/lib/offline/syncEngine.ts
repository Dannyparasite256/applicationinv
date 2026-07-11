import { api } from '@/lib/api';
import {
  cacheCustomers,
  cacheProducts,
  countPendingSync,
  enqueueSync,
  listPendingSync,
  removeSyncItem,
  saveSnapshot,
  updateSyncItem,
  type SyncQueueItem,
} from '@/lib/offline/db';
import { useNetworkStore } from '@/stores/networkStore';
import { usePosStore } from '@/stores/posStore';
import { notifyLocal } from '@/native/notifications';

let syncInFlight: Promise<{ synced: number; failed: number }> | null = null;

function newOfflineId() {
  return `off-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function bodyOfflineId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const id = (body as { offlineId?: unknown }).offlineId;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

/** Pull catalog + customers into IndexedDB for offline POS */
export async function refreshOfflineCatalog(): Promise<void> {
  if (!navigator.onLine) return;
  try {
    const [productsRes, customersRes] = await Promise.all([
      api.get('/products', { params: { limit: 500, isActive: true } }),
      api.get('/customers', { params: { limit: 200 } }),
    ]);
    const products = productsRes.data.data || [];
    const customers = customersRes.data.data || [];
    await cacheProducts(products);
    await cacheCustomers(customers);
    useNetworkStore.getState().setPendingCount(await countPendingSync());
  } catch {
    /* keep existing cache */
  }
}

/** Cache dashboard snapshot for offline read */
export async function refreshDashboardSnapshot(): Promise<void> {
  if (!navigator.onLine) return;
  try {
    const res = await api.get('/dashboard');
    await saveSnapshot('dashboard', res.data.data);
  } catch {
    /* ignore */
  }
}

/**
 * Queue a sale for offline sync.
 * Always assigns a stable offlineId once so retries are idempotent.
 */
export async function queueOfflineSale(payload: unknown) {
  const base = payload && typeof payload === 'object' ? { ...(payload as object) } : {};
  const existingId = bodyOfflineId(base);
  const offlineId = existingId || newOfflineId();
  const body = { ...base, offlineId, isOffline: true };

  const item = await enqueueSync({
    type: 'sale',
    endpoint: '/sales',
    method: 'POST',
    body,
  });

  // UI count only — do NOT re-enqueue into IndexedDB later
  usePosStore.getState().trackOfflineSale(offlineId, body);
  useNetworkStore.getState().setPendingCount(await countPendingSync());
  await notifyLocal({
    title: 'Sale saved offline',
    body: 'Will sync automatically when you are back online.',
    id: Date.now() % 100000,
  });
  return item;
}

async function processItem(item: SyncQueueItem): Promise<boolean> {
  try {
    await updateSyncItem({ ...item, status: 'syncing' });
    await api.request({
      url: item.endpoint,
      method: item.method,
      data: item.body,
    });
    await removeSyncItem(item.id);
    const oid = bodyOfflineId(item.body);
    if (oid) usePosStore.getState().removeOfflineSale(oid);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Sync failed';
    await updateSyncItem({
      ...item,
      status: 'failed',
      retries: item.retries + 1,
      lastError: message,
    });
    return false;
  }
}

/** Flush pending queue. Safe to call frequently — de-duped. */
export async function runSyncEngine(): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) {
    return { synced: 0, failed: 0 };
  }
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const store = useNetworkStore.getState();
    store.setSyncing(true);
    let synced = 0;
    let failed = 0;

    try {
      // One-time migration: older builds double-queued via posStore → IndexedDB
      const posQ = usePosStore.getState().offlineQueue;
      if (posQ.length) {
        const pending = await listPendingSync();
        const existingIds = new Set(
          pending.map((p) => bodyOfflineId(p.body)).filter(Boolean) as string[]
        );
        for (const q of posQ) {
          const payload =
            q.payload && typeof q.payload === 'object'
              ? { ...(q.payload as object) }
              : {};
          const offlineId =
            bodyOfflineId(payload) ||
            (typeof q.offlineId === 'string' ? q.offlineId : undefined) ||
            newOfflineId();
          if (existingIds.has(offlineId)) continue;
          const body = { ...payload, offlineId, isOffline: true };
          await enqueueSync({
            type: 'sale',
            endpoint: '/sales',
            method: 'POST',
            body,
          });
          existingIds.add(offlineId);
        }
        usePosStore.getState().clearOfflineQueue();
      }

      const pending = await listPendingSync();
      const sales = pending.filter((p) => p.type === 'sale');
      const others = pending.filter((p) => p.type !== 'sale');

      if (sales.length) {
        try {
          const res = await api.post('/sales/sync-offline', {
            sales: sales.map((s) => s.body),
          });
          const results = (res.data.data || []) as Array<{
            success?: boolean;
            offlineId?: string | null;
            saleId?: string;
          }>;

          // Map results back to queue items by offlineId (preferred) or index
          const byOfflineId = new Map<string, { success: boolean }>();
          for (const r of results) {
            if (r.offlineId) byOfflineId.set(r.offlineId, { success: !!r.success });
          }

          for (let i = 0; i < sales.length; i++) {
            const item = sales[i];
            const oid = bodyOfflineId(item.body);
            let ok = false;
            if (oid && byOfflineId.has(oid)) {
              ok = byOfflineId.get(oid)!.success;
            } else if (results[i]) {
              ok = !!results[i].success;
            }

            if (ok) {
              await removeSyncItem(item.id);
              if (oid) usePosStore.getState().removeOfflineSale(oid);
              synced += 1;
            } else {
              await updateSyncItem({
                ...item,
                status: 'failed',
                retries: item.retries + 1,
                lastError: 'Offline sale sync failed — will retry',
              });
              failed += 1;
            }
          }
        } catch {
          // Bulk endpoint failed — try each sale individually so partial progress is kept
          for (const s of sales) {
            const good = await processItem(s);
            if (good) synced += 1;
            else failed += 1;
          }
        }
      }

      for (const item of others) {
        const good = await processItem(item);
        if (good) synced += 1;
        else failed += 1;
      }

      await refreshOfflineCatalog();
      const pendingLeft = await countPendingSync();
      useNetworkStore.getState().setPendingCount(pendingLeft);

      if (synced > 0) {
        const msg = `Synced ${synced} change${synced === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`;
        useNetworkStore.getState().setLastSync(msg);
        await notifyLocal({
          title: 'Offline data synced',
          body: msg,
          id: Date.now() % 100000,
        });
      }
    } finally {
      useNetworkStore.getState().setSyncing(false);
      syncInFlight = null;
    }

    return { synced, failed };
  })();

  return syncInFlight;
}
