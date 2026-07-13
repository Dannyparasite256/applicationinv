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
  const [rows, agg] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { expenseDate: 'desc' },
      take: opts?.limit ?? 200,
    }),
    prisma.expense.aggregate({ where, _sum: { amount: true }, _count: true }),
  ]);
  return {
    from,
    to,
    total: roundMoney(Number(agg._sum.amount || 0)),
    count: typeof agg._count === 'number' ? agg._count : Number(agg._count || 0),
    rows: rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
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
  return prisma.expense.create({
    data: {
      companyId: cid,
      category,
      description: input.description?.trim() || null,
      amount: roundMoney(amount),
      expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
      paymentMethod: input.paymentMethod || null,
      reference: input.reference || null,
      notes: input.notes || null,
      createdBy: userId,
    },
  });
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
