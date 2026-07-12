import { toast } from 'sonner';
import { usePreferencesStore } from '@/stores/preferencesStore';

/** Soft success beep (Web Audio) — only when sounds enabled */
export function playSuccessSound() {
  if (!usePreferencesStore.getState().soundsEnabled) return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.stop(ctx.currentTime + 0.2);
    window.setTimeout(() => void ctx.close(), 300);
  } catch {
    /* ignore */
  }
}

export async function hapticSuccess() {
  if (!usePreferencesStore.getState().hapticsEnabled) return;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* ignore */
  }
}

export async function hapticError() {
  if (!usePreferencesStore.getState().hapticsEnabled) return;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType.Error });
  } catch {
    /* ignore */
  }
}

/** Celebrate a completed sale / important save */
export async function celebrateSuccess(message: string, description?: string) {
  playSuccessSound();
  await hapticSuccess();
  toast.success(message, description ? { description } : undefined);
}

export async function feedbackError(message: string) {
  await hapticError();
  toast.error(message);
}
