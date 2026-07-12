/**
 * App typography.
 * Default "system" uses the phone OS font exactly the way native apps (WhatsApp, Messages) do:
 *  - Android WebView: generic `sans-serif` → device Typeface.DEFAULT (Roboto or user/OEM system font)
 *  - iOS: -apple-system / SF Pro
 * Optional webfonts load only when chosen in Settings.
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
  /** Static stack for previews (system stack is resolved at apply time) */
  stack: string;
  /** Google Fonts family query segment, or null for system */
  google: string | null;
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
    // Generic family maps to Android system default Typeface (same path native apps use)
    return 'sans-serif';
  }
  if (platform === 'ios') {
    return '-apple-system, system-ui, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';
  }
  // Desktop browsers
  return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';
}

/** Fallback stack used in static previews before platform is known */
export const SYSTEM_FONT_STACK = getSystemFontStack();

export const APP_FONTS: AppFontOption[] = [
  {
    id: 'system',
    label: 'Phone system font',
    description: 'Exact device font — same idea as WhatsApp',
    stack: 'sans-serif, system-ui, -apple-system, sans-serif',
    google: null,
  },
  {
    id: 'inter',
    label: 'Inter',
    description: 'Clean modern UI',
    stack: '"Inter", system-ui, sans-serif',
    google: 'Inter:wght@400;500;600;700;800',
  },
  {
    id: 'jakarta',
    label: 'Plus Jakarta Sans',
    description: 'Rounded & friendly',
    stack: '"Plus Jakarta Sans", system-ui, sans-serif',
    google: 'Plus+Jakarta+Sans:wght@400;500;600;700;800',
  },
  {
    id: 'roboto',
    label: 'Roboto',
    description: 'Classic Android look',
    stack: '"Roboto", system-ui, sans-serif',
    google: 'Roboto:wght@400;500;700',
  },
  {
    id: 'opensans',
    label: 'Open Sans',
    description: 'Highly readable',
    stack: '"Open Sans", system-ui, sans-serif',
    google: 'Open+Sans:wght@400;500;600;700',
  },
  {
    id: 'lato',
    label: 'Lato',
    description: 'Warm & professional',
    stack: '"Lato", system-ui, sans-serif',
    google: 'Lato:wght@400;700',
  },
  {
    id: 'montserrat',
    label: 'Montserrat',
    description: 'Bold geometric titles',
    stack: '"Montserrat", system-ui, sans-serif',
    google: 'Montserrat:wght@400;500;600;700',
  },
  {
    id: 'nunito',
    label: 'Nunito',
    description: 'Soft rounded letters',
    stack: '"Nunito", system-ui, sans-serif',
    google: 'Nunito:wght@400;600;700',
  },
  {
    id: 'poppins',
    label: 'Poppins',
    description: 'Modern geometric',
    stack: '"Poppins", system-ui, sans-serif',
    google: 'Poppins:wght@400;500;600;700',
  },
  {
    id: 'rubik',
    label: 'Rubik',
    description: 'Slightly rounded UI',
    stack: '"Rubik", system-ui, sans-serif',
    google: 'Rubik:wght@400;500;600;700',
  },
  {
    id: 'worksans',
    label: 'Work Sans',
    description: 'Clear body text',
    stack: '"Work Sans", system-ui, sans-serif',
    google: 'Work+Sans:wght@400;500;600;700',
  },
  {
    id: 'sourcesans',
    label: 'Source Sans 3',
    description: 'Adobe open source',
    stack: '"Source Sans 3", system-ui, sans-serif',
    google: 'Source+Sans+3:wght@400;500;600;700',
  },
];

const GOOGLE_LINK_ID = 'eims-app-font';
const GOOGLE_PREVIEW_LINK_ID = 'eims-app-font-preview';

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

/**
 * Load a Google Font only for preview (separate link from the active app font).
 * Safe to call repeatedly when browsing the font list.
 */
export function loadFontForPreview(fontId: AppFontId | string): void {
  const font = getFontOption(fontId);
  let link = document.getElementById(GOOGLE_PREVIEW_LINK_ID) as HTMLLinkElement | null;
  if (!font.google) {
    // System font — no download
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.id = GOOGLE_PREVIEW_LINK_ID;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
}

/** Apply font to the document (CSS variables + optional Google Fonts load). */
export function applyAppFont(fontId: AppFontId | string) {
  const font = getFontOption(fontId);
  const stack = resolveStack(font);
  const root = document.documentElement;
  root.style.setProperty('--font-sans', stack);
  root.style.setProperty('--font-display', stack);
  root.dataset.font = font.id;

  // System mode: native letter-spacing like WhatsApp (no tight display tracking)
  if (font.id === 'system') {
    root.style.setProperty('--font-tracking', '0');
    root.classList.add('font-system');
    root.classList.remove('font-custom');
  } else {
    root.style.setProperty('--font-tracking', '-0.02em');
    root.classList.add('font-custom');
    root.classList.remove('font-system');
  }

  // Apply directly so every control inherits immediately
  if (document.body) {
    document.body.style.fontFamily = stack;
  }
  root.style.fontFamily = stack;

  let link = document.getElementById(GOOGLE_LINK_ID) as HTMLLinkElement | null;
  if (font.google) {
    if (!link) {
      link = document.createElement('link');
      link.id = GOOGLE_LINK_ID;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
  } else if (link) {
    link.remove();
  }
}
