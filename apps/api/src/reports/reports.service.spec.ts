import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      episode: { findFirst: jest.fn() },
      moment: { findFirst: jest.fn() },
      liveRoom: { findFirst: jest.fn() },
      contentReport: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      moderationAction: { findFirst: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
    };
    service = new ReportsService(prisma as unknown as PrismaService);
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
});
