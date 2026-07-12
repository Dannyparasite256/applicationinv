import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { success } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';

export const getCompany = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  const company = await prisma.company.findFirst({
    where: { id: req.companyId, deletedAt: null },
    include: {
      branches: { where: { deletedAt: null } },
      warehouses: { where: { deletedAt: null } },
      taxes: true,
      currencies: true,
    },
  });
  if (!company) throw new NotFoundError('Company');
  return success(res, company);
});

/** Upload business profile / brand logo (multipart field: "logo") */
export const uploadLogo = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) throw new ValidationError('Choose an image file for your business logo');

  const logoUrl = `/uploads/logos/${file.filename}`;
  const company = await prisma.company.update({
    where: { id: req.companyId },
    data: { logoUrl },
  });
  return success(res, company, 'Business logo updated');
});

export const updateCompany = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  const allowed = [
    'name',
    'legalName',
    'registrationNo',
    'taxId',
    'email',
    'phone',
    'website',
    'address',
    'city',
    'state',
    'country',
    'postalCode',
    'currency',
    'timezone',
    'locale',
    'logoUrl',
    'settings',
    'branding',
  ] as const;
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  // Changing base currency rebases FX rates for the whole company
  if (typeof data.currency === 'string' && data.currency.trim()) {
    const { setBaseCurrency } = await import('../services/currency.service');
    await setBaseCurrency(req.companyId, String(data.currency).toUpperCase());
    delete data.currency; // already applied via setBaseCurrency
  }
  const company =
    Object.keys(data).length > 0
      ? await prisma.company.update({ where: { id: req.companyId }, data })
      : await prisma.company.findUniqueOrThrow({ where: { id: req.companyId } });
  return success(res, company, 'Company updated');
});

export const listBranches = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  const branches = await prisma.branch.findMany({
    where: { companyId: req.companyId, deletedAt: null },
    orderBy: { name: 'asc' },
  });
  return success(res, branches);
});

export const listWarehouses = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  const warehouses = await prisma.warehouse.findMany({
    where: { companyId: req.companyId, deletedAt: null },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  });
  return success(res, warehouses);
});

export const listAccounts = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  const accounts = await prisma.account.findMany({
    where: { companyId: req.companyId, isActive: true },
    orderBy: { code: 'asc' },
  });
  return success(res, accounts);
});

export const listEmployees = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  const employees = await prisma.employee.findMany({
    where: { companyId: req.companyId, deletedAt: null },
    include: { department: true, branch: true },
    orderBy: { lastName: 'asc' },
  });
  return success(res, employees);
});

/** Tenant activity feed — recent audit events for this company */
export const listActivity = asyncHandler(async (req: Request, res: Response) => {
  if (!req.companyId) throw new ForbiddenError('Company context required');
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const logs = await prisma.auditLog.findMany({
    where: { companyId: req.companyId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });
  return success(res, logs);
});

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return success(res, notifications);
});

export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user!.id },
    data: { status: 'READ', readAt: new Date() },
  });
  return success(res, null, 'Marked as read');
});

/** Email system status + optional test send (settings admins). */
export const emailStatus = asyncHandler(async (req: Request, res: Response) => {
  const { getEmailStatus, sendEmail } = await import('../services/email.service');
  const status = getEmailStatus();
  const testTo = typeof req.query.to === 'string' ? req.query.to : undefined;
  if (req.method === 'POST' && testTo) {
    const result = await sendEmail({
      to: testTo,
      subject: `${status.from} — Test email from Enterprise IMS`,
      html: `<p>This is a test email from <strong>Enterprise IMS</strong>.</p>
             <p>Mode: ${status.mode}</p>
             <p>If you received this, outbound email is working.</p>`,
      text: 'Test email from Enterprise IMS — outbound mail is working.',
    });
    return success(res, { status, result }, result.sent ? 'Test email sent' : 'Test email not sent');
  }
  return success(res, status);
});

/** Register a mobile/web push device token (FCM / APNs / web-push). */
export const registerDevice = asyncHandler(async (req: Request, res: Response) => {
  const { token, platform, deviceId } = req.body as {
    token?: string;
    platform?: string;
    deviceId?: string;
  };
  if (!token) {
    return success(res, { registered: false }, 'No token provided');
  }
  // Persist as a system notification log entry for ops visibility until a full
  // DeviceToken table / FCM worker is wired. Tokens are also stored client-side.
  await prisma.notification.create({
    data: {
      userId: req.user!.id,
      companyId: req.companyId || undefined,
      title: 'Device registered for push',
      body: `${platform || 'unknown'} · ${deviceId || 'no-device-id'} · ${token.slice(0, 24)}…`,
      channel: 'IN_APP',
      status: 'READ',
      readAt: new Date(),
      data: { token, platform, deviceId },
    },
  }).catch(() => undefined);

  return success(res, { registered: true, platform: platform || null }, 'Device registered');
});
