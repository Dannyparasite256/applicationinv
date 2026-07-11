import { Bell, Menu, Moon, Search, Sun, LogOut, User, Wifi, WifiOff, RefreshCw, Coins } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { useNetworkStore } from '@/stores/networkStore';
import { useCurrencyStore } from '@/stores/currencyStore';
import { getInitials } from '@/lib/utils';
import { getMediaUrl, brandInitials } from '@/lib/media';
import { logout as logoutApi } from '@/services/auth.service';
import { api } from '@/lib/api';
import { runSyncEngine } from '@/lib/offline/syncEngine';
import { requestNotificationPermission, notifyLocal } from '@/native/notifications';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { useEffect, useRef, useState } from 'react';

interface TopbarProps {
  onMenuClick: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const logout = useAuthStore((s) => s.logout);
  const { theme, toggle } = useThemeStore();
  const online = useNetworkStore((s) => s.online);
  const syncing = useNetworkStore((s) => s.syncing);
  const pendingCount = useNetworkStore((s) => s.pendingCount);
  const displayCurrency = useCurrencyStore((s) => s.displayCurrency);
  const baseCurrency = useCurrencyStore((s) => s.baseCurrency);
  const currencies = useCurrencyStore((s) => s.currencies);
  const setDisplayCurrency = useCurrencyStore((s) => s.setDisplayCurrency);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () =>
      (await api.get('/notifications')).data.data as Array<{
        id: string;
        title: string;
        body: string;
        status: string;
      }>,
    refetchInterval: 60000,
    enabled: online,
  });
  const unread = (notifications || []).filter((n) => n.status !== 'READ').length;

  useEffect(() => {
    if (!notifications?.length) return;
    const fresh = notifications.filter((n) => n.status !== 'READ' && !seenIdsRef.current.has(n.id));
    if (!fresh.length) return;
    const latest = fresh[0];
    void notifyLocal({ title: latest.title, body: latest.body });
    fresh.forEach((n) => seenIdsRef.current.add(n.id));
  }, [notifications]);

  const handleLogout = async () => {
    try {
      await logoutApi(refreshToken);
    } catch {
      /* ignore */
    }
    logout();
    navigate('/login');
  };

  const companyLogo = getMediaUrl(user?.company?.logoUrl);

  return (
    <header className="app-topbar sticky top-0 z-30 flex items-center gap-1 sm:gap-2 border-b border-border/80 bg-background/90 backdrop-blur-xl px-1.5 sm:px-3 md:px-5 shadow-soft/50 shrink-0 min-w-0 w-full max-w-full overflow-x-clip">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden rounded-xl h-8 w-8 sm:h-9 sm:w-9 shrink-0"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex items-center gap-1.5 lg:hidden min-w-0 flex-1 overflow-hidden">
        <div className="brand-mark h-7 w-7 sm:h-8 sm:w-8 text-[10px] shrink-0">
          {companyLogo ? (
            <img src={companyLogo} alt="" className="h-full w-full object-cover" />
          ) : (
            brandInitials(user?.company?.name)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] sm:text-sm font-bold truncate font-display leading-tight">
            {user?.company?.name || 'Enterprise IMS'}
          </p>
        </div>
      </div>

      <div className="relative hidden md:block flex-1 max-w-md min-w-0">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search…"
          className="pl-9 h-9 rounded-xl bg-muted/50 border-transparent focus:border-border shadow-none"
        />
      </div>

      <div className="ml-auto flex items-center gap-0.5 sm:gap-1 shrink-0">
        <div className="relative flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 px-1 sm:px-2 h-7 sm:h-8">
          <Coins className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-primary shrink-0" />
          <select
            className="bg-transparent text-[10px] sm:text-xs font-semibold outline-none max-w-[3.25rem] sm:max-w-[5rem] cursor-pointer"
            value={displayCurrency}
            title={`Display currency (base: ${baseCurrency}). Changing this converts all amounts app-wide.`}
            onChange={(e) => {
              setDisplayCurrency(e.target.value);
              toast.message(`Currency: ${e.target.value}`, {
                description: `All prices and totals now show in ${e.target.value} (base ${baseCurrency})`,
              });
            }}
          >
            {(currencies.filter((c) => c.isActive !== false).length
              ? currencies.filter((c) => c.isActive !== false)
              : [{ code: displayCurrency, name: displayCurrency, symbol: displayCurrency, exchangeRate: 1 }]
            ).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
                {c.isBase ? ' ★' : ''}
              </option>
            ))}
          </select>
        </div>

        <Badge
          variant={online ? 'success' : 'warning'}
          className="hidden md:inline-flex gap-1 cursor-pointer"
          onClick={() => {
            if (online && pendingCount > 0) {
              void runSyncEngine().then((r) => {
                if (r.synced) toast.success(`Synced ${r.synced}`);
              });
            } else if (!online) {
              toast.message('You are offline');
            }
          }}
        >
          {syncing ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : online ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          {online ? (pendingCount ? `${pendingCount}` : 'On') : 'Off'}
        </Badge>

        <button
          type="button"
          className="md:hidden p-1.5 rounded-lg text-muted-foreground shrink-0"
          title={online ? 'Online' : 'Offline'}
          onClick={() => toast.message(online ? 'You are online' : 'You are offline')}
        >
          {online ? (
            <Wifi className="h-3.5 w-3.5 text-success" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-warning" />
          )}
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 sm:h-9 sm:w-9 shrink-0"
          onClick={toggle}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <Sun className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          ) : (
            <Moon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          )}
        </Button>

        <div className="relative shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="relative h-8 w-8 sm:h-9 sm:w-9"
            onClick={() => {
              setNotifOpen((v) => !v);
              void requestNotificationPermission();
            }}
          >
            <Bell className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            {unread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute right-1 top-1 h-1.5 w-1.5 sm:right-1.5 sm:top-1.5 sm:h-2 sm:w-2 rounded-full bg-primary ring-2 ring-background"
              />
            )}
          </Button>
          <AnimatePresence>
            {notifOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="panel-float absolute right-0 top-full z-50 mt-2 p-2"
                >
                  <div className="flex items-center justify-between px-2 py-1.5 gap-2">
                    <p className="text-xs font-semibold text-muted-foreground">Notifications</p>
                    <button
                      className="text-[10px] text-primary hover:underline shrink-0"
                      onClick={() =>
                        void requestNotificationPermission().then((ok) =>
                          toast.message(ok ? 'Push enabled' : 'Permission denied')
                        )
                      }
                    >
                      Enable push
                    </button>
                  </div>
                  {(notifications || []).slice(0, 10).map((n) => (
                    <div
                      key={n.id}
                      className="rounded-lg px-3 py-2 hover:bg-muted text-sm transition-colors min-w-0"
                    >
                      <p className="font-medium truncate">{n.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 break-safe">{n.body}</p>
                    </div>
                  ))}
                  {!notifications?.length && (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No notifications yet
                    </p>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl sm:rounded-2xl px-1 sm:px-2 py-1 hover:bg-muted/80 transition-colors ring-1 ring-transparent hover:ring-border"
          >
            <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg sm:rounded-xl bg-primary/12 text-primary text-[10px] sm:text-xs font-bold ring-2 ring-primary/10">
              {getInitials(user?.firstName, user?.lastName)}
            </div>
            <div className="hidden md:block text-left pr-1 min-w-0 max-w-[7rem]">
              <p className="text-sm font-semibold leading-none tracking-tight truncate">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1 font-medium truncate">
                {user?.roles?.[0]?.replace(/_/g, ' ')}
              </p>
            </div>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-2 w-[min(14rem,calc(100vw-1rem))] rounded-2xl border border-border/80 bg-card p-1.5 shadow-elevated">
                <div className="px-3 py-2 border-b border-border/60 mb-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{user?.company?.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
                </div>
                <button
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-muted font-medium"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/app/settings');
                  }}
                >
                  <User className="h-4 w-4 text-primary shrink-0" /> Business & Settings
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 font-medium"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4 shrink-0" /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
