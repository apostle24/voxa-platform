import { publishNotificationEvent } from './notification-events';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationCategory = 'follows' | 'comments' | 'community' | 'liveInvitations';

export async function createUserNotification(
  prisma: PrismaService,
  input: {
    recipientId: string;
    actorId?: string | null;
    type: string;
    title: string;
    body?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    category: NotificationCategory;
  },
) {
  if (!input.recipientId || input.recipientId === input.actorId) return null;
  const preferences = await prisma.notificationPreference.findUnique({
    where: { userId: input.recipientId },
    select: { follows: true, comments: true, community: true, liveInvitations: true },
  });
  if (preferences && !preferences[input.category]) return null;
  const notification = await prisma.notification.create({
    data: {
      recipientId: input.recipientId,
      actorId: input.actorId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
    },
  });
  publishNotificationEvent({ recipientId: input.recipientId, notification });
  return notification;
}
