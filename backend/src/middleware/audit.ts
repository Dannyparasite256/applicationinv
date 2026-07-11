import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function auditLog(module: string, action?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!AUDITED_METHODS.has(req.method)) {
      next();
      return;
    }

    const start = Date.now();
    res.on('finish', () => {
      if (res.statusCode >= 400) return;

      const act = action || `${req.method} ${req.route?.path || req.path}`;
      prisma.auditLog
        .create({
          data: {
            companyId: req.companyId || req.user?.companyId || null,
            userId: req.user?.id || null,
            action: act,
            module,
            entityType: req.params.id ? module : null,
            entityId: req.params.id || null,
            newValues: req.method !== 'DELETE' ? sanitizeBody(req.body) : undefined,
            ipAddress: req.ip,
            userAgent: req.get('user-agent') || undefined,
          },
        })
        .catch((err) => logger.warn('Audit log failed', { err: err.message, ms: Date.now() - start }));
    });

    next();
  };
}

function sanitizeBody(body: unknown): object | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const clone = { ...(body as Record<string, unknown>) };
  for (const key of ['password', 'passwordHash', 'token', 'refreshToken', 'twoFactorSecret', 'currentPassword', 'newPassword']) {
    if (key in clone) clone[key] = '[REDACTED]';
  }
  return clone;
}
