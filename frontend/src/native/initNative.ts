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

  // Re-apply system font after platform is known so Android uses real device typeface
  try {
    const { applyAppFont } = await import('@/lib/fonts');
    const raw = localStorage.getItem('eims-theme');
    let fontId = 'system';
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        fontId = parsed?.state?.fontId || 'system';
      } catch {
        /* ignore */
      }
    }
    applyAppFont(fontId);
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
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0f172a' });
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
