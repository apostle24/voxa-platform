import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireModerator(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || !['ADMIN', 'MODERATOR'].includes(user.role)) {
      throw new ForbiddenException('Moderator access required');
    }
  }

  private async targetExists(type: string, id: string, reporterId: string) {
    if (type === 'EPISODE') {
      return !!(await this.prisma.episode.findFirst({ where: { id, status: 'PUBLISHED' }, select: { id: true } }));
    }
    if (type === 'MOMENT') {
      return !!(await this.prisma.moment.findFirst({ where: { id, status: 'PUBLISHED' }, select: { id: true } }));
    }
    if (type === 'LIVE_ROOM') {
      return !!(await this.prisma.liveRoom.findFirst({ where: { id, status: 'LIVE' }, select: { id: true } }));
    }
    if (type === 'USER') {
      if (id === reporterId) throw new BadRequestException('You cannot report your own account');
      return !!(await this.prisma.user.findUnique({ where: { id }, select: { id: true } }));
    }
    return false;
  }

  async create(userId: string, input: {
    targetType: 'EPISODE' | 'MOMENT' | 'LIVE_ROOM' | 'USER';
    targetId: string;
    reason: string;
    details?: string;
  }) {
    if (!(await this.targetExists(input.targetType, input.targetId, userId))) {
      throw new NotFoundException('The content or account could not be found');
    }
    const duplicate = await this.prisma.contentReport.findFirst({
      where: {
        reporterId: userId, targetType: input.targetType, targetId: input.targetId,
        status: { in: ['NEW', 'REVIEWING'] },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true, status: true },
    });
    if (duplicate) return { id: duplicate.id, status: duplicate.status, duplicate: true };
    const report = await this.prisma.contentReport.create({
      data: {
        reporterId: userId, targetType: input.targetType, targetId: input.targetId,
        reason: input.reason as any, details: input.details?.trim() || null,
      },
      select: { id: true, targetType: true, targetId: true, reason: true, status: true, createdAt: true },
    });
    return { ...report, duplicate: false };
  }

  async listForModeration(userId: string, status?: 'NEW' | 'REVIEWING' | 'ACTIONED' | 'DISMISSED') {
    await this.requireModerator(userId);
    const reports = await this.prisma.contentReport.findMany({
      where: status ? { status } : { status: { in: ['NEW', 'REVIEWING'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true, targetType: true, targetId: true, reason: true, details: true,
        status: true, moderatorNote: true, createdAt: true, reviewedAt: true,
        reporter: { select: { id: true, displayName: true } },
        reviewer: { select: { id: true, displayName: true } },
      },
    });
    const reportedUserIds = [...new Set(reports.filter(report => report.targetType === 'USER').map(report => report.targetId))];
    const reportedUsers = reportedUserIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: reportedUserIds } }, select: { id: true, displayName: true } })
      : [];
    const userNames = new Map(reportedUsers.map(user => [user.id, user.displayName]));
    return reports.map(report => ({
      ...report,
      targetLabel: report.targetType === 'USER' ? (userNames.get(report.targetId) || 'Account no longer available') : null,
    }));
  }

  async review(userId: string, reportId: string, input: {
    status: 'REVIEWING' | 'ACTIONED' | 'DISMISSED';
    moderatorNote?: string;
  }) {
    await this.requireModerator(userId);
    const report = await this.prisma.contentReport.findUnique({ where: { id: reportId }, select: { id: true, status: true } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status === 'ACTIONED' || report.status === 'DISMISSED') {
      throw new BadRequestException('This report has already been closed');
    }
    return this.prisma.contentReport.update({
      where: { id: reportId },
      data: {
        status: input.status,
        reviewerId: userId,
        moderatorNote: input.moderatorNote?.trim() || null,
        reviewedAt: input.status === 'ACTIONED' || input.status === 'DISMISSED' ? new Date() : null,
      },
      select: { id: true, status: true, moderatorNote: true, reviewedAt: true },
    });
  }

  async applyContentAction(userId: string, reportId: string, input: {
    action: 'HIDE_EPISODE' | 'RESTORE_EPISODE' | 'HIDE_MOMENT' | 'RESTORE_MOMENT';
    reason: string;
  }) {
    await this.requireModerator(userId);
    const report = await this.prisma.contentReport.findUnique({
      where: { id: reportId },
      select: { id: true, status: true, targetType: true, targetId: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    const isRestore = input.action.startsWith('RESTORE_');
    if (report.status === 'DISMISSED' || (report.status === 'ACTIONED' && !isRestore) || (report.status !== 'ACTIONED' && isRestore)) {
      throw new BadRequestException('This report is not in a state that permits this action');
    }
    if (isRestore) {
      const previous = await this.prisma.moderationAction.findFirst({ where: { reportId, action: { startsWith: 'HIDE_' } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      if (!previous) throw new BadRequestException('There is no recorded hide action to reverse');
    }
    const expectedType = input.action.endsWith('EPISODE') ? 'EPISODE' : 'MOMENT';
    if (report.targetType !== expectedType) throw new BadRequestException('The moderation action does not match this report target');
    const hide = input.action.startsWith('HIDE_');
    const result = await this.prisma.$transaction(async (tx) => {
      if (expectedType === 'EPISODE') {
        const target = await tx.episode.findUnique({ where: { id: report.targetId }, select: { id: true, status: true } });
        if (!target) throw new NotFoundException('Reported episode no longer exists');
        if (hide && target.status !== 'PUBLISHED') throw new BadRequestException('Only a published episode can be hidden');
        if (!hide && target.status !== 'ARCHIVED') throw new BadRequestException('Only an archived episode can be restored');
        await tx.episode.update({ where: { id: target.id }, data: { status: hide ? 'ARCHIVED' : 'PUBLISHED' } });
      } else {
        const target = await tx.moment.findUnique({ where: { id: report.targetId }, select: { id: true, status: true } });
        if (!target) throw new NotFoundException('Reported Moment no longer exists');
        if (hide && target.status !== 'PUBLISHED') throw new BadRequestException('Only a published Moment can be hidden');
        if (!hide && target.status !== 'ARCHIVED') throw new BadRequestException('Only an archived Moment can be restored');
        await tx.moment.update({ where: { id: target.id }, data: { status: hide ? 'ARCHIVED' : 'PUBLISHED' } });
      }
      await tx.moderationAction.create({ data: {
        actorId: userId, reportId, targetType: report.targetType, targetId: report.targetId,
        action: input.action, reason: input.reason.trim(),
      }});
      await tx.contentReport.update({ where: { id: reportId }, data: {
        status: hide ? 'ACTIONED' : 'REVIEWING', reviewerId: userId, moderatorNote: input.reason.trim(), reviewedAt: hide ? new Date() : null,
      }});
      return { reportId, targetType: report.targetType, targetId: report.targetId, action: input.action, status: hide ? 'ACTIONED' : 'REVIEWING' };
    });
    return result;
  }
}
