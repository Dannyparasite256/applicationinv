import { getApiBaseUrl } from '@/lib/config';

/**
 * Resolve company logos / uploaded assets for web + Android.
 * API base is like http://host:4000/api/v1 — media lives on the API origin at /uploads/...
 */
export function getMediaUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;

  const api = getApiBaseUrl();
  // Strip /api/v1 suffix when present
  const origin = api.replace(/\/api\/v\d+\/?$/i, '').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${p}`;
}

/** Initials for company or person when no logo */
export function brandInitials(name?: string | null): string {
  if (!name?.trim()) return 'EI';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}
