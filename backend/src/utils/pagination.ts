import { Request } from 'express';

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search?: string;
}

export function getPagination(req: Request, defaults?: { limit?: number; sortBy?: string }): PaginationParams {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || defaults?.limit || '20'), 10) || 20));
  const sortBy = String(req.query.sortBy || defaults?.sortBy || 'createdAt');
  const sortOrder = String(req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const search = req.query.search ? String(req.query.search).trim() : undefined;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    sortBy,
    sortOrder,
    search,
  };
}

export function buildOrderBy(sortBy: string, sortOrder: 'asc' | 'desc') {
  return { [sortBy]: sortOrder } as Record<string, 'asc' | 'desc'>;
}
