import { useState, useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileBottomNav } from './MobileBottomNav';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { useCurrencyStore } from '@/stores/currencyStore';
import { applyAppFont, normalizeFontId } from '@/lib/fonts';
import { applyDocumentTheme, normalizeThemeMode } from '@/lib/theme';
import { ensureSystemThemeWatch } from '@/stores/themeStore';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useCurrencyBootstrap } from '@/hooks/useCurrencyBootstrap';
import { fetchMe } from '@/services/auth.service';

export function AppLayout() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setUser = useAuthStore((s) => s.setUser);
  const theme = useThemeStore((s) => s.theme);
  const fontId = useThemeStore((s) => s.fontId);
  // Subscribe so the whole app shell re-renders when currency / rates change.
  // formatCurrency() reads the store at render time — without this, open pages stay stale.
  const currencyUiKey = useCurrencyStore(
    (s) => `${s.uiRevision}:${s.displayCurrency}:${s.baseCurrency}`
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Mount offline sync + network listeners once for the app shell
  useOfflineSync();
  // Multi-currency rates + app-wide display currency
  useCurrencyBootstrap();

  // Refresh profile (incl. durable company logoUrl) from the API on every session.
  // Survives reinstall and APK updates: logo lives in the database, not on the device.
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchMe();
        if (cancelled || !me) return;
        const prev = useAuthStore.getState().user;
        setUser({
          ...(prev || {}),
          ...me,
          company: me.company
            ? {
                id: me.company.id,
                name: me.company.name,
                slug: me.company.slug,
                logoUrl: me.company.logoUrl,
                currency: me.company.currency,
              }
            : prev?.company,
        });
      } catch {
        /* offline / expired — keep cached user */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, setUser]);

  // Keep color theme in sync (system follows phone light/dark; light/dark are locks)
  useEffect(() => {
    ensureSystemThemeWatch();
    const mode = normalizeThemeMode(theme);
    const painted = applyDocumentTheme(mode);
    useThemeStore.setState({ resolvedTheme: painted });
  }, [theme]);

  // Keep font CSS vars in sync (persist rehydrate + user changes)
  // Default / invalid → device system font
  useEffect(() => {
    void applyAppFont(normalizeFontId(fontId));
  }, [fontId]);

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  const isPos = location.pathname.startsWith('/app/pos');
  // Remount page content when route OR display currency changes so every amount re-formats
  const pageKey = `${location.pathname}::${currencyUiKey}`;

  return (
    <div className="app-shell flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] min-h-0 overflow-hidden bg-background bg-grid-fade">
      <div className="hidden lg:flex shrink-0 min-h-0">
        <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-30 bg-black/50 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <Sidebar open mobile onToggle={() => setMobileOpen(false)} onNavigate={() => setMobileOpen(false)} />
          </>
        )}
      </AnimatePresence>

      <div className="flex flex-1 flex-col min-w-0 max-w-full min-h-0 overflow-hidden">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <OfflineBanner />
        {/* POS manages its own scroll panes; other pages scroll vertically in main */}
        <main
          className={
            isPos
              ? 'flex-1 min-h-0 min-w-0 overflow-hidden has-mobile-bottom-nav'
              : 'flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain has-mobile-bottom-nav'
          }
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={pageKey}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={isPos ? 'h-full min-h-0 min-w-0' : 'min-h-full min-w-0 w-full max-w-full'}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
        <MobileBottomNav />
      </div>
    </div>
  );
}
