import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';
import { LiveService } from '../live/live.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: any;
  let live: { disconnectUserFromLiveRooms: jest.Mock };

  beforeEach(() => {
    live = { disconnectUserFromLiveRooms: jest.fn().mockResolvedValue({ attempted: 0, disconnected: 0, failedRoomIds: [] }) };
    prisma = {
      user: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
      authSession: { updateMany: jest.fn() },
      notification: { create: jest.fn() },
      episode: { findFirst: jest.fn() },
      moment: { findFirst: jest.fn() },
      liveRoom: { findFirst: jest.fn() },
      contentReport: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      moderationAction: { findFirst: jest.fn(), create: jest.fn() },
      communityPost: { findFirst: jest.fn() },
      userBlock: { upsert: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
    };
    service = new ReportsService(prisma as unknown as PrismaService, live as unknown as LiveService);
  });

  it('creates a community post report when the target exists', async () => {
    prisma.communityPost.findFirst.mockResolvedValue({ id: 'post-1' });
    prisma.contentReport.findFirst.mockResolvedValue(null);
    prisma.contentReport.create.mockResolvedValue({ id: 'report-post', targetType: 'COMMUNITY_POST', targetId: 'post-1', status: 'NEW' });
    await expect(service.create('reporter-1', { targetType: 'COMMUNITY_POST', targetId: 'post-1', reason: 'SPAM' }))
      .resolves.toMatchObject({ id: 'report-post', duplicate: false });
  });

  it('blocks another account and prevents self-blocking', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1' });
    prisma.userBlock.upsert.mockResolvedValue({ id: 'block-1', blockedUserId: 'target-1' });
    await expect(service.blockUser('user-1', 'target-1')).resolves.toMatchObject({ blocked: true, blockedUserId: 'target-1' });
    await expect(service.blockUser('user-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('unblocks only the account selected by the current user', async () => {
    prisma.userBlock.deleteMany.mockResolvedValue({ count: 1 });
    await expect(service.unblockUser('user-1', 'target-1')).resolves.toEqual({ blocked: false, removed: true });
    expect(prisma.userBlock.deleteMany).toHaveBeenCalledWith({ where: { blockerId: 'user-1', blockedUserId: 'target-1' } });
  });

  it('accepts a report only for published episodes', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);
    await expect(service.create('reporter-1', {
      targetType: 'EPISODE', targetId: 'episode-1', reason: 'SPAM',
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.contentReport.create).not.toHaveBeenCalled();
  });

  it('prevents users from reporting their own account', async () => {
    await expect(service.create('user-1', {
      targetType: 'USER', targetId: 'user-1', reason: 'OTHER',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents duplicate open reports for the same target within 24 hours', async () => {
    prisma.episode.findFirst.mockResolvedValue({ id: 'episode-1' });
    prisma.contentReport.findFirst.mockResolvedValue({ id: 'report-existing' });
    await expect(service.create('reporter-1', {
      targetType: 'EPISODE', targetId: 'episode-1', reason: 'SPAM',
    })).resolves.toMatchObject({ id: 'report-existing', duplicate: true });
    expect(prisma.contentReport.create).not.toHaveBeenCalled();
  });

  it('does not allow listeners to access the moderation queue', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'LISTENER' });
    await expect(service.listForModeration('user-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.contentReport.findMany).not.toHaveBeenCalled();
  });

  it('allows moderators to review reports and records the reviewer', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'MODERATOR' });
    prisma.contentReport.findUnique.mockResolvedValue({ id: 'report-1', status: 'NEW' });
    prisma.contentReport.update.mockResolvedValue({
      id: 'report-1', status: 'ACTIONED', moderatorNote: 'Removed under policy', reviewedAt: new Date(),
    });
    await expect(service.review('moderator-1', 'report-1', {
      status: 'ACTIONED', moderatorNote: 'Removed under policy',
    })).resolves.toMatchObject({ id: 'report-1', status: 'ACTIONED' });
    expect(prisma.contentReport.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'report-1' },
      data: expect.objectContaining({ reviewerId: 'moderator-1', status: 'ACTIONED' }),
    }));
  });

  it('does not reopen a closed report', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.contentReport.findUnique.mockResolvedValue({ id: 'report-1', status: 'DISMISSED' });
    await expect(service.review('admin-1', 'report-1', { status: 'REVIEWING' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.contentReport.update).not.toHaveBeenCalled();
  });
  it('hides a reported published episode and writes an audit record atomically', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'MODERATOR' });
    prisma.contentReport.findUnique.mockResolvedValue({ id: 'report-1', status: 'REVIEWING', targetType: 'EPISODE', targetId: 'episode-1' });
    prisma.episode.findUnique = jest.fn().mockResolvedValue({ id: 'episode-1', status: 'PUBLISHED' });
    prisma.episode.update = jest.fn().mockResolvedValue({ id: 'episode-1', status: 'ARCHIVED' });
    prisma.moderationAction.create.mockResolvedValue({ id: 'action-1' });
    prisma.contentReport.update.mockResolvedValue({ id: 'report-1', status: 'ACTIONED' });
    await expect(service.applyContentAction('moderator-1', 'report-1', {
      action: 'HIDE_EPISODE', reason: 'Confirmed policy violation after review',
    })).resolves.toMatchObject({ action: 'HIDE_EPISODE', status: 'ACTIONED' });
    expect(prisma.episode.update).toHaveBeenCalledWith({ where: { id: 'episode-1' }, data: { status: 'ARCHIVED' } });
    expect(prisma.moderationAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: 'moderator-1', reportId: 'report-1', targetType: 'EPISODE', targetId: 'episode-1', action: 'HIDE_EPISODE',
    }) });
  });

  it('suspends a reported account, revokes sessions and records the action atomically', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'MODERATOR' })
      .mockResolvedValueOnce({ id: 'reported-user', role: 'LISTENER', suspendedUntil: null });
    prisma.contentReport.findUnique.mockResolvedValue({
      id: 'report-user', status: 'REVIEWING', targetType: 'USER', targetId: 'reported-user',
    });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.authSession.updateMany.mockResolvedValue({ count: 2 });
    prisma.moderationAction.create.mockResolvedValue({ id: 'account-action' });
    prisma.contentReport.update.mockResolvedValue({ id: 'report-user', status: 'ACTIONED' });

    await expect(service.applyAccountAction('moderator-1', 'report-user', {
      action: 'SUSPEND_USER', reason: 'Repeated targeted harassment', suspensionDays: 7,
    })).resolves.toMatchObject({ action: 'SUSPEND_USER', status: 'ACTIONED', targetType: 'USER' });

    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'reported-user' }),
      data: expect.objectContaining({ suspensionReason: 'Repeated targeted harassment', suspendedUntil: expect.any(Date) }),
    }));
    expect(live.disconnectUserFromLiveRooms).toHaveBeenCalledWith('reported-user');
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'reported-user', revokedAt: null }, data: { revokedAt: expect.any(Date) },
    }));
    expect(prisma.moderationAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: 'moderator-1', reportId: 'report-user', targetType: 'USER', targetId: 'reported-user', action: 'SUSPEND_USER',
    }) });
  });

  it('does not allow a moderator to suspend an administrator account', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'MODERATOR' })
      .mockResolvedValueOnce({ id: 'admin-user', role: 'ADMIN', suspendedUntil: null });
    prisma.contentReport.findUnique.mockResolvedValue({
      id: 'report-admin', status: 'REVIEWING', targetType: 'USER', targetId: 'admin-user',
    });
    await expect(service.applyAccountAction('moderator-1', 'report-admin', {
      action: 'SUSPEND_USER', reason: 'Test reason', suspensionDays: 1,
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('delivers a formal account warning in the notification inbox and records the action', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'MODERATOR' })
      .mockResolvedValueOnce({ id: 'reported-user', role: 'LISTENER', suspendedUntil: null });
    prisma.contentReport.findUnique.mockResolvedValue({
      id: 'report-warning', status: 'NEW', targetType: 'USER', targetId: 'reported-user',
    });
    prisma.moderationAction.create.mockResolvedValue({ id: 'warning-action' });
    prisma.notification.create.mockResolvedValue({ id: 'warning-notice' });
    prisma.contentReport.update.mockResolvedValue({ id: 'report-warning', status: 'ACTIONED' });

    await expect(service.applyAccountAction('moderator-1', 'report-warning', {
      action: 'WARN_USER', reason: 'Please stop sending abusive messages.',
    })).resolves.toMatchObject({ action: 'WARN_USER', status: 'ACTIONED' });

    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      recipientId: 'reported-user', actorId: 'moderator-1', type: 'MODERATION_WARNING',
      title: 'Account warning from VOXA', body: 'Please stop sending abusive messages.',
    }) });
  });
});
