import { Request, Response } from 'express';
import * as customerService from '../services/customer.service';
import { success, created, paginated } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { getPagination } from '../utils/pagination';

export const listCustomers = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  const { data, total } = await customerService.listCustomers(req.companyId, pagination);
  return paginated(res, data, pagination.page, pagination.limit, total);
});

export const createCustomer = asyncHandler(async (req: Request, res: Response) => {
  const data = await customerService.createCustomer(req.companyId, req.body);
  return created(res, data);
});

export const getCustomer = asyncHandler(async (req: Request, res: Response) => {
  const data = await customerService.getCustomer(req.companyId, req.params.id);
  return success(res, data);
});

export const updateCustomer = asyncHandler(async (req: Request, res: Response) => {
  const data = await customerService.updateCustomer(req.companyId, req.params.id, req.body);
  return success(res, data, 'Customer updated');
});

export const listSuppliers = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  const { data, total } = await customerService.listSuppliers(req.companyId, pagination);
  return paginated(res, data, pagination.page, pagination.limit, total);
});

export const createSupplier = asyncHandler(async (req: Request, res: Response) => {
  const data = await customerService.createSupplier(req.companyId, req.body);
  return created(res, data);
});
