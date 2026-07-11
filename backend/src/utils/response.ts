import { Response } from 'express';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function success<T>(
  res: Response,
  data: T,
  message = 'Success',
  statusCode = 200,
  meta?: PaginationMeta | Record<string, unknown>
) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
  });
}

export function created<T>(res: Response, data: T, message = 'Created') {
  return success(res, data, message, 201);
}

export function paginated<T>(
  res: Response,
  data: T[],
  page: number,
  limit: number,
  total: number,
  message = 'Success'
) {
  const totalPages = Math.ceil(total / limit) || 1;
  return success(res, data, message, 200, {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  });
}

export function fail(
  res: Response,
  message: string,
  statusCode = 400,
  code = 'ERROR',
  details?: unknown
) {
  return res.status(statusCode).json({
    success: false,
    message,
    code,
    ...(details !== undefined ? { details } : {}),
  });
}
