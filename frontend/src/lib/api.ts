import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { getApiBaseUrl, isNativeApp } from '@/lib/config';

const API_BASE = getApiBaseUrl();

/** Free-tier cloud APIs can take 30–60s+ to wake; allow longer + retries. */
const API_TIMEOUT_MS = 90_000;
const MAX_NETWORK_RETRIES = 2;

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: API_TIMEOUT_MS,
});

function unreachableMessage(): string {
  if (isNativeApp()) {
    return 'Cannot reach the server. Check your internet connection. If you use a local/dev API, ensure the PC is online.';
  }
  return 'Cannot reach the server. The cloud API may be waking up — wait 30–60 seconds and try again.';
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  const deviceId = localStorage.getItem('deviceId');
  if (deviceId) {
    config.headers['X-Device-Id'] = deviceId;
  }
  // Let the browser set multipart boundary for FormData (logo uploads)
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    if (config.headers && typeof config.headers === 'object') {
      delete (config.headers as Record<string, unknown>)['Content-Type'];
      // Axios v1 may store as AxiosHeaders
      if (typeof (config.headers as { delete?: (k: string) => void }).delete === 'function') {
        (config.headers as { delete: (k: string) => void }).delete('Content-Type');
      }
    }
  }
  return config;
});

let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<{ message?: string }>) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
      _networkRetry?: number;
    };
    const url = String(original?.url || '');
    // Never try token refresh on public auth endpoints (login / forgot / reset / register)
    const isPublicAuth =
      /\/auth\/(login|register|refresh|forgot-password|reset-password|verify-email)/i.test(url);

    // Retry transient network / cold-start failures (Render free tier sleep)
    if (
      original &&
      !error.response &&
      (error.code === 'ECONNABORTED' ||
        error.code === 'ERR_NETWORK' ||
        /network|timeout/i.test(error.message || ''))
    ) {
      const attempt = original._networkRetry || 0;
      if (attempt < MAX_NETWORK_RETRIES) {
        original._networkRetry = attempt + 1;
        const delayMs = 1500 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delayMs));
        return api(original);
      }
    }

    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !isPublicAuth
    ) {
      original._retry = true;
      const { refreshToken, setTokens, logout } = useAuthStore.getState();
      if (!refreshToken) {
        logout();
        return Promise.reject(error);
      }
      try {
        if (!refreshing) {
          refreshing = api
            .post('/auth/refresh', { refreshToken })
            .then((r) => {
              const data = r.data.data;
              setTokens(data.accessToken, data.refreshToken);
              return data.accessToken as string;
            })
            .catch(() => {
              logout();
              return null;
            })
            .finally(() => {
              refreshing = null;
            });
        }
        const token = await refreshing;
        if (token) {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        }
      } catch {
        logout();
      }
    }
    // Friendlier offline / unreachable API message (web cold-start vs native)
    if (!error.response && error.message) {
      const msg = error.message.toLowerCase();
      if (msg.includes('network') || msg.includes('timeout') || error.code === 'ECONNABORTED') {
        return Promise.reject(new Error(unreachableMessage()));
      }
    }
    return Promise.reject(error);
  }
);

export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      const code = error.code || '';
      if (code === 'ECONNABORTED' || error.message.toLowerCase().includes('timeout')) {
        return isNativeApp()
          ? 'Request timed out. Check your connection and try again.'
          : 'Server is slow to respond (it may be waking up). Wait a moment and retry.';
      }
      if (
        error.message.toLowerCase().includes('network') ||
        code === 'ERR_NETWORK'
      ) {
        return unreachableMessage();
      }
    }
    const data = error.response?.data as {
      message?: string;
      details?: Array<{ path?: string; message?: string }>;
    } | undefined;
    const base = data?.message || error.message || 'Request failed';
    if (data?.details?.length) {
      const first = data.details[0];
      const detail = first.message || '';
      const path = first.path ? `${first.path}: ` : '';
      if (detail && !base.includes(detail)) return `${base} — ${path}${detail}`;
    }
    return base;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
