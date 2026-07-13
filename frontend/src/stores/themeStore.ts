import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyAppFont, normalizeFontId, type AppFontId } from '@/lib/fonts';
import {
  applyDocumentTheme,
  normalizeThemeMode,
  resolveTheme,
  subscribeSystemTheme,
  type ResolvedTheme,
  type ThemeMode,
} from '@/lib/theme';

interface ThemeState {
  /**
   * Color theme preference.
   * Default "system" = follow the phone / OS light-dark setting.
   */
  theme: ThemeMode;
  /**
   * Concrete light/dark currently painted (updates when OS theme changes
   * while preference is "system"). Used by icons / UI.
   */
  resolvedTheme: ResolvedTheme;
  /** App body + headings font. Default: device system font */
  fontId: AppFontId;
  toggle: () => void;
  setTheme: (theme: ThemeMode) => void;
  setFontId: (fontId: AppFontId) => void;
  getResolvedTheme: () => ResolvedTheme;
}

function paintTheme(mode: ThemeMode): ResolvedTheme {
  return applyDocumentTheme(mode);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      /** Follow device light/dark until the user picks Light or Dark */
      theme: 'system',
      resolvedTheme: resolveTheme('system'),
      /** Always start as device system font unless user picks another */
      fontId: 'system',
      toggle: () => {
        // Explicit lock to the opposite of what the user currently sees
        const resolved = resolveTheme(get().theme);
        const next: ThemeMode = resolved === 'dark' ? 'light' : 'dark';
        const painted = paintTheme(next);
        set({ theme: next, resolvedTheme: painted });
      },
      setTheme: (theme) => {
        const mode = normalizeThemeMode(theme);
        const painted = paintTheme(mode);
        set({ theme: mode, resolvedTheme: painted });
      },
      setFontId: (fontId) => {
        const id = normalizeFontId(fontId);
        set({ fontId: id });
        void applyAppFont(id);
      },
      getResolvedTheme: () => get().resolvedTheme || resolveTheme(get().theme),
    }),
    {
      name: 'eims-theme',
      partialize: (s) => ({
        theme: normalizeThemeMode(s.theme),
        fontId: normalizeFontId(s.fontId),
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<ThemeState>;
        const theme = normalizeThemeMode(p.theme ?? current.theme);
        return {
          ...current,
          ...p,
          theme,
          resolvedTheme: resolveTheme(theme),
          fontId: normalizeFontId(p.fontId ?? current.fontId),
        };
      },
      onRehydrateStorage: () => (state) => {
        const theme = normalizeThemeMode(state?.theme);
        const fontId = normalizeFontId(state?.fontId);
        const painted = paintTheme(theme);
        if (state) {
          state.theme = theme;
          state.fontId = fontId;
          state.resolvedTheme = painted;
        }
        void applyAppFont(fontId);
      },
    }
  )
);

/** Keep DOM in sync when OS theme changes and preference is "system". */
let stopSystemWatch: (() => void) | null = null;

export function ensureSystemThemeWatch(): void {
  if (stopSystemWatch) return;
  stopSystemWatch = subscribeSystemTheme(() => {
    const mode = normalizeThemeMode(useThemeStore.getState().theme);
    if (mode === 'system') {
      const painted = paintTheme('system');
      useThemeStore.setState({ resolvedTheme: painted });
    }
  });
}

// Start listening as soon as the store module loads (browser only)
if (typeof window !== 'undefined') {
  ensureSystemThemeWatch();
}
