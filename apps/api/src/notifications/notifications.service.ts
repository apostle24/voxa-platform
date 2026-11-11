import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, unreadOnly = false) {
    const where = { recipientId: userId, ...(unreadOnly ? { readAt: null } : {}) };
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where, orderBy: { createdAt: 'desc' }, take: 50,
        select: { id: true, type: true, title: true, body: true, resourceType: true, resourceId: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: { recipientId: userId, readAt: null } }),
    ]);
    return { items, unreadCount };
  }

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { userId }, create: { userId }, update: {},
      select: { follows: true, comments: true, community: true, liveInvitations: true, updatedAt: true },
    });
  }

  async updatePreferences(userId: string, input: { follows?: boolean; comments?: boolean; community?: boolean; liveInvitations?: boolean }) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
      select: { follows: true, comments: true, community: true, liveInvitations: true, updatedAt: true },
    });
  }

  async registerDevice(userId: string, input: { expoPushToken: string; platform: string; deviceName?: string }) {
    return this.prisma.notificationDevice.upsert({
      where: { expoPushToken: input.expoPushToken },
      create: {
        userId, expoPushToken: input.expoPushToken, platform: input.platform,
        deviceName: input.deviceName, enabled: true, lastRegisteredAt: new Date(),
      },
      update: {
        userId, platform: input.platform, deviceName: input.deviceName,
        enabled: true, lastRegisteredAt: new Date(),
      },
      select: { id: true, platform: true, enabled: true, lastRegisteredAt: true },
    });
  }

  async unregisterDevice(userId: string, expoPushToken: string) {
    const result = await this.prisma.notificationDevice.deleteMany({
      where: { userId, expoPushToken },
    });
    return { removed: result.count > 0 };
  }

  async markRead(userId: string, notificationId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (!result.count) {
      const exists = await this.prisma.notification.findFirst({ where: { id: notificationId, recipientId: userId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Notification not found');
    }
    return { id: notificationId, read: true };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null }, data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
