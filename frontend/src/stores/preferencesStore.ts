import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreset = 'clean' | 'night' | 'contrast';
export type LabelMode = 'normal' | 'simple';
/** Visual surface style — liquid glass can be turned off for a solid "normal" UI */
export type UiStyle = 'normal' | 'liquid';

export type OnboardingStepId =
  | 'logo'
  | 'currency'
  | 'product'
  | 'sale'
  | 'staff';

interface PreferencesState {
  soundsEnabled: boolean;
  hapticsEnabled: boolean;
  themePreset: ThemePreset;
  /** Default "normal"; set "liquid" for frosted glass surfaces app-wide */
  uiStyle: UiStyle;
  labelMode: LabelMode;
  posFavorites: string[];
  posRecent: Array<{ id: string; at: number }>;
  posDefaultPayment: string;
  onboardingDismissed: boolean;
  onboardingCompleted: OnboardingStepId[];
  setSoundsEnabled: (v: boolean) => void;
  setHapticsEnabled: (v: boolean) => void;
  setThemePreset: (p: ThemePreset) => void;
  setUiStyle: (s: UiStyle) => void;
  setLabelMode: (m: LabelMode) => void;
  setPosDefaultPayment: (m: string) => void;
  toggleFavorite: (productId: string) => void;
  isFavorite: (productId: string) => boolean;
  pushRecent: (productId: string) => void;
  completeOnboardingStep: (step: OnboardingStepId) => void;
  dismissOnboarding: () => void;
  resetOnboarding: () => void;
}

function applyThemePreset(preset: ThemePreset) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('theme-clean', 'theme-night', 'theme-contrast');
  root.classList.add(`theme-${preset}`);
  // Night shift forces dark look; other presets leave light/dark to theme store
  // (system = phone default, or explicit light/dark).
  if (preset === 'night') {
    root.classList.add('dark');
  }
}

export function normalizeUiStyle(v: string | null | undefined): UiStyle {
  return v === 'liquid' ? 'liquid' : 'normal';
}

/** Apply liquid glass vs solid surfaces on <html>. */
export function applyUiStyle(style: UiStyle | string | null | undefined) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const s = normalizeUiStyle(style as string);
  root.classList.toggle('ui-liquid', s === 'liquid');
  root.classList.toggle('ui-normal', s !== 'liquid');
  root.dataset.uiStyle = s;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set, get) => ({
      soundsEnabled: false,
      hapticsEnabled: true,
      themePreset: 'clean',
      uiStyle: 'normal',
      labelMode: 'normal',
      posFavorites: [],
      posRecent: [],
      posDefaultPayment: 'CASH',
      onboardingDismissed: false,
      onboardingCompleted: [],

      setSoundsEnabled: (soundsEnabled) => set({ soundsEnabled }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      setThemePreset: (themePreset) => {
        applyThemePreset(themePreset);
        set({ themePreset });
      },
      setUiStyle: (uiStyle) => {
        const next = normalizeUiStyle(uiStyle);
        applyUiStyle(next);
        set({ uiStyle: next });
      },
      setLabelMode: (labelMode) => set({ labelMode }),
      setPosDefaultPayment: (posDefaultPayment) => set({ posDefaultPayment }),

      toggleFavorite: (productId) => {
        const id = productId;
        const cur = get().posFavorites;
        if (cur.includes(id)) {
          set({ posFavorites: cur.filter((x) => x !== id) });
        } else {
          set({ posFavorites: [id, ...cur].slice(0, 24) });
        }
      },
      isFavorite: (productId) => get().posFavorites.includes(productId),
      pushRecent: (productId) => {
        const rest = get().posRecent.filter((r) => r.id !== productId);
        set({
          posRecent: [{ id: productId, at: Date.now() }, ...rest].slice(0, 12),
        });
      },

      completeOnboardingStep: (step) => {
        const done = get().onboardingCompleted;
        if (done.includes(step)) return;
        set({ onboardingCompleted: [...done, step] });
      },
      dismissOnboarding: () => set({ onboardingDismissed: true }),
      resetOnboarding: () =>
        set({ onboardingDismissed: false, onboardingCompleted: [] }),
    }),
    {
      name: 'eims-prefs',
      partialize: (s) => ({
        soundsEnabled: s.soundsEnabled,
        hapticsEnabled: s.hapticsEnabled,
        themePreset: s.themePreset,
        uiStyle: normalizeUiStyle(s.uiStyle),
        labelMode: s.labelMode,
        posFavorites: s.posFavorites,
        posRecent: s.posRecent,
        posDefaultPayment: s.posDefaultPayment,
        onboardingDismissed: s.onboardingDismissed,
        onboardingCompleted: s.onboardingCompleted,
      }),
      merge: (persisted, current) => {
        const p = (persisted || {}) as Partial<PreferencesState>;
        return {
          ...current,
          ...p,
          uiStyle: normalizeUiStyle(p.uiStyle ?? current.uiStyle),
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state?.themePreset) applyThemePreset(state.themePreset);
        applyUiStyle(state?.uiStyle || 'normal');
      },
    }
  )
);

export { applyThemePreset };
