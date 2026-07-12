import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreset = 'clean' | 'night' | 'contrast';
export type LabelMode = 'normal' | 'simple';

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
  labelMode: LabelMode;
  posFavorites: string[];
  posRecent: Array<{ id: string; at: number }>;
  posDefaultPayment: string;
  onboardingDismissed: boolean;
  onboardingCompleted: OnboardingStepId[];
  setSoundsEnabled: (v: boolean) => void;
  setHapticsEnabled: (v: boolean) => void;
  setThemePreset: (p: ThemePreset) => void;
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
  if (preset === 'night') {
    root.classList.add('dark');
  }
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set, get) => ({
      soundsEnabled: false,
      hapticsEnabled: true,
      themePreset: 'clean',
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
      onRehydrateStorage: () => (state) => {
        if (state?.themePreset) applyThemePreset(state.themePreset);
      },
    }
  )
);

export { applyThemePreset };
