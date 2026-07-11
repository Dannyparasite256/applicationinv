import { Request, Response } from 'express';
import { CompanyStatus } from '@prisma/client';
import * as platformService from '../services/platform.service';
import { success, paginated } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { getPagination } from '../utils/pagination';

export const overview = asyncHandler(async (req: Request, res: Response) => {
  const data = await platformService.getPlatformOverview(req.user?.isSuperAdmin);
  return success(res, data);
});

export const listCompanies = asyncHandler(async (req: Request, res: Response) => {
  // Super admin directory — allow larger pages so every registered business is visible
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(
    500,
    Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100)
  );
  const sortBy = String(req.query.sortBy || 'createdAt');
  const sortOrder = String(req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const search = req.query.search ? String(req.query.search).trim() : undefined;
  const pagination = {
    page,
    limit,
    skip: (page - 1) * limit,
    sortBy,
    sortOrder: sortOrder as 'asc' | 'desc',
    search,
  };
  const { data, total } = await platformService.listCompanies(req.user?.isSuperAdmin, {
    ...pagination,
    status: req.query.status as CompanyStatus | undefined,
    from: req.query.from ? new Date(String(req.query.from)) : undefined,
    to: req.query.to ? new Date(String(req.query.to)) : undefined,
  });
  return paginated(res, data, pagination.page, pagination.limit, total);
});

export const getCompany = asyncHandler(async (req: Request, res: Response) => {
  const data = await platformService.getCompanyDetail(req.user?.isSuperAdmin, req.params.id);
  return success(res, data);
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const data = await platformService.updateCompanyStatus(
    req.user?.isSuperAdmin,
    req.params.id,
    req.body.status as CompanyStatus,
    req.user!.id,
    req.body.note
  );
  return success(res, data, 'Company status updated');
});

export const activity = asyncHandler(async (req: Request, res: Response) => {
  const data = await platformService.getPlatformActivity(
    req.user?.isSuperAdmin,
    parseInt(String(req.query.limit || '40'), 10)
  );
  return success(res, data);
});

export const companyCredentials = asyncHandler(async (req: Request, res: Response) => {
  const data = await platformService.listCompanyCredentials(
    req.user?.isSuperAdmin,
    req.params.id
  );
  return success(res, data);
});

export const resetCompanyUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const data = await platformService.resetCompanyUserPassword(
    req.user?.isSuperAdmin,
    req.params.id,
    req.params.userId,
    req.user!.id,
    { password: req.body?.password }
  );
  return success(res, data, 'Password updated for business user');
});
