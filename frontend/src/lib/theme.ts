/**
 * App color theme helpers.
 * - "system" = follow the phone / OS light-dark preference (default)
 * - "light" / "dark" = explicit user lock
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KNOWN: ReadonlySet<string> = new Set(['system', 'light', 'dark']);

export function isValidThemeMode(id: string | null | undefined): id is ThemeMode {
  return typeof id === 'string' && KNOWN.has(id);
}

/** Normalize stored value; unknown / missing → system (device default). */
export function normalizeThemeMode(id: string | null | undefined): ThemeMode {
  if (isValidThemeMode(id)) return id;
  return 'system';
}

/** Current OS / browser color scheme. */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Resolve preference to concrete light/dark for CSS. */
export function resolveTheme(mode: ThemeMode | string | null | undefined): ResolvedTheme {
  const m = normalizeThemeMode(mode);
  if (m === 'system') return getSystemTheme();
  return m;
}

/**
 * Apply theme to <html>: toggles `.dark`, sets data attributes, updates theme-color meta.
 */
export function applyDocumentTheme(mode: ThemeMode | string | null | undefined): ResolvedTheme {
  if (typeof document === 'undefined') return 'light';
  const preference = normalizeThemeMode(mode);
  const resolved = resolveTheme(preference);
  const root = document.documentElement;

  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = preference;
  root.dataset.resolvedTheme = resolved;

  // Browser chrome / PWA status bar hint
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', resolved === 'dark' ? '#0f172a' : '#f8fafc');
    }
  } catch {
    /* ignore */
  }

  return resolved;
}

type SystemThemeListener = (resolved: ResolvedTheme) => void;

let mediaQuery: MediaQueryList | null = null;
let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null;
const subscribers = new Set<SystemThemeListener>();

function notifySubscribers() {
  const resolved = getSystemTheme();
  subscribers.forEach((fn) => {
    try {
      fn(resolved);
    } catch {
      /* ignore */
    }
  });
}

/**
 * Subscribe to OS theme changes. Call when preference is "system".
 * Returns unsubscribe.
 */
export function subscribeSystemTheme(listener: SystemThemeListener): () => void {
  subscribers.add(listener);

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !mediaQuery) {
    try {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaHandler = () => notifySubscribers();
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', mediaHandler);
      } else {
        // Safari < 14
        (mediaQuery as MediaQueryList & { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener(
          mediaHandler
        );
      }
    } catch {
      mediaQuery = null;
      mediaHandler = null;
    }
  }

  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0 && mediaQuery && mediaHandler) {
      try {
        if (typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', mediaHandler);
        } else {
          (
            mediaQuery as MediaQueryList & {
              removeListener: (cb: (e: MediaQueryListEvent) => void) => void;
            }
          ).removeListener(mediaHandler);
        }
      } catch {
        /* ignore */
      }
      mediaQuery = null;
      mediaHandler = null;
    }
  };
}
