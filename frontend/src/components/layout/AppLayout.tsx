import { useState, useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { applyAppFont } from '@/lib/fonts';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useCurrencyBootstrap } from '@/hooks/useCurrencyBootstrap';

export function AppLayout() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const theme = useThemeStore((s) => s.theme);
  const fontId = useThemeStore((s) => s.fontId);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Mount offline sync + network listeners once for the app shell
  useOfflineSync();
  // Multi-currency rates + app-wide display currency
  useCurrencyBootstrap();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Keep font CSS vars in sync (persist rehydrate + user changes)
  useEffect(() => {
    applyAppFont(fontId || 'system');
  }, [fontId]);

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  const isPos = location.pathname.startsWith('/app/pos');

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
              ? 'flex-1 min-h-0 min-w-0 overflow-hidden'
              : 'flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain'
          }
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className={isPos ? 'h-full min-h-0 min-w-0' : 'min-h-full min-w-0 w-full max-w-full'}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
