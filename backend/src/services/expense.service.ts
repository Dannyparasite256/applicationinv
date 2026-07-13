import { prisma } from '../config/database';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { endOfDay, startOfMonth } from 'date-fns';
import { roundMoney } from '../utils/profit';

function requireCompany(companyId?: string | null): string {
  if (!companyId) throw new ForbiddenError('Company context required');
  return companyId;
}

export const EXPENSE_CATEGORIES = [
  'rent',
  'salaries',
  'utilities',
  'transport',
  'supplies',
  'marketing',
  'maintenance',
  'taxes_fees',
  'other',
] as const;

/**
 * Expenses are entered 1:1 in the currency the user selected (top bar).
 * They are converted to company base only for storage so P&L matches sales/COGS.
 * Rates: base units per 1 unit of `code` (same convention as sales/products).
 */
async function resolveCompanyBase(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { currency: true },
  });
  return (company?.currency || 'USD').toUpperCase();
}

async function toBaseAmount(
  companyId: string,
  amount: number,
  currencyCode?: string | null
): Promise<{ amountBase: number; baseCurrency: string; inputCurrency: string }> {
  const baseCurrency = await resolveCompanyBase(companyId);
  const inputCurrency =
    (currencyCode || baseCurrency).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) ||
    baseCurrency;

  // Already in base, or no currency sent → 1:1 store as typed
  if (inputCurrency === baseCurrency) {
    return { amountBase: roundMoney(amount), baseCurrency, inputCurrency };
  }

  const row = await prisma.currency.findFirst({
    where: { companyId, code: inputCurrency, isActive: true },
    select: { exchangeRate: true },
  });
  const rate = Number(row?.exchangeRate);
  // Missing / invalid rate → keep 1:1 (amount as typed) so the UI never blocks the user
  if (!Number.isFinite(rate) || rate <= 0) {
    return { amountBase: roundMoney(amount), baseCurrency, inputCurrency };
  }
  // rate = base units per 1 unit of the selected currency
  return {
    amountBase: roundMoney(amount * rate),
    baseCurrency,
    inputCurrency,
  };
}

export async function listExpenses(
  companyId: string | null | undefined,
  opts?: { from?: Date; to?: Date; category?: string; limit?: number }
) {
  const cid = requireCompany(companyId);
  const from = opts?.from || startOfMonth(new Date());
  const to = opts?.to || endOfDay(new Date());
  const where = {
    companyId: cid,
    deletedAt: null,
    expenseDate: { gte: from, lte: to },
    ...(opts?.category ? { category: opts.category } : {}),
  };
  const [rows, agg, baseCurrency] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { expenseDate: 'desc' },
      take: opts?.limit ?? 200,
    }),
    prisma.expense.aggregate({ where, _sum: { amount: true }, _count: true }),
    resolveCompanyBase(cid),
  ]);
  return {
    from,
    to,
    /** Company default / base currency — all amounts are in this currency */
    currency: baseCurrency,
    baseCurrency,
    total: roundMoney(Number(agg._sum.amount || 0)),
    count: typeof agg._count === 'number' ? agg._count : Number(agg._count || 0),
    rows: rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      currency: baseCurrency,
    })),
  };
}

export async function createExpense(
  companyId: string | null | undefined,
  userId: string,
  input: {
    category?: string;
    description?: string | null;
    amount: number;
    /**
     * Currency the amount is typed in (user's selected / display currency).
     * Amount is 1:1 in that currency; converted to company base only for storage.
     */
    currency?: string | null;
    expenseDate?: Date | string | null;
    paymentMethod?: string | null;
    reference?: string | null;
    notes?: string | null;
  }
) {
  const cid = requireCompany(companyId);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('Expense amount must be greater than zero');
  }
  const category = (input.category || 'other').toLowerCase();
  const { amountBase, baseCurrency } = await toBaseAmount(cid, amount, input.currency);

  const row = await prisma.expense.create({
    data: {
      companyId: cid,
      category,
      description: input.description?.trim() || null,
      // Always company default (base) currency for profit calculations
      amount: amountBase,
      expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
      paymentMethod: input.paymentMethod || null,
      reference: input.reference || null,
      notes: input.notes || null,
      createdBy: userId,
    },
  });

  return {
    ...row,
    amount: Number(row.amount),
    currency: baseCurrency,
    baseCurrency,
  };
}

export async function deleteExpense(companyId: string | null | undefined, id: string) {
  const cid = requireCompany(companyId);
  const row = await prisma.expense.findFirst({
    where: { id, companyId: cid, deletedAt: null },
  });
  if (!row) throw new NotFoundError('Expense');
  return prisma.expense.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export async function sumExpenses(
  companyId: string,
  from: Date,
  to: Date
): Promise<number> {
  const agg = await prisma.expense.aggregate({
    where: {
      companyId,
      deletedAt: null,
      expenseDate: { gte: from, lte: to },
    },
    _sum: { amount: true },
  });
  return roundMoney(Number(agg._sum.amount || 0));
}
