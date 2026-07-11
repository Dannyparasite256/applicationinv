import { Capacitor } from '@capacitor/core';
import { requestNotificationPermission } from '@/native/notifications';

/**
 * Notification bootstrap (local only).
 *
 * Remote FCM push was removed from the Android build because
 * PushNotifications.register() hard-crashes without google-services.json:
 *   "Default FirebaseApp is not initialized"
 *
 * Local notifications still work for offline/sync alerts.
 * Re-add @capacitor/push-notifications + Firebase when you have FCM ready.
 */
export async function initPushNotifications(): Promise<void> {
  try {
    await requestNotificationPermission();
  } catch (e) {
    console.warn('Notification permission request failed', e);
  }

  // Optional: log platform for diagnostics
  if (Capacitor.isNativePlatform()) {
    document.documentElement.dataset.notifications = 'local';
  }
}
