import { PrismaService } from '../prisma/prisma.service';
import { createUserNotification } from './notification-writer';

describe('createUserNotification', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = {
      notificationPreference: { findUnique: jest.fn() },
      notification: { create: jest.fn() },
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
    prisma.notification.create.mockResolvedValue({ id: 'notice-1' });
    await expect(createUserNotification(prisma as unknown as PrismaService, {
      recipientId: 'creator-1', actorId: 'listener-1', type: 'NEW_FOLLOWER',
      title: 'New follower', category: 'follows',
    })).resolves.toEqual({ id: 'notice-1' });
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ recipientId: 'creator-1', actorId: 'listener-1', type: 'NEW_FOLLOWER' }),
    }));
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
