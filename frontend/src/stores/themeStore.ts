import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyAppFont, type AppFontId } from '@/lib/fonts';

interface ThemeState {
  theme: 'light' | 'dark';
  /** App body + headings font. Default: phone system font */
  fontId: AppFontId;
  toggle: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setFontId: (fontId: AppFontId) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
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
        // Persist choice immediately; font file may still be downloading
        set({ fontId });
        void applyAppFont(fontId);
      },
    }),
    {
      name: 'eims-theme',
      onRehydrateStorage: () => (state) => {
        // After persist rehydrate, apply saved font (or system default)
        void applyAppFont(state?.fontId || 'system');
        if (state?.theme === 'dark') {
          document.documentElement.classList.add('dark');
        }
      },
    }
  )
);
