import { PrismaService } from '../prisma/prisma.service';
import { createUserNotification } from './notification-writer';
import { notificationEventBus } from './notification-events';

describe('createUserNotification', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = {
      notificationPreference: { findUnique: jest.fn() },
      notification: { create: jest.fn() },
      notificationDevice: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    };
  });

  it('honors a disabled category preference', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue({
      follows: false, comments: true, community: true, liveInvitations: true,
    });
    await expect(createUserNotification(prisma as unknown as PrismaService, {
      recipientId: 'creator-1', actorId: 'listener-1', type: 'NEW_FOLLOWER',
      title: 'New follower', category: 'follows',
    })).resolves.toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('delivers when the category is enabled or preferences do not exist yet', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: 'notice-1', title: 'New follower' });
    const publish = jest.spyOn(notificationEventBus, 'emit');
    await expect(createUserNotification(prisma as unknown as PrismaService, {
      recipientId: 'creator-1', actorId: 'listener-1', type: 'NEW_FOLLOWER',
      title: 'New follower', category: 'follows',
    })).resolves.toEqual({ id: 'notice-1', title: 'New follower' });
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ recipientId: 'creator-1', actorId: 'listener-1', type: 'NEW_FOLLOWER' }),
    }));
    expect(publish).toHaveBeenCalledWith('notification.created', expect.objectContaining({ recipientId: 'creator-1', notification: expect.objectContaining({ id: 'notice-1' }) }));
    publish.mockRestore();
  });

  it('sends a push payload with a deep link to registered devices', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({
      id: 'notice-episode', recipientId: 'creator-1', type: 'NEW_COMMENT',
      title: 'New episode comment', body: 'Someone replied', resourceType: 'episode',
      resourceId: 'episode-7',
    });
    prisma.notificationDevice.findMany.mockResolvedValue([
      { id: 'device-1', expoPushToken: 'ExponentPushToken[test]' },
    ]);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ data: [{ status: 'ok', id: 'ticket-1' }] }),
    } as Response);
    try {
      await createUserNotification(prisma as unknown as PrismaService, {
        recipientId: 'creator-1', actorId: 'listener-1', type: 'NEW_COMMENT',
        title: 'New episode comment', body: 'Someone replied',
        resourceType: 'episode', resourceId: 'episode-7', category: 'comments',
      });
      expect(fetchMock).toHaveBeenCalledWith('https://exp.host/--/api/v2/push/send', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('voxa://episodes/episode-7'),
      }));
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('does not create notifications for the actor themselves', async () => {
    await expect(createUserNotification(prisma as unknown as PrismaService, {
      recipientId: 'user-1', actorId: 'user-1', type: 'COMMENT',
      title: 'Comment', category: 'comments',
    })).resolves.toBeNull();
    expect(prisma.notificationPreference.findUnique).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});
