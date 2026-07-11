import { Capacitor } from '@capacitor/core';

export interface LocalNotifyOptions {
  title: string;
  body: string;
  id?: number;
  extra?: Record<string, unknown>;
}

/** Show a local notification (native) or browser Notification / toast-friendly no-op */
export async function notifyLocal(opts: LocalNotifyOptions): Promise<void> {
  const id = opts.id ?? Math.floor(Math.random() * 100000);

  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title: opts.title,
            body: opts.body,
            schedule: { at: new Date(Date.now() + 300) },
            extra: opts.extra,
          },
        ],
      });
      return;
    } catch {
      /* fall through to web */
    }
  }

  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }
      if (permission === 'granted') {
        new Notification(opts.title, {
          body: opts.body,
          icon: '/favicon.svg',
          tag: `eims-${id}`,
        });
      }
    } catch {
      /* ignore */
    }
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const result = await LocalNotifications.requestPermissions();
      return result.display === 'granted';
    } catch {
      return false;
    }
  }
  if (typeof window !== 'undefined' && 'Notification' in window) {
    const p = await Notification.requestPermission();
    return p === 'granted';
  }
  return false;
}
