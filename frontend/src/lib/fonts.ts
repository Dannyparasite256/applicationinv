/**
 * App typography.
 * - "system" = device OS font (Android sans-serif / iOS SF)
 * - Others = loaded webfonts (Google Fonts, with Bunny CDN fallback)
 */

import { Capacitor } from '@capacitor/core';

export type AppFontId =
  | 'system'
  | 'inter'
  | 'jakarta'
  | 'roboto'
  | 'opensans'
  | 'lato'
  | 'montserrat'
  | 'nunito'
  | 'poppins'
  | 'rubik'
  | 'worksans'
  | 'sourcesans';

export type AppFontOption = {
  id: AppFontId;
  label: string;
  description: string;
  /** Primary family name (must match @font-face family) */
  family: string;
  /** Full CSS font-family stack */
  stack: string;
  /** CSS2 family query for Google Fonts (null = system, no download) */
  google: string | null;
  /** Bunny Fonts slug (null = system) */
  bunny: string | null;
};

/**
 * Resolve the real device system font stack (WhatsApp-style).
 * Must not name "Roboto" / "Inter" first on Android — that freezes the font
 * and ignores the phone's default / user-selected system typeface.
 */
export function getSystemFontStack(): string {
  let platform = 'web';
  try {
    if (typeof document !== 'undefined' && document.documentElement.dataset.platform) {
      platform = document.documentElement.dataset.platform;
    } else if (Capacitor.isNativePlatform()) {
      platform = Capacitor.getPlatform();
    }
  } catch {
    /* ignore */
  }

  if (platform === 'android') {
    return 'sans-serif';
  }
  if (platform === 'ios') {
    return '-apple-system, system-ui, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';
  }
  return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';
}

export const SYSTEM_FONT_STACK = getSystemFontStack();

export const APP_FONTS: AppFontOption[] = [
  {
    id: 'system',
    label: 'Phone system font',
    description: 'Exact device font — same idea as WhatsApp',
    family: 'sans-serif',
    stack: 'sans-serif, system-ui, -apple-system, sans-serif',
    google: null,
    bunny: null,
  },
  {
    id: 'inter',
    label: 'Inter',
    description: 'Clean modern UI',
    family: 'Inter',
    stack: '"Inter", system-ui, sans-serif',
    google: 'Inter:wght@400;500;600;700;800',
    bunny: 'inter:400,500,600,700,800',
  },
  {
    id: 'jakarta',
    label: 'Plus Jakarta Sans',
    description: 'Rounded & friendly',
    family: 'Plus Jakarta Sans',
    stack: '"Plus Jakarta Sans", system-ui, sans-serif',
    google: 'Plus+Jakarta+Sans:wght@400;500;600;700;800',
    bunny: 'plus-jakarta-sans:400,500,600,700,800',
  },
  {
    id: 'roboto',
    label: 'Roboto',
    description: 'Classic Android look',
    family: 'Roboto',
    stack: '"Roboto", system-ui, sans-serif',
    google: 'Roboto:wght@400;500;700',
    bunny: 'roboto:400,500,700',
  },
  {
    id: 'opensans',
    label: 'Open Sans',
    description: 'Highly readable',
    family: 'Open Sans',
    stack: '"Open Sans", system-ui, sans-serif',
    google: 'Open+Sans:wght@400;500;600;700',
    bunny: 'open-sans:400,500,600,700',
  },
  {
    id: 'lato',
    label: 'Lato',
    description: 'Warm & professional',
    family: 'Lato',
    stack: '"Lato", system-ui, sans-serif',
    google: 'Lato:wght@400;700',
    bunny: 'lato:400,700',
  },
  {
    id: 'montserrat',
    label: 'Montserrat',
    description: 'Bold geometric titles',
    family: 'Montserrat',
    stack: '"Montserrat", system-ui, sans-serif',
    google: 'Montserrat:wght@400;500;600;700',
    bunny: 'montserrat:400,500,600,700',
  },
  {
    id: 'nunito',
    label: 'Nunito',
    description: 'Soft rounded letters',
    family: 'Nunito',
    stack: '"Nunito", system-ui, sans-serif',
    google: 'Nunito:wght@400;600;700',
    bunny: 'nunito:400,600,700',
  },
  {
    id: 'poppins',
    label: 'Poppins',
    description: 'Modern geometric',
    family: 'Poppins',
    stack: '"Poppins", system-ui, sans-serif',
    google: 'Poppins:wght@400;500;600;700',
    bunny: 'poppins:400,500,600,700',
  },
  {
    id: 'rubik',
    label: 'Rubik',
    description: 'Slightly rounded UI',
    family: 'Rubik',
    stack: '"Rubik", system-ui, sans-serif',
    google: 'Rubik:wght@400;500;600;700',
    bunny: 'rubik:400,500,600,700',
  },
  {
    id: 'worksans',
    label: 'Work Sans',
    description: 'Clear body text',
    family: 'Work Sans',
    stack: '"Work Sans", system-ui, sans-serif',
    google: 'Work+Sans:wght@400;500;600;700',
    bunny: 'work-sans:400,500,600,700',
  },
  {
    id: 'sourcesans',
    label: 'Source Sans 3',
    description: 'Adobe open source',
    family: 'Source Sans 3',
    stack: '"Source Sans 3", system-ui, sans-serif',
    google: 'Source+Sans+3:wght@400;500;600;700',
    bunny: 'source-sans-3:400,500,600,700',
  },
];

const GOOGLE_LINK_ID = 'eims-app-font';
const GOOGLE_PREVIEW_LINK_ID = 'eims-app-font-preview';
const PRECONNECT_IDS = ['eims-font-preconnect-g', 'eims-font-preconnect-gs', 'eims-font-preconnect-b'];

export function getFontOption(id: string | null | undefined): AppFontOption {
  return APP_FONTS.find((f) => f.id === id) || APP_FONTS[0];
}

function resolveStack(font: AppFontOption): string {
  if (font.id === 'system') return getSystemFontStack();
  return font.stack;
}

/** CSS font-family stack for previews (does not change the whole app). */
export function getFontPreviewStack(fontId: AppFontId | string): string {
  return resolveStack(getFontOption(fontId));
}

function ensurePreconnects() {
  if (typeof document === 'undefined') return;
  const links: Array<{ id: string; href: string }> = [
    { id: PRECONNECT_IDS[0], href: 'https://fonts.googleapis.com' },
    { id: PRECONNECT_IDS[1], href: 'https://fonts.gstatic.com' },
    { id: PRECONNECT_IDS[2], href: 'https://fonts.bunny.net' },
  ];
  for (const { id, href } of links) {
    if (document.getElementById(id)) continue;
    const el = document.createElement('link');
    el.id = id;
    el.rel = 'preconnect';
    el.href = href;
    el.crossOrigin = 'anonymous';
    document.head.appendChild(el);
  }
}

function injectStylesheet(id: string, href: string): HTMLLinkElement {
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.href !== href) {
    link.href = href;
  }
  return link;
}

function waitForLinkLoad(link: HTMLLinkElement, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    // Already loaded (cached)
    if (link.sheet) {
      finish(true);
      return;
    }
    const t = window.setTimeout(() => finish(false), timeoutMs);
    link.addEventListener(
      'load',
      () => {
        window.clearTimeout(t);
        finish(true);
      },
      { once: true }
    );
    link.addEventListener(
      'error',
      () => {
        window.clearTimeout(t);
        finish(false);
      },
      { once: true }
    );
  });
}

async function waitForFamily(family: string, timeoutMs = 6000): Promise<boolean> {
  if (typeof document === 'undefined' || !('fonts' in document)) return true;
  try {
    // Force load common weights used in the UI
    await Promise.race([
      Promise.all([
        document.fonts.load(`400 16px "${family}"`),
        document.fonts.load(`600 16px "${family}"`),
        document.fonts.load(`700 16px "${family}"`),
      ]),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
    return document.fonts.check(`400 16px "${family}"`);
  } catch {
    return false;
  }
}

/**
 * Download + wait for a webfont. Tries Google Fonts, then Bunny CDN.
 * Returns true if the family appears available.
 */
export async function ensureFontLoaded(fontId: AppFontId | string): Promise<boolean> {
  const font = getFontOption(fontId);
  if (!font.google || font.id === 'system') return true;

  ensurePreconnects();

  const googleHref = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  const bunnyHref = font.bunny
    ? `https://fonts.bunny.net/css?family=${font.bunny}&display=swap`
    : null;

  // Prefer Google; fall back to Bunny if link errors or family not ready
  const link = injectStylesheet(GOOGLE_LINK_ID, googleHref);
  const googleOk = await waitForLinkLoad(link);
  let ready = await waitForFamily(font.family);

  if ((!googleOk || !ready) && bunnyHref) {
    injectStylesheet(GOOGLE_LINK_ID, bunnyHref);
    await waitForLinkLoad(link);
    ready = await waitForFamily(font.family);
  }

  return ready;
}

/**
 * Load a font only for preview (does not change the active app font link permanently
 * until applyAppFont runs — uses a separate link id for preview).
 */
export async function loadFontForPreview(fontId: AppFontId | string): Promise<boolean> {
  const font = getFontOption(fontId);
  if (!font.google || font.id === 'system') return true;

  ensurePreconnects();
  const googleHref = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  const bunnyHref = font.bunny
    ? `https://fonts.bunny.net/css?family=${font.bunny}&display=swap`
    : null;

  let link = injectStylesheet(GOOGLE_PREVIEW_LINK_ID, googleHref);
  let ok = await waitForLinkLoad(link);
  let ready = await waitForFamily(font.family);

  if ((!ok || !ready) && bunnyHref) {
    link = injectStylesheet(GOOGLE_PREVIEW_LINK_ID, bunnyHref);
    await waitForLinkLoad(link);
    ready = await waitForFamily(font.family);
  }
  return ready;
}

function paintStack(stack: string, fontId: string) {
  const root = document.documentElement;
  root.style.setProperty('--font-sans', stack);
  root.style.setProperty('--font-display', stack);
  root.dataset.font = fontId;
  root.style.fontFamily = stack;
  if (document.body) {
    document.body.style.fontFamily = stack;
  }
}

/**
 * Apply font to the whole app. Waits for webfont download when needed.
 */
export async function applyAppFont(fontId: AppFontId | string): Promise<boolean> {
  const font = getFontOption(fontId);
  const stack = resolveStack(font);
  const root = document.documentElement;

  if (font.id === 'system') {
    root.style.setProperty('--font-tracking', '0');
    root.classList.add('font-system');
    root.classList.remove('font-custom');
    // Remove active webfont stylesheet so system face wins
    document.getElementById(GOOGLE_LINK_ID)?.remove();
    paintStack(stack, font.id);
    return true;
  }

  root.style.setProperty('--font-tracking', '-0.01em');
  root.classList.add('font-custom');
  root.classList.remove('font-system');

  // Paint stack immediately (may fallback briefly), then ensure download
  paintStack(stack, font.id);
  const ok = await ensureFontLoaded(font.id);
  // Re-paint after load so WebView picks up the face
  paintStack(stack, font.id);
  return ok;
}
