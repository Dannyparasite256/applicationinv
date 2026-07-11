import { Request, Response } from 'express';
import * as hospitalService from '../services/hospital.service';
import { success, created, paginated } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { getPagination } from '../utils/pagination';

export const listPatients = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  const { data, total } = await hospitalService.listPatients(req.companyId, pagination);
  return paginated(res, data, pagination.page, pagination.limit, total);
});

export const createPatient = asyncHandler(async (req: Request, res: Response) => {
  const data = await hospitalService.createPatient(req.companyId, req.body);
  return created(res, data);
});

export const getPatient = asyncHandler(async (req: Request, res: Response) => {
  const data = await hospitalService.getPatient(req.companyId, req.params.id);
  return success(res, data);
});

export const createAppointment = asyncHandler(async (req: Request, res: Response) => {
  const data = await hospitalService.createAppointment(req.companyId, req.body);
  return created(res, data);
});

export const createPrescription = asyncHandler(async (req: Request, res: Response) => {
  const data = await hospitalService.createPrescription(req.companyId, req.body);
  return created(res, data);
});

export const listLabOrders = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  const { data, total } = await hospitalService.listLabOrders(req.companyId, pagination);
  return paginated(res, data, pagination.page, pagination.limit, total);
});

export const createLabOrder = asyncHandler(async (req: Request, res: Response) => {
  const data = await hospitalService.createLabOrder(req.companyId, req.body);
  return created(res, data);
});
