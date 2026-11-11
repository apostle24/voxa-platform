import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      notification: { findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
      notificationPreference: { upsert: jest.fn() },
    };
    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  it('returns only the signed-in user notifications and their unread count', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 'notice-1', title: 'A new follower' }]);
    prisma.notification.count.mockResolvedValue(2);
    const result = await service.list('user-1');
    expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recipientId: 'user-1' }, take: 50,
    }));
    expect(result).toEqual({ items: [{ id: 'notice-1', title: 'A new follower' }], unreadCount: 2 });
  });

  it('creates default notification preferences for a first-time user', async () => {
    prisma.notificationPreference.upsert.mockResolvedValue({
      follows: true, comments: true, community: true, liveInvitations: true,
    });
    await service.getPreferences('user-1');
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' }, create: { userId: 'user-1' },
    }));
  });

  it('updates only the supplied preference fields', async () => {
    prisma.notificationPreference.upsert.mockResolvedValue({
      follows: false, comments: true, community: true, liveInvitations: true,
    });
    await service.updatePreferences('user-1', { follows: false });
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' }, update: { follows: false },
    }));
  });

  it('marks a notification read only for its recipient', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.markRead('user-1', 'notice-1')).resolves.toEqual({ id: 'notice-1', read: true });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'notice-1', recipientId: 'user-1', readAt: null },
    }));
  });

  it('does not reveal another user notification', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.markRead('user-1', 'private-notice')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'private-notice', recipientId: 'user-1' },
    }));
  });

  it('marks all of the current user unread notifications as read', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.markAllRead('user-1')).resolves.toEqual({ updated: 3 });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { recipientId: 'user-1', readAt: null }, data: expect.objectContaining({ readAt: expect.any(Date) }),
    });
  });
});
