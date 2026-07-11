/**
 * Runtime API base URL for web vs native Android.
 * Always bake VITE_API_URL / VITE_NATIVE_API_URL for physical devices (LAN IP of your PC).
 * Emulator-only fallback is 10.0.2.2 — never use that on a real phone.
 */
export function getApiBaseUrl(): string {
  // Explicit env always wins (set at build time for release APKs)
  if (import.meta.env.VITE_API_URL) {
    return stripTrailingSlash(import.meta.env.VITE_API_URL);
  }

  if (import.meta.env.VITE_NATIVE_API_URL) {
    return stripTrailingSlash(import.meta.env.VITE_NATIVE_API_URL);
  }

  // Capacitor injects this when running inside the Android/iOS shell
  const isNative =
    typeof window !== 'undefined' &&
    !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      ?.isNativePlatform?.();

  if (isNative) {
    // Last resort for emulator builds that forgot to set env.
    // Physical devices MUST set VITE_API_URL to the PC LAN IP.
    return 'http://10.0.2.2:4000/api/v1';
  }

  // Browser dev — Vite proxies /api → backend
  return '/api/v1';
}

/** API origin without /api/v1 — used for /uploads media */
export function getApiOrigin(): string {
  const api = getApiBaseUrl();
  if (api.startsWith('/')) {
    if (typeof window !== 'undefined') return window.location.origin;
    return '';
  }
  return api.replace(/\/api\/v\d+\/?$/i, '').replace(/\/+$/, '');
}

function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, '');
}

export function isNativeApp(): boolean {
  try {
    return !!(
      window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}
