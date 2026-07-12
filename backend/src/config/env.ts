import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_NAME: z.string().default('Enterprise IMS'),
  APP_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:4000'),
  API_PREFIX: z.string().default('/api/v1'),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  BCRYPT_ROUNDS: z.coerce.number().default(12),
  ENCRYPTION_KEY: z.string().min(16),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().default('noreply@enterprise-ims.local'),
  EMAIL_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  SMS_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  OAUTH_GOOGLE_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),

  MAX_FILE_SIZE_MB: z.coerce.number().default(10),
  UPLOAD_DIR: z.string().default('uploads'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),

  SESSION_TIMEOUT_MINUTES: z.coerce.number().default(60),
  MAX_LOGIN_ATTEMPTS: z.coerce.number().default(5),
  LOCKOUT_MINUTES: z.coerce.number().default(30),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DEFAULT_TENANT_SLUG: z.string().default('demo'),

  /** ExchangeRate-API.com key — https://v6.exchangerate-api.com/v6/{KEY}/latest/{BASE} */
  EXCHANGE_RATE_API_KEY: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  if (process.env.NODE_ENV !== 'test') {
    // Allow missing secrets in test with defaults applied below
    const defaults: Record<string, string> = {
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://ims:ims_secret@localhost:5432/enterprise_ims?schema=public',
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-in-production-32',
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production-32',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'dev-encryption-key-32bytes!!',
    };
    Object.assign(process.env, defaults);
  }
}

const reparsed = envSchema.safeParse({
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://ims:ims_secret@localhost:5432/enterprise_ims?schema=public',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-in-production-32',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production-32',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'dev-encryption-key-32bytes!!',
});

if (!reparsed.success) {
  console.error('Failed to load environment:', reparsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = reparsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
