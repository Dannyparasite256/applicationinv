import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Asset base path:
 * - '/' for website + Capacitor (androidScheme http → http://localhost/…)
 *   Absolute paths fix blank reloads on /app/* routes (relative ./assets breaks).
 * - Set CAPACITOR_RELATIVE=1 only if you must use file:// style packaging.
 */
const useRelativeBase = process.env.CAPACITOR_RELATIVE === '1';

export default defineConfig({
  base: useRelativeBase ? './' : '/',
  plugins: [
    react(),
    ...(process.env.NO_PWA === '1'
      ? []
      : [VitePWA({
      // Do not auto-register SW — it breaks Capacitor dynamic chunks
      // ("Failed to fetch dynamically imported module") on Android WebView.
      injectRegister: false,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Enterprise IMS',
        short_name: 'EIMS',
        description: 'Enterprise Inventory Management System',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: useRelativeBase ? './' : '/',
        icons: [
          {
            src: useRelativeBase ? './favicon.svg' : '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },

      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/api/v1/products'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'products-api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/api/v1/customers'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'customers-api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 12 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/api/v1/dashboard'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'dashboard-api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'font' || request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'asset-cache',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    })]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Prefer single/few chunks with static imports so Capacitor WebView
    // never hits "Failed to fetch dynamically imported module".
    modulePreload: true,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
