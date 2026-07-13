import { Request, Response } from 'express';
import * as dashboardService from '../services/dashboard.service';
import { success } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { parseQueryDateRange } from '../utils/dateRange';

export const stats = asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = parseQueryDateRange(req);
  const branchId =
    typeof req.query.branchId === 'string' && req.query.branchId.trim()
      ? req.query.branchId.trim()
      : undefined;
  const data = await dashboardService.getDashboardStats(req.companyId, {
    from,
    to,
    branchId,
  });
  return success(res, data);
});
