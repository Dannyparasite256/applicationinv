import { Request, Response } from 'express';
import * as purchaseService from '../services/purchase.service';
import { success, created, paginated } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { getPagination } from '../utils/pagination';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  const { data, total } = await purchaseService.listPurchases(req.companyId, pagination);
  return paginated(res, data, pagination.page, pagination.limit, total);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await purchaseService.getPurchase(req.companyId, req.params.id);
  return success(res, data);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = await purchaseService.createPurchase(req.companyId, req.user!.id, req.body);
  return created(res, data);
});

export const receive = asyncHandler(async (req: Request, res: Response) => {
  const data = await purchaseService.receivePurchase(
    req.companyId,
    req.params.id,
    req.body || {},
    req.user!.id
  );
  return success(res, data, 'Goods received');
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const status = String(req.body?.status || '');
  const data = await purchaseService.updatePurchaseStatus(req.companyId, req.params.id, status);
  return success(res, data, `Purchase marked ${status}`);
});
