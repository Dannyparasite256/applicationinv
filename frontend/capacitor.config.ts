import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Enterprise IMS — Android (and iOS) native shell via Capacitor.
 *
 * Dev (emulator): API at http://10.0.2.2:4000 (host machine localhost)
 * Dev (device):   set VITE_NATIVE_API_URL to your PC LAN IP, e.g. http://192.168.1.10:4000/api/v1
 * Prod:           set VITE_API_URL to your HTTPS API
 */
const config: CapacitorConfig = {
  appId: 'com.enterprise.ims',
  appName: 'Enterprise IMS',
  webDir: 'dist',
  server: {
    // Use http for local/dev so WebView can call cleartext LAN/USB-tunnel APIs
    // without mixed-content blocks (switch to https for production builds).
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#0f172a',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#0f172a',
      showSpinner: false,
      androidSplashResourceName: 'splash',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f172a',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
