import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { isProd } from '../config/env';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, {
        code: err.code,
        stack: err.stack,
        path: req.path,
        method: req.method,
        requestId: req.requestId,
      });
    }
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  // Malformed JSON body from clients / proxies
  if (
    err instanceof SyntaxError ||
    (err as Error & { type?: string; status?: number }).type === 'entity.parse.failed' ||
    (err as Error & { status?: number }).status === 400
  ) {
    const msg = err.message || '';
    if (
      msg.includes('JSON') ||
      msg.includes('Unexpected token') ||
      msg === 'request aborted' ||
      (err as Error & { type?: string }).type === 'entity.parse.failed'
    ) {
      res.status(400).json({
        success: false,
        message: msg === 'request aborted' ? 'Request aborted' : 'Invalid JSON body',
        code: 'BAD_REQUEST',
      });
      return;
    }
  }

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId: req.requestId,
  });

  res.status(500).json({
    success: false,
    message: isProd ? 'Internal server error' : err.message,
    code: 'INTERNAL_ERROR',
    ...(!isProd && err.stack ? { stack: err.stack } : {}),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    code: 'ROUTE_NOT_FOUND',
  });
}
