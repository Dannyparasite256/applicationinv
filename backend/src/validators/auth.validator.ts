import { z } from 'zod';

export const registerSchema = z.object({
  companyName: z.string().min(2).max(200),
  email: z.string().email().max(255),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(30).optional(),
  /** Preferred ISO currency from client location (e.g. UGX, KES, USD) */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  /** Optional ISO country code from client location */
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Empty string from the form must not fail validation (only real 6-digit codes)
  twoFactorCode: z
    .string()
    .optional()
    .transform((v) => (v == null || v.trim() === '' ? undefined : v.trim()))
    .pipe(z.string().length(6, '2FA code must be 6 digits').optional()),
  deviceId: z
    .string()
    .max(200)
    .optional()
    .nullable()
    .transform((v) => (v == null || v === '' ? undefined : v)),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email address').max(255),
});

const passwordRules = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

/** Accept either full link token OR email + 6-digit code */
export const resetPasswordSchema = z
  .object({
    token: z.string().min(1).optional(),
    email: z.string().email().optional(),
    code: z
      .string()
      .optional()
      .transform((v) => (v == null ? undefined : v.replace(/\s+/g, '').trim())),
    password: passwordRules,
  })
  .superRefine((val, ctx) => {
    const hasToken = Boolean(val.token?.trim());
    const hasCode = Boolean(val.email?.trim() && val.code?.trim());
    if (!hasToken && !hasCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide the 6-digit email code (with your email) or the reset link token',
        path: ['code'],
      });
    }
    if (val.code && !/^\d{6}$/.test(val.code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Reset code must be 6 digits',
        path: ['code'],
      });
    }
  });

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[0-9]/, 'Password must contain a number'),
});

export const twoFactorCodeSchema = z.object({
  code: z.string().length(6),
});
