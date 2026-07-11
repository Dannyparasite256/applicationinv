import { prisma } from '../config/database';
import { NotificationChannel } from '@prisma/client';

export async function notifyUser(input: {
  companyId?: string | null;
  userId: string;
  title: string;
  body: string;
  channel?: NotificationChannel;
  data?: object;
}) {
  return prisma.notification.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      title: input.title,
      body: input.body,
      channel: input.channel || 'IN_APP',
      status: 'SENT',
      sentAt: new Date(),
      data: input.data || undefined,
    },
  });
}

export async function notifyLowStock(companyId: string, userIds: string[], productName: string, qty: number) {
  await Promise.all(
    userIds.map((userId) =>
      notifyUser({
        companyId,
        userId,
        title: 'Low stock alert',
        body: `${productName} is low (${qty} remaining). Please reorder.`,
        data: { type: 'LOW_STOCK' },
      })
    )
  );
}
