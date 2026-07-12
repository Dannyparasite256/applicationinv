import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, CloudOff, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { useNetworkStore } from '@/stores/networkStore';
import { runSyncEngine, refreshOfflineCatalog } from '@/lib/offline/syncEngine';
import {
  listPendingSync,
  countPendingSync,
  removeSyncItem,
  type SyncQueueItem,
} from '@/lib/offline/db';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export function SyncCenterPage() {
  const online = useNetworkStore((s) => s.online);
  const syncing = useNetworkStore((s) => s.syncing);
  const pendingCount = useNetworkStore((s) => s.pendingCount);
  const lastSyncAt = useNetworkStore((s) => s.lastSyncAt);
  const lastSyncMessage = useNetworkStore((s) => s.lastSyncMessage);
  const setPendingCount = useNetworkStore((s) => s.setPendingCount);
  const [items, setItems] = useState<SyncQueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const all = await listPendingSync();
      setItems(all || []);
      setPendingCount(await countPendingSync());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const onSync = async () => {
    if (!navigator.onLine) {
      toast.error('You are offline');
      return;
    }
    const r = await runSyncEngine();
    if (r.synced) toast.success(`Synced ${r.synced}`);
    else if (r.failed) toast.message(`${r.failed} failed`);
    else toast.message('Queue empty');
    await reload();
  };

  const onRefreshCatalog = async () => {
    try {
      await refreshOfflineCatalog();
      toast.success('Product catalog refreshed for offline use');
    } catch {
      toast.error('Could not refresh catalog — go online and try again');
    }
  };

  const clearFailed = async () => {
    try {
      for (const it of items) {
        if (it.status === 'failed' && it.id) await removeSyncItem(it.id);
      }
      toast.success('Cleared failed items');
      await reload();
    } catch {
      toast.error('Could not clear queue');
    }
  };

  return (
    <div className="page-container fit-x pb-6 space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to="/app/settings"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">Sync center</h1>
          <p className="text-xs text-muted-foreground">
            Offline sales waiting to upload · {online ? 'Online' : 'Offline'}
          </p>
        </div>
        <Badge variant={online ? 'success' : 'warning'}>{online ? 'Online' : 'Offline'}</Badge>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Status</CardTitle>
          <CardDescription>
            {pendingCount} pending · Last sync:{' '}
            {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'never'}
            {lastSyncMessage ? ` · ${lastSyncMessage}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button loading={syncing} onClick={() => void onSync()}>
            <Wifi className="h-4 w-4" /> Sync now
          </Button>
          <Button variant="secondary" onClick={() => void onRefreshCatalog()}>
            <RefreshCw className="h-4 w-4" /> Refresh offline catalog
          </Button>
          <Button variant="outline" onClick={() => void clearFailed()}>
            <Trash2 className="h-4 w-4" /> Clear failed
          </Button>
          <Button variant="ghost" onClick={() => void reload()}>
            Reload queue
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && !items.length && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <CloudOff className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Nothing waiting to sync
            </div>
          )}
          {items.map((it) => (
            <div key={it.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex justify-between gap-2">
                <p className="font-medium font-mono text-xs truncate">{it.id}</p>
                <Badge variant={it.status === 'failed' ? 'destructive' : 'secondary'}>
                  {it.status || 'pending'}
                </Badge>
              </div>
              {it.createdAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(it.createdAt).toLocaleString()}
                </p>
              )}
              {it.lastError && (
                <p className="text-xs text-destructive mt-1">{it.lastError}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
