import { motion, AnimatePresence } from 'framer-motion';
import { CloudOff, RefreshCw, Wifi, CloudUpload } from 'lucide-react';
import { toast } from 'sonner';
import { useNetworkStore } from '@/stores/networkStore';
import { runSyncEngine } from '@/lib/offline/syncEngine';
import { Button } from '@/components/ui/Button';

export function OfflineBanner() {
  const online = useNetworkStore((s) => s.online);
  const syncing = useNetworkStore((s) => s.syncing);
  const pendingCount = useNetworkStore((s) => s.pendingCount);
  const lastSyncMessage = useNetworkStore((s) => s.lastSyncMessage);

  const showOffline = !online;
  const showPending = online && pendingCount > 0;

  const onSync = async () => {
    if (!navigator.onLine) {
      toast.error('You are offline');
      return;
    }
    const result = await runSyncEngine();
    if (result.synced) toast.success(`Synced ${result.synced} offline change(s)`);
    else if (result.failed) toast.message(`${result.failed} item(s) failed to sync`);
    else toast.message('Nothing pending to sync');
  };

  return (
    <AnimatePresence>
      {(showOffline || showPending) && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="overflow-hidden"
        >
          <div
            className={`flex flex-wrap items-center justify-between gap-1.5 px-2.5 sm:px-4 py-1.5 text-xs sm:text-sm min-w-0 ${
              showOffline
                ? 'bg-amber-500/15 text-amber-900 dark:text-amber-100 border-b border-amber-500/30'
                : 'bg-sky-500/10 text-sky-900 dark:text-sky-100 border-b border-sky-500/25'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {showOffline ? (
                <CloudOff className="h-3.5 w-3.5 shrink-0 animate-pulse" />
              ) : syncing ? (
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <CloudUpload className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">
                {showOffline
                  ? `Offline${pendingCount ? ` · ${pendingCount} queued` : ''}`
                  : syncing
                    ? 'Syncing…'
                    : `${pendingCount} waiting to sync${lastSyncMessage ? ` · ${lastSyncMessage}` : ''}`}
              </span>
            </div>
            {online && pendingCount > 0 && (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                loading={syncing}
                onClick={() => void onSync()}
              >
                <Wifi className="h-3.5 w-3.5" /> Sync now
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
