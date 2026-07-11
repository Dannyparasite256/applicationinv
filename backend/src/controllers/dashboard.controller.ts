import { Request, Response } from 'express';
import * as dashboardService from '../services/dashboard.service';
import { success } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';

export const stats = asyncHandler(async (req: Request, res: Response) => {
  const data = await dashboardService.getDashboardStats(req.companyId);
  return success(res, data);
});
