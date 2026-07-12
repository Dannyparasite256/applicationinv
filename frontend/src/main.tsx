import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initNativeApp } from './native/initNative';
import { applyAppFont } from './lib/fonts';

// Ensure device id for session tracking
if (!localStorage.getItem('deviceId')) {
  localStorage.setItem('deviceId', crypto.randomUUID());
}

// Apply theme + font early (before paint).
// Default is always the phone system font (WhatsApp-style) unless user picked another in Settings.
const theme = localStorage.getItem('eims-theme');
if (theme) {
  try {
    const parsed = JSON.parse(theme);
    if (parsed.state?.theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
    void applyAppFont(parsed.state?.fontId || 'system');
  } catch {
    void applyAppFont('system');
  }
} else {
  void applyAppFont('system');
}
// Ensure system class exists before first paint if default
if (!document.documentElement.dataset.font) {
  document.documentElement.classList.add('font-system');
  document.documentElement.dataset.font = 'system';
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
