import { publishNotificationEvent } from './notification-events';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationCategory = 'follows' | 'comments' | 'community' | 'liveInvitations';

function notificationDeepLink(resourceType?: string | null, resourceId?: string | null) {
  if (!resourceType || !resourceId) return 'voxa://notifications';
  const id = encodeURIComponent(resourceId);
  switch (resourceType.toLowerCase()) {
    case 'episode': return 'voxa://episodes/' + id;
    case 'creator':
    case 'profile': return 'voxa://profiles/' + id;
    case 'community':
    case 'community_post':
    case 'post': return 'voxa://communities/' + id;
    case 'live':
    case 'live_room':
    case 'room': return 'voxa://live/' + id;
    default: return 'voxa://notifications';
  }
}

async function sendExpoPush(prisma: PrismaService, notification: {
  id: string; recipientId: string; type: string; title: string; body: string | null;
  resourceType: string | null; resourceId: string | null;
}) {
  try {
    const devices = await prisma.notificationDevice.findMany({
      where: { userId: notification.recipientId, enabled: true },
      select: { id: true, expoPushToken: true },
    });
    if (!devices.length) return;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = 'Bearer ' + process.env.EXPO_ACCESS_TOKEN;
    const payload = devices.map(device => ({
      to: device.expoPushToken,
      title: notification.title,
      body: notification.body || undefined,
      sound: 'default',
      priority: notification.type.toLowerCase().includes('live') ? 'high' : 'default',
      channelId: 'voxa-notifications',
      data: {
        notificationId: notification.id,
        type: notification.type,
        resourceType: notification.resourceType,
        resourceId: notification.resourceId,
        deepLink: notificationDeepLink(notification.resourceType, notification.resourceId),
      },
    }));
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    if (!response.ok) return;
    const result = await response.json() as { data?: Array<{ status?: string; details?: { error?: string } }> };
    const tickets = Array.isArray(result.data) ? result.data : [];
    const invalidTokens = tickets.flatMap((ticket, index) =>
      ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
        ? [devices[index]?.expoPushToken].filter((token): token is string => Boolean(token))
        : [],
    );
    if (invalidTokens.length) {
      await prisma.notificationDevice.deleteMany({ where: { expoPushToken: { in: invalidTokens } } });
    }
  } catch {
    // Push delivery must never prevent an in-app notification from being saved.
  }
}

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
  await sendExpoPush(prisma, {
    id: notification.id,
    recipientId: input.recipientId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    resourceType: notification.resourceType,
    resourceId: notification.resourceId,
  });
  return notification;
}
