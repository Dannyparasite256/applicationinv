import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import App from './App';
import './index.css';
import { initNativeApp } from './native/initNative';
import { applyAppFont, ensurePlatformDataset, normalizeFontId } from './lib/fonts';
import { applyDocumentTheme, normalizeThemeMode } from './lib/theme';
import { ensureSystemThemeWatch } from './stores/themeStore';

// Ensure device id for session tracking
if (!localStorage.getItem('deviceId')) {
  localStorage.setItem('deviceId', crypto.randomUUID());
}

// Mark native platform ASAP so system font stack uses the real device typeface
// (Android: generic sans-serif → OEM default; not a frozen "Roboto" webfont name).
try {
  if (Capacitor.isNativePlatform()) {
    document.documentElement.classList.add('native-app');
    document.documentElement.dataset.platform = Capacitor.getPlatform();
  } else {
    ensurePlatformDataset();
  }
} catch {
  ensurePlatformDataset();
}

// Apply theme + font early (before paint).
// Defaults: device system font + device light/dark theme unless user overrode in Settings.
const themeRaw = localStorage.getItem('eims-theme');
let earlyFontId = 'system';
let earlyThemeMode = 'system' as ReturnType<typeof normalizeThemeMode>;
if (themeRaw) {
  try {
    const parsed = JSON.parse(themeRaw);
    earlyThemeMode = normalizeThemeMode(parsed.state?.theme as string | undefined);
    earlyFontId = normalizeFontId(parsed.state?.fontId as string | undefined);
  } catch {
    earlyThemeMode = 'system';
    earlyFontId = 'system';
  }
}
// Device light/dark (or explicit light/dark lock)
applyDocumentTheme(earlyThemeMode);
ensureSystemThemeWatch();

// Default path: device system font
document.documentElement.classList.add(earlyFontId === 'system' ? 'font-system' : 'font-custom');
document.documentElement.classList.remove(earlyFontId === 'system' ? 'font-custom' : 'font-system');
document.documentElement.dataset.font = earlyFontId;
void applyAppFont(earlyFontId);

// Theme preset (clean / night / contrast)
try {
  const prefs = localStorage.getItem('eims-prefs');
  if (prefs) {
    const parsed = JSON.parse(prefs);
    const preset = parsed?.state?.themePreset || 'clean';
    document.documentElement.classList.add(`theme-${preset}`);
    if (preset === 'night') document.documentElement.classList.add('dark');
  }
} catch {
  /* ignore */
}

/** Ping the API so free-tier hosts (Render) wake before the first real request. */
async function warmApi(): Promise<void> {
  try {
    const { getApiBaseUrl } = await import('@/lib/config');
    const base = getApiBaseUrl();
    if (!base || base.startsWith('/')) return; // same-origin proxy in local dev
    const healthUrl = `${base.replace(/\/+$/, '')}/health`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60_000);
    await fetch(healthUrl, { method: 'GET', mode: 'cors', signal: ctrl.signal }).catch(() => undefined);
    clearTimeout(t);
  } catch {
    /* non-fatal — requests will retry */
  }
}

async function bootstrap() {
  await initNativeApp();
  // Fire-and-forget wake; do not block first paint more than a short moment
  void warmApi();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

bootstrap();
