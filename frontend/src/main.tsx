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
    applyAppFont(parsed.state?.fontId || 'system');
  } catch {
    applyAppFont('system');
  }
} else {
  applyAppFont('system');
}
// Ensure system class exists before first paint if default
if (!document.documentElement.dataset.font) {
  document.documentElement.classList.add('font-system');
  document.documentElement.dataset.font = 'system';
}

async function bootstrap() {
  await initNativeApp();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

bootstrap();
