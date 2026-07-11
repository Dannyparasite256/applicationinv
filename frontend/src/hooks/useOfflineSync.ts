import { useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { useNetworkStore } from '@/stores/networkStore';
import {
  refreshDashboardSnapshot,
  refreshOfflineCatalog,
  runSyncEngine,
} from '@/lib/offline/syncEngine';
import { countPendingSync as countPending } from '@/lib/offline/db';
import { notifyLocal } from '@/native/notifications';

export function useOfflineSync() {
  const setOnline = useNetworkStore((s) => s.setOnline);
  const setPendingCount = useNetworkStore((s) => s.setPendingCount);
  const online = useNetworkStore((s) => s.online);
  const syncing = useNetworkStore((s) => s.syncing);

  const refreshPending = useCallback(async () => {
    try {
      setPendingCount(await countPending());
    } catch {
      /* ignore */
    }
  }, [setPendingCount]);

  const syncNow = useCallback(async (silent = false) => {
    if (!navigator.onLine) {
      if (!silent) toast.error('You are offline');
      return { synced: 0, failed: 0 };
    }
    const result = await runSyncEngine();
    if (!silent && (result.synced || result.failed)) {
      if (result.failed) toast.message(`Synced ${result.synced}, ${result.failed} failed`);
      else if (result.synced) toast.success(`Synced ${result.synced} offline change(s)`);
    }
    await refreshPending();
    return result;
  }, [refreshPending]);

  useEffect(() => {
    let cancelled = false;

    const applyOnline = async (isOnline: boolean, type = 'unknown') => {
      if (cancelled) return;
      const wasOnline = useNetworkStore.getState().online;
      setOnline(isOnline, type);
      if (isOnline && !wasOnline) {
        toast.success('Back online — syncing…');
        await notifyLocal({
          title: 'Back online',
          body: 'Syncing offline sales and data…',
        });
        await syncNow(true);
        await refreshOfflineCatalog();
        await refreshDashboardSnapshot();
      } else if (!isOnline && wasOnline) {
        toast.message('You are offline — sales will be queued');
        await notifyLocal({
          title: 'Offline mode',
          body: 'POS sales are saved on this device until you reconnect.',
        });
      }
    };

    const onBrowserOnline = () => void applyOnline(true, 'browser');
    const onBrowserOffline = () => void applyOnline(false, 'browser');
    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);

    // Capacitor network plugin
    let networkHandle: { remove: () => void } | undefined;
    (async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const { Network } = await import('@capacitor/network');
          const status = await Network.getStatus();
          setOnline(status.connected, status.connectionType);
          networkHandle = await Network.addListener('networkStatusChange', (status) => {
            void applyOnline(status.connected, status.connectionType);
          });
        } catch {
          setOnline(navigator.onLine);
        }
      } else {
        setOnline(navigator.onLine);
      }

      await refreshPending();
      if (navigator.onLine) {
        await refreshOfflineCatalog();
        await refreshDashboardSnapshot();
        await syncNow(true);
      }
    })();

    // Periodic catalog refresh + sync while online
    const interval = window.setInterval(() => {
      if (navigator.onLine) {
        void refreshOfflineCatalog();
        void syncNow(true);
      }
      void refreshPending();
    }, 60_000);

    return () => {
      cancelled = true;
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
      networkHandle?.remove();
      window.clearInterval(interval);
    };
  }, [setOnline, syncNow, refreshPending]);

  return { online, syncing, syncNow, refreshPending };
}
