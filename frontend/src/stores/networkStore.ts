import { create } from 'zustand';

interface NetworkState {
  online: boolean;
  connectionType: string;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  syncing: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  lastSyncMessage: string | null;
  setOnline: (online: boolean, connectionType?: string) => void;
  setSyncing: (syncing: boolean) => void;
  setPendingCount: (n: number) => void;
  setLastSync: (message: string) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  connectionType: 'unknown',
  lastOnlineAt: null,
  lastOfflineAt: null,
  syncing: false,
  pendingCount: 0,
  lastSyncAt: null,
  lastSyncMessage: null,
  setOnline: (online, connectionType = 'unknown') =>
    set((s) => ({
      online,
      connectionType,
      lastOnlineAt: online ? new Date().toISOString() : s.lastOnlineAt,
      lastOfflineAt: !online ? new Date().toISOString() : s.lastOfflineAt,
    })),
  setSyncing: (syncing) => set({ syncing }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setLastSync: (lastSyncMessage) =>
    set({ lastSyncAt: new Date().toISOString(), lastSyncMessage }),
}));
