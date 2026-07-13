import { Capacitor } from '@capacitor/core';

/**
 * Initialize native Android/iOS plugins when running inside Capacitor.
 * Every step is isolated so one plugin failure cannot crash the app.
 */
export async function initNativeApp(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    document.documentElement.classList.add('native-app');
    document.documentElement.dataset.platform = Capacitor.getPlatform();
  }

  // Re-apply font after platform is known so Android uses real device typeface (sans-serif)
  try {
    const { applyAppFont, ensurePlatformDataset, normalizeFontId } = await import('@/lib/fonts');
    ensurePlatformDataset();
    const raw = localStorage.getItem('eims-theme');
    let fontId = 'system';
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        fontId = normalizeFontId(parsed?.state?.fontId);
      } catch {
        fontId = 'system';
      }
    }
    // Default / missing / invalid → device system font
    await applyAppFont(fontId);
  } catch (e) {
    console.warn('[native] font apply failed', e);
  }

  const safe = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.warn(`[native] ${label} failed`, e);
    }
  };

  await safe('status-bar', async () => {
    if (!Capacitor.isNativePlatform()) return;
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    // Draw under the status bar; CSS safe-area-inset-* keeps top nav readable
    // on notched / punch-hole / small Android screens.
    try {
      await StatusBar.setOverlaysWebView({ overlay: true });
    } catch {
      /* some OEMs ignore this */
    }
    // Match phone / app resolved theme (system default = device light/dark)
    let dark = false;
    try {
      const { resolveTheme, normalizeThemeMode } = await import('@/lib/theme');
      const raw = localStorage.getItem('eims-theme');
      let mode = 'system';
      if (raw) {
        const parsed = JSON.parse(raw);
        mode = normalizeThemeMode(parsed?.state?.theme);
      }
      dark = resolveTheme(mode) === 'dark';
    } catch {
      try {
        dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      } catch {
        dark = false;
      }
    }
    // Light content (icons) on dark status bar area when app is dark
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? '#0f172a' : '#f8fafc' });
  });

  await safe('splash', async () => {
    if (!Capacitor.isNativePlatform()) return;
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  });

  await safe('back-button', async () => {
    if (!Capacitor.isNativePlatform()) return;
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else App.exitApp();
    });
  });

  // Local notifications only — never load PushNotifications (needs Firebase)
  await safe('local-notifications', async () => {
    const { initPushNotifications } = await import('@/native/pushNotifications');
    await initPushNotifications();
  });
}
