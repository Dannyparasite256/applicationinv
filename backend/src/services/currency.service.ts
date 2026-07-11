import { prisma } from '../config/database';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

/** Common world currencies with symbols (subset; rates filled live) */
export const WORLD_CURRENCIES: Array<{ code: string; name: string; symbol: string }> = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵' },
  { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw' },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'Mex$' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.' },
  { code: 'XOF', name: 'West African CFA', symbol: 'CFA' },
  { code: 'XAF', name: 'Central African CFA', symbol: 'FCFA' },
];

const meta = (code: string) =>
  WORLD_CURRENCIES.find((c) => c.code === code) || {
    code,
    name: code,
    symbol: code,
  };

async function fetchJson(url: string, timeoutMs = 7000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch live mid-market rates from Frankfurter (ECB) + open.er-api fallback.
 * Returns map: currencyCode → units of `base` per 1 unit of currencyCode
 * i.e. amountBase = amountForeign * rate
 */
export async function fetchLiveRates(base: string): Promise<{
  base: string;
  date: string;
  rates: Record<string, number>;
  source: string;
}> {
  const baseCode = base.toUpperCase();

  // 1) Frankfurter (free, no key) — ECB data. Only major ISO pairs (not UGX etc.)
  try {
    const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(baseCode)}`;
    const data = (await fetchJson(url)) as {
      base: string;
      date: string;
      rates: Record<string, number>;
    };
    if (data?.rates) {
      const inverted: Record<string, number> = { [baseCode]: 1 };
      for (const [code, r] of Object.entries(data.rates)) {
        if (r > 0) inverted[code] = 1 / r;
      }
      return {
        base: baseCode,
        date: data.date || new Date().toISOString().slice(0, 10),
        rates: inverted,
        source: 'frankfurter.app (ECB)',
      };
    }
  } catch (e) {
    logger.warn('Frankfurter FX fetch failed', { e: e instanceof Error ? e.message : e, base: baseCode });
  }

  // 2) open.er-api.com (free, no key) — broader currency coverage
  try {
    const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(baseCode)}`;
    const data = (await fetchJson(url)) as {
      result: string;
      base_code: string;
      time_last_update_utc?: string;
      rates: Record<string, number>;
    };
    if (data?.result === 'success' && data.rates) {
      const inverted: Record<string, number> = { [baseCode]: 1 };
      for (const [code, r] of Object.entries(data.rates)) {
        if (r > 0) inverted[code] = 1 / r;
      }
      return {
        base: baseCode,
        date: data.time_last_update_utc || new Date().toISOString(),
        rates: inverted,
        source: 'open.er-api.com',
      };
    }
  } catch (e) {
    logger.warn('open.er-api FX fetch failed', { e: e instanceof Error ? e.message : e, base: baseCode });
  }

  // 3) Fallback: USD hub — convert via USD when base is exotic / offline partial
  if (baseCode !== 'USD') {
    try {
      const usd = await fetchLiveRates('USD');
      // We have rates as: 1 CODE = usd.rates[CODE] USD
      // Want: 1 CODE = X BASE. 1 BASE = usd.rates[BASE] USD → X = usd.rates[CODE] / usd.rates[BASE]
      const baseInUsd = usd.rates[baseCode];
      if (baseInUsd && baseInUsd > 0) {
        const inverted: Record<string, number> = { [baseCode]: 1 };
        for (const [code, rateUsd] of Object.entries(usd.rates)) {
          if (rateUsd > 0) inverted[code] = rateUsd / baseInUsd;
        }
        inverted.USD = 1 / baseInUsd; // 1 USD = 1/baseInUsd BASE
        return {
          base: baseCode,
          date: usd.date,
          rates: inverted,
          source: `${usd.source} via USD hub`,
        };
      }
    } catch (e) {
      logger.warn('USD-hub FX fallback failed', { e: e instanceof Error ? e.message : e });
    }
  }

  throw new ValidationError('Unable to fetch live exchange rates. Check internet and try again.');
}

/** Ensure company has base currency + popular set (no recursive list call). */
export async function ensureCompanyCurrencies(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { currency: true },
  });
  if (!company) throw new NotFoundError('Company');
  const base = (company.currency || 'USD').toUpperCase();

  const existing = await prisma.currency.findMany({ where: { companyId } });
  if (!existing.length) {
    const seedCodes = [
      base,
      'USD',
      'EUR',
      'GBP',
      'KES',
      'UGX',
      'TZS',
      'NGN',
      'ZAR',
      'INR',
      'AED',
      'CNY',
    ];
    const unique = [...new Set(seedCodes.map((c) => c.toUpperCase()))];
    // Concurrent first-load can race; upsert one-by-one is safer than createMany alone
    for (const code of unique) {
      const m = meta(code);
      await prisma.currency.upsert({
        where: { companyId_code: { companyId, code } },
        create: {
          companyId,
          code,
          name: m.name,
          symbol: m.symbol,
          exchangeRate: 1,
          isBase: code === base,
          isActive: true,
        },
        update: {},
      });
    }
    // fall through so base flag is corrected
  }

  // Ensure exactly one base matches company.currency
  await prisma.currency.updateMany({
    where: { companyId },
    data: { isBase: false },
  });
  const baseRow = await prisma.currency.findUnique({
    where: { companyId_code: { companyId, code: base } },
  });
  if (baseRow) {
    await prisma.currency.update({
      where: { id: baseRow.id },
      data: { isBase: true, exchangeRate: 1, isActive: true },
    });
  } else {
    const m = meta(base);
    await prisma.currency.create({
      data: {
        companyId,
        code: base,
        name: m.name,
        symbol: m.symbol,
        exchangeRate: 1,
        isBase: true,
        isActive: true,
      },
    });
  }
}

export async function listCurrencies(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  await ensureCompanyCurrencies(cid);
  const company = await prisma.company.findUnique({
    where: { id: cid },
    select: { currency: true, name: true },
  });
  const rows = await prisma.currency.findMany({
    where: { companyId: cid },
    orderBy: [{ isBase: 'desc' }, { code: 'asc' }],
  });
  return {
    baseCurrency: (company?.currency || 'USD').toUpperCase(),
    companyName: company?.name,
    currencies: rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      symbol: r.symbol,
      exchangeRate: Number(r.exchangeRate),
      isBase: r.isBase,
      isActive: r.isActive,
      lastSyncedAt: r.lastSyncedAt,
    })),
    catalog: WORLD_CURRENCIES,
  };
}

export async function refreshRates(companyId: string | null | undefined) {
  const cid = requireCompany(companyId);
  const company = await prisma.company.findUnique({
    where: { id: cid },
    select: { currency: true },
  });
  if (!company) throw new NotFoundError('Company');
  const base = (company.currency || 'USD').toUpperCase();
  await ensureCompanyCurrencies(cid);

  const live = await fetchLiveRates(base);
  const now = new Date();
  const existing = await prisma.currency.findMany({ where: { companyId: cid } });

  for (const row of existing) {
    const code = row.code.toUpperCase();
    if (code === base) {
      await prisma.currency.update({
        where: { id: row.id },
        data: { exchangeRate: 1, isBase: true, lastSyncedAt: now },
      });
      continue;
    }
    const rate = live.rates[code];
    if (rate && rate > 0) {
      await prisma.currency.update({
        where: { id: row.id },
        data: { exchangeRate: rate, lastSyncedAt: now, isActive: true },
      });
    }
  }

  // Auto-add any live currencies already in catalog that company has not enabled
  // (optional: only update existing — user enables via POST)

  logger.info('FX rates refreshed', { companyId: cid, base, source: live.source, count: existing.length });
  const list = await listCurrencies(cid);
  return { ...list, liveSource: live.source, liveDate: live.date };
}

export async function setBaseCurrency(companyId: string | null | undefined, newBase: string) {
  const cid = requireCompany(companyId);
  const code = newBase.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new ValidationError('Currency must be a 3-letter ISO code');

  const m = meta(code);
  await prisma.company.update({
    where: { id: cid },
    data: { currency: code },
  });

  await ensureCompanyCurrencies(cid);
  // Rebase all rates from live feed relative to new base
  try {
    return await refreshRates(cid);
  } catch {
    // If offline, still mark base
    await prisma.currency.updateMany({ where: { companyId: cid }, data: { isBase: false } });
    await prisma.currency.upsert({
      where: { companyId_code: { companyId: cid, code } },
      create: {
        companyId: cid,
        code,
        name: m.name,
        symbol: m.symbol,
        exchangeRate: 1,
        isBase: true,
        isActive: true,
      },
      update: { isBase: true, exchangeRate: 1, name: m.name, symbol: m.symbol, isActive: true },
    });
    return listCurrencies(cid);
  }
}

export async function upsertCurrency(
  companyId: string | null | undefined,
  input: { code: string; name?: string; symbol?: string; isActive?: boolean }
) {
  const cid = requireCompany(companyId);
  const code = input.code.toUpperCase();
  const m = meta(code);
  const company = await prisma.company.findUnique({ where: { id: cid }, select: { currency: true } });
  const base = (company?.currency || 'USD').toUpperCase();

  let rate = code === base ? 1 : 1;
  try {
    const live = await fetchLiveRates(base);
    if (live.rates[code]) rate = live.rates[code];
  } catch {
    /* keep 1 */
  }

  const row = await prisma.currency.upsert({
    where: { companyId_code: { companyId: cid, code } },
    create: {
      companyId: cid,
      code,
      name: input.name || m.name,
      symbol: input.symbol || m.symbol,
      exchangeRate: rate,
      isBase: code === base,
      isActive: input.isActive ?? true,
      lastSyncedAt: new Date(),
    },
    update: {
      name: input.name || m.name,
      symbol: input.symbol || m.symbol,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      exchangeRate: rate,
      lastSyncedAt: new Date(),
    },
  });
  return row;
}

export async function getRateMap(companyId: string): Promise<{
  base: string;
  rates: Record<string, number>; // base per 1 unit of code
}> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { currency: true },
  });
  const base = (company?.currency || 'USD').toUpperCase();
  const rows = await prisma.currency.findMany({
    where: { companyId, isActive: true },
  });
  const rates: Record<string, number> = { [base]: 1 };
  for (const r of rows) {
    rates[r.code.toUpperCase()] = Number(r.exchangeRate) || 1;
  }
  rates[base] = 1;
  return { base, rates };
}

/** Convert amount from one currency to another using company rates (base-anchored). */
export async function convertAmount(
  companyId: string | null | undefined,
  amount: number,
  from: string,
  to: string
) {
  const cid = requireCompany(companyId);
  const { base, rates } = await getRateMap(cid);
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  const fromRate = rates[f];
  const toRate = rates[t];
  if (!fromRate || !toRate) {
    throw new ValidationError(`Missing exchange rate for ${!fromRate ? f : t}. Refresh rates first.`);
  }
  // amount in base = amount * fromRate; amount in to = base / toRate
  const inBase = amount * fromRate;
  const converted = toRate === 0 ? 0 : inBase / toRate;
  return {
    amount,
    from: f,
    to: t,
    base,
    rateFromBase: fromRate,
    rateToBase: toRate,
    /** How many `to` units for 1 `from` unit */
    crossRate: fromRate / toRate,
    converted,
    formula: `${amount} ${f} × ${fromRate} / ${toRate} = ${converted} ${t}`,
  };
}

export function toBaseAmount(amount: number, currency: string, rates: Record<string, number>, base: string) {
  const code = currency.toUpperCase();
  if (code === base.toUpperCase()) return amount;
  const rate = rates[code] ?? 1;
  return amount * rate;
}

export function fromBaseAmount(amountBase: number, currency: string, rates: Record<string, number>, base: string) {
  const code = currency.toUpperCase();
  if (code === base.toUpperCase()) return amountBase;
  const rate = rates[code] ?? 1;
  return rate === 0 ? 0 : amountBase / rate;
}
