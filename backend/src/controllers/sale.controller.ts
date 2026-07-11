import { Request, Response } from 'express';
import * as saleService from '../services/sale.service';
import { success, created, paginated } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { getPagination } from '../utils/pagination';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  const { data, total } = await saleService.listSales(req.companyId, {
    ...pagination,
    branchId: req.query.branchId as string | undefined,
    from: req.query.from ? new Date(String(req.query.from)) : undefined,
    to: req.query.to ? new Date(String(req.query.to)) : undefined,
    status: req.query.status as string | undefined,
  });
  return paginated(res, data, pagination.page, pagination.limit, total);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const sale = await saleService.getSale(req.companyId, req.params.id);
  return success(res, sale);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const sale = await saleService.createSale(req.companyId, req.user!.id, req.body);
  return created(res, sale, 'Sale completed');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const sale = await saleService.deleteSale(req.companyId, req.user!.id, req.params.id, {
    reason: req.body?.reason,
  });
  return success(res, sale, 'Sale deleted — inventory restored');
});

export const refund = asyncHandler(async (req: Request, res: Response) => {
  const sale = await saleService.refundSale(req.companyId, req.user!.id, req.params.id, {
    reason: req.body?.reason,
  });
  return success(res, sale, 'Sale refunded — inventory restored');
});

export const openShift = asyncHandler(async (req: Request, res: Response) => {
  const shift = await saleService.openShift(req.companyId, req.user!.id, req.body);
  return created(res, shift, 'Shift opened');
});

export const closeShift = asyncHandler(async (req: Request, res: Response) => {
  const shift = await saleService.closeShift(
    req.companyId,
    req.user!.id,
    req.params.id,
    req.body
  );
  return success(res, shift, 'Shift closed');
});

export const currentShift = asyncHandler(async (req: Request, res: Response) => {
  const shift = await saleService.getCurrentShift(req.companyId, req.user!.id);
  return success(res, shift);
});
