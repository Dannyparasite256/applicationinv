import { api, ApiResponse } from '@/lib/api';
import { AuthUser } from '@/stores/authStore';

export interface AuthPayload {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  requires2FA?: boolean;
  company?: { id: string; name: string; slug: string };
}

export async function login(email: string, password: string, twoFactorCode?: string) {
  if (!localStorage.getItem('deviceId')) {
    localStorage.setItem('deviceId', crypto.randomUUID());
  }
  const payload: Record<string, string> = {
    email: email.trim(),
    password,
    deviceId: localStorage.getItem('deviceId') || '',
  };
  // Never send empty 2FA code — backend treats missing as "not provided"
  const code = twoFactorCode?.trim();
  if (code) payload.twoFactorCode = code;

  const { data } = await api.post<ApiResponse<AuthPayload>>('/auth/login', payload);
  return data.data;
}

export async function register(payload: {
  companyName: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  /** Location-based default currency (e.g. UGX) */
  currency?: string;
  country?: string;
}) {
  const { data } = await api.post<ApiResponse<AuthPayload>>('/auth/register', payload);
  return data.data;
}

export async function fetchMe() {
  const { data } = await api.get<ApiResponse<AuthUser>>('/auth/me');
  return data.data;
}

export async function logout(refreshToken?: string | null) {
  await api.post('/auth/logout', { refreshToken });
}

export async function forgotPassword(email: string) {
  const { data } = await api.post('/auth/forgot-password', {
    email: email.trim().toLowerCase(),
  });
  return data as {
    success: boolean;
    message?: string;
    data?: {
      message?: string;
      sent?: boolean;
      expiresInMinutes?: number;
      previewUrl?: string;
      mode?: string;
    };
  };
}

/** Reset via email link token, or email + 6-digit code from the message */
export async function resetPassword(input: {
  password: string;
  token?: string;
  email?: string;
  code?: string;
}) {
  const payload: Record<string, string> = {
    password: input.password,
  };
  if (input.token?.trim()) payload.token = input.token.trim();
  if (input.email?.trim()) payload.email = input.email.trim().toLowerCase();
  if (input.code?.trim()) payload.code = input.code.trim().replace(/\s+/g, '');

  const { data } = await api.post('/auth/reset-password', payload);
  return data as {
    success: boolean;
    message?: string;
    data?: { message?: string };
  };
}
