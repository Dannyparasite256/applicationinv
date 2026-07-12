import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CloudOff, RefreshCw, Wifi, CloudUpload, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useNetworkStore } from '@/stores/networkStore';
import { runSyncEngine } from '@/lib/offline/syncEngine';
import { Button } from '@/components/ui/Button';

export function OfflineBanner() {
  const online = useNetworkStore((s) => s.online);
  const syncing = useNetworkStore((s) => s.syncing);
  const pendingCount = useNetworkStore((s) => s.pendingCount);
  const lastSyncMessage = useNetworkStore((s) => s.lastSyncMessage);
  const lastSyncAt = useNetworkStore((s) => s.lastSyncAt);
  const [open, setOpen] = useState(false);

  const showOffline = !online;
  const showPending = online && pendingCount > 0;
  if (!showOffline && !showPending) return null;

  const onSync = async () => {
    if (!navigator.onLine) {
      toast.error('You are offline — sales stay on this device until you reconnect.');
      return;
    }
    const result = await runSyncEngine();
    if (result.synced) toast.success(`Synced ${result.synced} offline change(s)`);
    else if (result.failed) toast.message(`${result.failed} item(s) failed — we’ll retry`);
    else toast.message('Nothing pending to sync');
  };

  const lastSyncLabel = lastSyncAt
    ? `Last sync ${new Date(lastSyncAt).toLocaleTimeString()}`
    : 'Not synced yet this session';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="overflow-hidden"
      >
        <div
          className={`px-2.5 sm:px-4 py-1.5 text-xs sm:text-sm min-w-0 border-b ${
            showOffline
              ? 'bg-amber-500/15 text-amber-900 dark:text-amber-100 border-amber-500/30'
              : 'bg-sky-500/10 text-sky-900 dark:text-sky-100 border-sky-500/25'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <button
              type="button"
              className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
              onClick={() => setOpen((v) => !v)}
            >
              {showOffline ? (
                <CloudOff className="h-3.5 w-3.5 shrink-0 animate-pulse" />
              ) : syncing ? (
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <CloudUpload className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate font-medium">
                {showOffline
                  ? `You’re offline${pendingCount ? ` · ${pendingCount} sale(s) saved on device` : ''}`
                  : syncing
                    ? 'Uploading offline sales…'
                    : `${pendingCount} sale(s) waiting to sync`}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
              />
            </button>
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
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <p className="mt-1.5 text-[11px] leading-relaxed opacity-90">
                  {showOffline
                    ? 'POS still works. Sales are stored on this phone/PC and will upload when the internet returns.'
                    : 'These sales were made offline. Tap Sync now to send them to the server so reports stay accurate.'}
                  {lastSyncMessage ? ` · ${lastSyncMessage}` : ''} · {lastSyncLabel}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
