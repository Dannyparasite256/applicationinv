import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyAppFont, normalizeFontId, type AppFontId } from '@/lib/fonts';

interface ThemeState {
  theme: 'light' | 'dark';
  /** App body + headings font. Default: device system font */
  fontId: AppFontId;
  toggle: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setFontId: (fontId: AppFontId) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      /** Always start as device system font unless user picks another */
      fontId: 'system',
      toggle: () => {
        const next = get().theme === 'light' ? 'dark' : 'light';
        document.documentElement.classList.toggle('dark', next === 'dark');
        set({ theme: next });
      },
      setTheme: (theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        set({ theme });
      },
      setFontId: (fontId) => {
        const id = normalizeFontId(fontId);
        // Persist choice immediately; font file may still be downloading
        set({ fontId: id });
        void applyAppFont(id);
      },
    }),
    {
      name: 'eims-theme',
      partialize: (s) => ({ theme: s.theme, fontId: normalizeFontId(s.fontId) }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<ThemeState>;
        return {
          ...current,
          ...p,
          // Invalid / missing stored font → device system default
          fontId: normalizeFontId(p.fontId ?? current.fontId),
        };
      },
      onRehydrateStorage: () => (state) => {
        // After persist rehydrate, apply saved font (or device system default)
        const id = normalizeFontId(state?.fontId);
        if (state && state.fontId !== id) {
          state.fontId = id;
        }
        void applyAppFont(id);
        if (state?.theme === 'dark') {
          document.documentElement.classList.add('dark');
        }
      },
    }
  )
);
