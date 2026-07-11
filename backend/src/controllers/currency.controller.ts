import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { success } from '../utils/response';
import * as currencyService from '../services/currency.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  return success(res, await currencyService.listCurrencies(req.companyId));
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  return success(res, await currencyService.refreshRates(req.companyId), 'Exchange rates updated');
});

export const setBase = asyncHandler(async (req: Request, res: Response) => {
  const code = req.body?.code || req.body?.currency;
  return success(
    res,
    await currencyService.setBaseCurrency(req.companyId, code),
    `Base currency set to ${String(code).toUpperCase()}`
  );
});

export const upsert = asyncHandler(async (req: Request, res: Response) => {
  const row = await currencyService.upsertCurrency(req.companyId, req.body);
  return success(res, row, 'Currency saved');
});

export const convert = asyncHandler(async (req: Request, res: Response) => {
  const amount = Number(req.query.amount ?? req.body?.amount ?? 0);
  const from = String(req.query.from ?? req.body?.from ?? 'USD');
  const to = String(req.query.to ?? req.body?.to ?? 'USD');
  return success(res, await currencyService.convertAmount(req.companyId, amount, from, to));
});

export const live = asyncHandler(async (req: Request, res: Response) => {
  const base = String(req.query.base || 'USD').toUpperCase();
  return success(res, await currencyService.fetchLiveRates(base));
});
