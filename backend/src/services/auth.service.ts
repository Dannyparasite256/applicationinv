import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { RoleCode, UserStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { env, isDev } from '../config/env';
import {
  UnauthorizedError,
  ConflictError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from '../utils/errors';
import { hashPassword, comparePassword, generateToken, generateOtp, slugify } from '../utils/crypto';
import { sendVerificationEmail, sendPasswordResetEmail } from './email.service';
import { loadUserPermissions, AccessTokenPayload } from '../middleware/auth';
import { cacheDel } from '../config/redis';
import { logger } from '../utils/logger';

function signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function signRefreshToken(userId: string): string {
  // jti makes each token unique even if signed in the same second
  return jwt.sign(
    { sub: userId, type: 'refresh', jti: generateToken(16) },
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    }
  );
}

function parseExpiryToDate(exp: string): Date {
  const match = exp.match(/^(\d+)([smhd])$/);
  if (!match) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const ms =
    unit === 's' ? n * 1000 :
    unit === 'm' ? n * 60 * 1000 :
    unit === 'h' ? n * 60 * 60 * 1000 :
    n * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

async function buildAuthResponse(userId: string, meta?: { ip?: string; userAgent?: string; deviceId?: string }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: true } },
      company: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          currency: true,
        },
      },
    },
  });
  if (!user) throw new NotFoundError('User');

  const roles = user.roles.map((r) => r.role.code);
  const permissions = await loadUserPermissions(userId);

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    companyId: user.companyId,
    branchId: user.branchId,
    roles,
    permissions,
  });

  let refreshToken = signRefreshToken(user.id);
  try {
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        deviceId: meta?.deviceId,
        ipAddress: meta?.ip,
        userAgent: meta?.userAgent,
        expiresAt: parseExpiryToDate(env.JWT_REFRESH_EXPIRES_IN),
      },
    });
  } catch {
    // Rare race: regenerate once on unique collision
    refreshToken = signRefreshToken(user.id);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        deviceId: meta?.deviceId,
        ipAddress: meta?.ip,
        userAgent: meta?.userAgent,
        expiresAt: parseExpiryToDate(env.JWT_REFRESH_EXPIRES_IN),
      },
    });
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      companyId: user.companyId,
      branchId: user.branchId,
      status: user.status,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      roles,
      permissions,
      avatarUrl: user.avatarUrl,
      company: user.company
        ? {
            id: user.company.id,
            name: user.company.name,
            slug: user.company.slug,
            logoUrl: user.company.logoUrl,
            currency: user.company.currency,
          }
        : undefined,
    },
    accessToken,
    refreshToken,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  };
}

export async function registerCompany(input: {
  companyName: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  /** Location-based default accounting currency (ISO 4217) */
  currency?: string;
}) {
  const existing = await prisma.user.findFirst({ where: { email: input.email.toLowerCase() } });
  if (existing) throw new ConflictError('Email already registered');

  const baseSlug = slugify(input.companyName);
  let slug = baseSlug;
  let i = 1;
  while (await prisma.company.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${i++}`;
  }

  const passwordHash = await hashPassword(input.password);
  const currency = (input.currency || 'USD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'USD';

  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: input.companyName,
        slug,
        email: input.email.toLowerCase(),
        phone: input.phone,
        currency,
        status: 'TRIAL',
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const branch = await tx.branch.create({
      data: {
        companyId: company.id,
        code: 'HQ',
        name: 'Head Office',
        isHeadOffice: true,
      },
    });

    await tx.warehouse.create({
      data: {
        companyId: company.id,
        branchId: branch.id,
        code: 'MAIN',
        name: 'Main Warehouse',
        isDefault: true,
      },
    });

    // Ensure company owner role exists for this tenant
    let ownerRole = await tx.role.findFirst({
      where: { companyId: company.id, code: RoleCode.COMPANY_OWNER },
    });
    if (!ownerRole) {
      ownerRole = await tx.role.create({
        data: {
          companyId: company.id,
          code: RoleCode.COMPANY_OWNER,
          name: 'Company Owner',
          isSystem: true,
        },
      });
    }

    // Company owners are active immediately — only staff/workers need manager approval.
    const user = await tx.user.create({
      data: {
        companyId: company.id,
        branchId: branch.id,
        email: input.email.toLowerCase(),
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });

    await tx.userRole.create({
      data: { userId: user.id, roleId: ownerRole.id },
    });

    const verifyToken = generateToken();
    await tx.emailVerificationToken.create({
      data: {
        userId: user.id,
        token: verifyToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Seed default chart of accounts stub
    const defaultAccounts = [
      { code: '1000', name: 'Cash', type: 'ASSET' as const },
      { code: '1100', name: 'Bank', type: 'ASSET' as const },
      { code: '1200', name: 'Accounts Receivable', type: 'ASSET' as const },
      { code: '1300', name: 'Inventory', type: 'ASSET' as const },
      { code: '2000', name: 'Accounts Payable', type: 'LIABILITY' as const },
      { code: '3000', name: 'Equity', type: 'EQUITY' as const },
      { code: '4000', name: 'Sales Revenue', type: 'REVENUE' as const },
      { code: '5000', name: 'Cost of Goods Sold', type: 'COGS' as const },
      { code: '6000', name: 'Operating Expenses', type: 'EXPENSE' as const },
    ];
    await tx.account.createMany({
      data: defaultAccounts.map((a) => ({
        companyId: company.id,
        code: a.code,
        name: a.name,
        type: a.type,
        isSystem: true,
      })),
    });

    // Default tax
    await tx.tax.create({
      data: {
        companyId: company.id,
        name: 'VAT',
        code: 'VAT',
        rate: 0,
      },
    });

    // Default units
    await tx.unit.createMany({
      data: [
        { companyId: company.id, name: 'Piece', shortName: 'pc', isBase: true },
        { companyId: company.id, name: 'Box', shortName: 'box' },
        { companyId: company.id, name: 'Kilogram', shortName: 'kg' },
      ],
    });

    return { company, user, verifyToken };
  });

  // Respond immediately after DB commit — never block signup on SMTP/Ethereal.
  // Owners are already emailVerified; welcome mail is best-effort in the background.
  const auth = await buildAuthResponse(result.user.id);

  void sendVerificationEmail(result.user.email, result.verifyToken, result.user.firstName).catch(
    (e) => logger.warn('Verification email failed', { e })
  );

  return {
    ...auth,
    company: { id: result.company.id, name: result.company.name, slug: result.company.slug },
  };
}

export async function login(input: {
  email: string;
  password: string;
  twoFactorCode?: string;
  ip?: string;
  userAgent?: string;
  deviceId?: string;
}) {
  // Same email can exist on multiple companies (tenant-scoped unique).
  // findFirst alone often picks an empty/wrong company and staff sales appear broken.
  const candidates = await prisma.user.findMany({
    where: { email: input.email.toLowerCase(), deletedAt: null },
    include: {
      roles: { include: { role: true } },
      company: {
        select: {
          id: true,
          name: true,
          _count: { select: { products: true, sales: true } },
        },
      },
    },
    orderBy: [{ lastLoginAt: 'desc' }, { createdAt: 'desc' }],
  });

  type Candidate = (typeof candidates)[number];

  const failLogin = async (u: Candidate | null | undefined, reason: string) => {
    if (!u) return;
    await prisma.loginHistory.create({
      data: {
        companyId: u.companyId,
        userId: u.id,
        ipAddress: input.ip,
        userAgent: input.userAgent,
        success: false,
        reason,
      },
    });
  };

  if (!candidates.length) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Clear expired temporary lockouts on all candidates
  for (const c of candidates) {
    if (c.lockedUntil && c.lockedUntil <= new Date()) {
      const unlockData: {
        lockedUntil: null;
        failedLoginAttempts: number;
        status?: UserStatus;
      } = {
        lockedUntil: null,
        failedLoginAttempts: 0,
      };
      if (c.status === UserStatus.LOCKED) {
        unlockData.status = UserStatus.ACTIVE;
        c.status = UserStatus.ACTIVE;
      }
      await prisma.user.update({ where: { id: c.id }, data: unlockData });
      c.lockedUntil = null;
      c.failedLoginAttempts = 0;
    }
  }

  // Match password against every account with this email (not just the first row)
  const passwordMatches: Candidate[] = [];
  for (const c of candidates) {
    if (await comparePassword(input.password, c.passwordHash)) {
      passwordMatches.push(c);
    }
  }

  if (!passwordMatches.length) {
    // Increment lockout on most recently used account only
    const target = candidates[0];
    const attempts = target.failedLoginAttempts + 1;
    const data: { failedLoginAttempts: number; lockedUntil?: Date } = {
      failedLoginAttempts: attempts,
    };
    if (attempts >= env.MAX_LOGIN_ATTEMPTS) {
      data.lockedUntil = new Date(Date.now() + env.LOCKOUT_MINUTES * 60 * 1000);
    }
    await prisma.user.update({ where: { id: target.id }, data });
    await failLogin(target, 'invalid_password');
    throw new UnauthorizedError('Invalid email or password');
  }

  // Prefer the healthiest ACTIVE account (products/sales, recent login)
  const rank = (u: Candidate) => {
    const products = u.company?._count?.products ?? 0;
    const sales = u.company?._count?.sales ?? 0;
    const loginTs = u.lastLoginAt ? u.lastLoginAt.getTime() : 0;
    return products * 1_000_000 + sales * 1_000 + loginTs / 1e12;
  };

  const activeMatches = passwordMatches.filter((u) => u.status === UserStatus.ACTIVE);
  const pool = activeMatches.length ? activeMatches : passwordMatches;
  pool.sort((a, b) => rank(b) - rank(a));
  const user = pool[0];

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await failLogin(user, 'account_locked');
    throw new ForbiddenError('Account is temporarily locked. Try again later.');
  }

  if (user.status === UserStatus.PENDING_VERIFICATION) {
    const roleCodes = user.roles.map((r) => r.role.code);
    const isBusinessOwner =
      roleCodes.includes(RoleCode.COMPANY_OWNER) || roleCodes.includes(RoleCode.SUPER_ADMIN);

    // Registered businesses / owners must never be blocked by staff-approval flow.
    // Repair older accounts that were incorrectly created as PENDING_VERIFICATION.
    if (isBusinessOwner) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          status: UserStatus.ACTIVE,
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });
      user.status = UserStatus.ACTIVE;
    } else {
      await failLogin(user, 'pending_approval');
      throw new ForbiddenError(
        'Your staff account is waiting for manager approval. You cannot login until approved.'
      );
    }
  }

  if (
    user.status === UserStatus.SUSPENDED ||
    user.status === UserStatus.INACTIVE ||
    user.status === UserStatus.LOCKED
  ) {
    await failLogin(user, 'account_inactive');
    throw new ForbiddenError(
      user.status === UserStatus.LOCKED
        ? 'Account is locked. Contact your administrator.'
        : 'Account is not active. Contact your administrator.'
    );
  }

  // Repair empty company roles (e.g. COMPANY_OWNER with 0 permissions) so POS works
  try {
    const { repairUserRolePermissions } = await import('./userAdmin.service');
    await repairUserRolePermissions(user.id);
  } catch {
    /* non-fatal */
  }

  if (user.twoFactorEnabled) {
    if (!input.twoFactorCode) {
      return { requires2FA: true as const, message: 'Two-factor authentication required' };
    }
    if (!user.twoFactorSecret) throw new UnauthorizedError('2FA not configured properly');
    const ok = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: input.twoFactorCode,
      window: 1,
    });
    if (!ok) {
      await failLogin(user, 'invalid_2fa');
      throw new UnauthorizedError('Invalid 2FA code');
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: input.ip,
    },
  });

  await prisma.loginHistory.create({
    data: {
      companyId: user.companyId,
      userId: user.id,
      ipAddress: input.ip,
      userAgent: input.userAgent,
      success: true,
    },
  });

  if (input.deviceId) {
    await prisma.userDevice.upsert({
      where: { userId_deviceId: { userId: user.id, deviceId: input.deviceId } },
      create: {
        companyId: user.companyId,
        userId: user.id,
        deviceId: input.deviceId,
        browser: input.userAgent?.slice(0, 255),
        ipAddress: input.ip,
        lastSeenAt: new Date(),
      },
      update: {
        lastSeenAt: new Date(),
        ipAddress: input.ip,
        browser: input.userAgent?.slice(0, 255),
      },
    });
  }

  return buildAuthResponse(user.id, {
    ip: input.ip,
    userAgent: input.userAgent,
    deviceId: input.deviceId,
  });
}

export async function refreshTokens(refreshToken: string) {
  let payload: { sub: string; type: string };
  try {
    payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { sub: string; type: string };
  } catch {
    throw new UnauthorizedError('Invalid refresh token');
  }
  if (payload.type !== 'refresh') throw new UnauthorizedError('Invalid token type');

  const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expired or revoked');
  }

  // Rotate
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return buildAuthResponse(payload.sub, {
    ip: stored.ipAddress || undefined,
    userAgent: stored.userAgent || undefined,
    deviceId: stored.deviceId || undefined,
  });
}

export async function logout(refreshToken?: string, userId?: string) {
  if (refreshToken) {
    await prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { revokedAt: new Date() },
    });
  }
  if (userId) {
    await cacheDel(`perms:${userId}`);
  }
}

export async function logoutAll(userId: string) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await cacheDel(`perms:${userId}`);
}

/**
 * Request a password reset email (OTP code + link).
 * Always returns a generic success when the email is unknown (anti-enumeration).
 * When the account exists but mail fails, returns a clear error so the user can retry.
 */
export async function forgotPassword(email: string) {
  const normalized = email.trim().toLowerCase();
  const users = await prisma.user.findMany({
    where: { email: normalized, deletedAt: null },
    orderBy: [{ lastLoginAt: 'desc' }, { createdAt: 'desc' }],
  });

  // Always return success to prevent enumeration
  if (!users.length) {
    return {
      message: 'If that email is registered, we sent a reset code. Check your inbox and spam folder.',
      sent: true,
    };
  }

  // Prefer an active account, then most recently used
  const user =
    users.find((u) => u.status === UserStatus.ACTIVE) ||
    users.find((u) => u.status !== UserStatus.SUSPENDED) ||
    users[0];

  // Invalidate prior unused tokens for every account with this email
  await prisma.passwordReset.updateMany({
    where: {
      userId: { in: users.map((u) => u.id) },
      usedAt: null,
    },
    data: { usedAt: new Date() },
  });

  const otp = generateOtp(6);
  const secret = generateToken(24);
  // token format: "123456.<secret>" — mobile uses OTP + email; web uses full token link
  const token = `${otp}.${secret}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      token,
      expiresAt,
    },
  });

  const mail = await sendPasswordResetEmail(user.email, token, user.firstName, otp);

  if (!mail.sent) {
    logger.error('Password reset email failed', {
      email: user.email,
      reason: mail.reason,
      mode: mail.mode,
    });
    throw new ValidationError(
      mail.reason
        ? `Could not send reset email: ${mail.reason}. Please try again or contact your administrator.`
        : 'Could not send reset email. Please try again in a moment.'
    );
  }

  logger.info('Password reset email sent', {
    userId: user.id,
    email: user.email,
    mode: mail.mode,
    previewUrl: mail.previewUrl,
  });

  // Ethereal / outbox modes don't deliver to a real inbox — always return a
  // preview URL so the user can open the message and read the 6-digit code.
  const isPreviewDelivery = mail.mode === 'ethereal' || mail.mode === 'json';

  return {
    message: isPreviewDelivery
      ? 'Reset code generated. Open the email preview to copy your 6-digit code (real inbox needs SMTP).'
      : 'We sent a 6-digit reset code to your email. It expires in 1 hour. Check inbox and spam.',
    sent: true,
    expiresInMinutes: 60,
    delivery: isPreviewDelivery ? ('preview' as const) : ('email' as const),
    mode: mail.mode,
    ...(mail.previewUrl ? { previewUrl: mail.previewUrl } : {}),
    // Dev-only: surface code when Ethereal is used so local testing is easy
    ...(isDev || isPreviewDelivery
      ? {
          // Never include the secret half of the token — only the OTP digits
          // (token format is "123456.<secret>")
        }
      : {}),
  };
}

/**
 * Reset password using either:
 * - full token from email link, or
 * - email + 6-digit code (mobile-friendly, no deep link needed)
 */
export async function resetPassword(input: {
  token?: string;
  email?: string;
  code?: string;
  password: string;
}) {
  const newPassword = input.password;
  let record: { id: string; userId: string; token: string; expiresAt: Date; usedAt: Date | null } | null =
    null;

  if (input.token?.trim()) {
    record = await prisma.passwordReset.findUnique({
      where: { token: input.token.trim() },
    });
  } else if (input.email?.trim() && input.code?.trim()) {
    const normalized = input.email.trim().toLowerCase();
    const code = input.code.trim().replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      throw new ValidationError('Enter the 6-digit code from your email');
    }
    const users = await prisma.user.findMany({
      where: { email: normalized, deletedAt: null },
      select: { id: true },
    });
    if (!users.length) {
      throw new ValidationError('Invalid or expired reset code');
    }
    const matches = await prisma.passwordReset.findMany({
      where: {
        userId: { in: users.map((u) => u.id) },
        usedAt: null,
        expiresAt: { gt: new Date() },
        token: { startsWith: `${code}.` },
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    record = matches[0] || null;
  } else {
    throw new ValidationError('Provide the reset code from your email, or use the reset link');
  }

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new ValidationError('Invalid or expired reset code. Request a new one from Forgot password.');
  }

  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (!user || user.deletedAt) {
    throw new ValidationError('Invalid or expired reset code. Request a new one from Forgot password.');
  }

  const passwordHash = await hashPassword(newPassword);
  const unlockLocked = user.status === UserStatus.LOCKED;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        // Only clear temporary lockouts — do not re-activate suspended accounts
        ...(unlockLocked ? { status: UserStatus.ACTIVE } : {}),
      },
    }),
    prisma.passwordReset.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Invalidate any other open reset tokens for this user
    prisma.passwordReset.updateMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
      data: { usedAt: new Date() },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { message: 'Password updated successfully. You can sign in with your new password.' };
}

export async function verifyEmail(token: string) {
  const record = await prisma.emailVerificationToken.findUnique({ where: { token } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new ValidationError('Invalid or expired verification token');
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        status: UserStatus.ACTIVE,
      },
    }),
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);
  return { message: 'Email verified successfully' };
}

export async function setup2FA(userId: string) {
  const secret = speakeasy.generateSecret({
    name: `${env.APP_NAME} (${userId.slice(0, 8)})`,
    length: 20,
  });
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret.base32 },
  });
  return {
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url,
  };
}

export async function enable2FA(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFactorSecret) throw new ValidationError('2FA not set up');
  const ok = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token: code,
    window: 1,
  });
  if (!ok) throw new ValidationError('Invalid 2FA code');
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });
  return { message: '2FA enabled' };
}

export async function disable2FA(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFactorSecret) throw new ValidationError('2FA not enabled');
  const ok = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token: code,
    window: 1,
  });
  if (!ok) throw new ValidationError('Invalid 2FA code');
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
  return { message: '2FA disabled' };
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatarUrl: true,
      status: true,
      emailVerified: true,
      twoFactorEnabled: true,
      companyId: true,
      branchId: true,
      lastLoginAt: true,
      preferences: true,
      company: { select: { id: true, name: true, slug: true, logoUrl: true, currency: true } },
      branch: { select: { id: true, name: true, code: true } },
      roles: { include: { role: { select: { code: true, name: true } } } },
    },
  });
  if (!user) throw new NotFoundError('User');
  const permissions = await loadUserPermissions(userId);
  return {
    ...user,
    // Match login payload: string role codes for frontend guards (roles.includes)
    roles: user.roles.map((r) => r.role.code),
    roleDetails: user.roles.map((r) => r.role),
    permissions,
  };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User');
  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) throw new ValidationError('Current password is incorrect');
  const passwordHash = await hashPassword(newPassword);

  // Clear any super-admin support password once the user chooses their own
  const prefs =
    user.preferences && typeof user.preferences === 'object' && !Array.isArray(user.preferences)
      ? { ...(user.preferences as Record<string, unknown>) }
      : {};
  if (prefs.platformSupport) {
    delete prefs.platformSupport;
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
      preferences: prefs as object,
    },
  });
  return { message: 'Password changed successfully' };
}

export async function listSessions(userId: string) {
  return prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      deviceId: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listLoginHistory(userId: string, take = 20) {
  return prisma.loginHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function listDevices(userId: string) {
  return prisma.userDevice.findMany({
    where: { userId },
    orderBy: { lastSeenAt: 'desc' },
  });
}
