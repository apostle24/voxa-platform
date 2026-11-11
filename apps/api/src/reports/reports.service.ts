import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LiveService } from '../live/live.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly live: LiveService) {}

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
    if (type === 'COMMUNITY_POST') {
      return !!(await this.prisma.communityPost.findFirst({ where: { id }, select: { id: true } }));
    }
    if (type === 'USER') {
      if (id === reporterId) throw new BadRequestException('You cannot report your own account');
      return !!(await this.prisma.user.findUnique({ where: { id }, select: { id: true } }));
    }
    return false;
  }

  async blockUser(userId: string, blockedUserId: string) {
    if (userId === blockedUserId) throw new BadRequestException('You cannot block your own account');
    const target = await this.prisma.user.findUnique({ where: { id: blockedUserId }, select: { id: true } });
    if (!target) throw new NotFoundException('Account not found');
    const block = await this.prisma.userBlock.upsert({
      where: { blockerId_blockedUserId: { blockerId: userId, blockedUserId } },
      create: { blockerId: userId, blockedUserId },
      update: {},
      select: { id: true, blockedUserId: true, createdAt: true },
    });
    return { blocked: true, ...block };
  }

  async unblockUser(userId: string, blockedUserId: string) {
    const result = await this.prisma.userBlock.deleteMany({ where: { blockerId: userId, blockedUserId } });
    return { blocked: false, removed: result.count > 0 };
  }

  async listBlockedUsers(userId: string) {
    return this.prisma.userBlock.findMany({
      where: { blockerId: userId }, orderBy: { createdAt: 'desc' },
      select: { blockedUserId: true, createdAt: true, blockedUser: { select: { displayName: true, creator: { select: { handle: true } } } } },
    });
  }

  async create(userId: string, input: {
    targetType: 'EPISODE' | 'MOMENT' | 'LIVE_ROOM' | 'USER' | 'COMMUNITY_POST';
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
      ? await this.prisma.user.findMany({ where: { id: { in: reportedUserIds } }, select: { id: true, displayName: true, suspendedUntil: true } })
      : [];
    const userNames = new Map(reportedUsers.map(user => [user.id, user.displayName]));
    return reports.map(report => ({
      ...report,
      targetLabel: report.targetType === 'USER' ? (userNames.get(report.targetId) || 'Account no longer available') : null,
      targetSuspendedUntil: report.targetType === 'USER' ? (reportedUsers.find(user => user.id === report.targetId)?.suspendedUntil || null) : null,
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

  async applyAccountAction(userId: string, reportId: string, input: {
    action: 'WARN_USER' | 'SUSPEND_USER' | 'REINSTATE_USER';
    reason: string;
    suspensionDays?: number;
  }) {
    const actor = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!actor || !['ADMIN', 'MODERATOR'].includes(actor.role)) throw new ForbiddenException('Moderator access required');
    const report = await this.prisma.contentReport.findUnique({
      where: { id: reportId },
      select: { id: true, status: true, targetType: true, targetId: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.targetType !== 'USER') throw new BadRequestException('This report is not for an account');
    const reinstate = input.action === 'REINSTATE_USER';
    if (report.status === 'DISMISSED' || (!reinstate && report.status === 'ACTIONED') || (reinstate && report.status !== 'ACTIONED')) {
      throw new BadRequestException('This report is not in a state that permits this action');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: report.targetId },
      select: { id: true, role: true, suspendedUntil: true },
    });
    if (!target) throw new NotFoundException('Reported account no longer exists');
    if (target.role === 'ADMIN' || (target.role === 'MODERATOR' && actor.role !== 'ADMIN')) {
      throw new ForbiddenException('Your role does not permit moderation of this account');
    }
    if (input.action === 'SUSPEND_USER') {
      if (![1, 7, 30].includes(input.suspensionDays || 0)) {
        throw new BadRequestException('Choose a suspension duration of 1, 7 or 30 days');
      }
      if (target.suspendedUntil && target.suspendedUntil > new Date()) {
        throw new BadRequestException('This account is already suspended');
      }
    }
    if (reinstate) {
      const previous = await this.prisma.moderationAction.findFirst({
        where: { reportId, targetType: 'USER', targetId: report.targetId, action: 'SUSPEND_USER' },
        orderBy: { createdAt: 'desc' }, select: { id: true },
      });
      if (!previous || !target.suspendedUntil) throw new BadRequestException('There is no active or recorded suspension to reverse');
    }
    const now = new Date();
    const suspendedUntil = input.action === 'SUSPEND_USER'
      ? new Date(now.getTime() + (input.suspensionDays as number) * 24 * 60 * 60 * 1000)
      : null;
    const result = await this.prisma.$transaction(async (tx) => {
      if (input.action === 'SUSPEND_USER') {
        const changed = await tx.user.updateMany({
          where: { id: target.id, OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: now } }] },
          data: { suspendedUntil, suspensionReason: input.reason.trim() },
        });
        if (changed.count !== 1) throw new BadRequestException('This account is already suspended');
        await tx.authSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now } });
      } else if (reinstate) {
        const changed = await tx.user.updateMany({
          where: { id: target.id, suspendedUntil: { not: null } },
          data: { suspendedUntil: null, suspensionReason: null },
        });
        if (changed.count !== 1) throw new BadRequestException('This account is not currently suspended');
      }
      await tx.moderationAction.create({ data: {
        actorId: userId, reportId, targetType: 'USER', targetId: target.id,
        action: input.action, reason: input.reason.trim(),
      }});
      if (input.action === 'WARN_USER') {
        await tx.notification.create({ data: {
          recipientId: target.id, actorId: userId, type: 'MODERATION_WARNING',
          title: 'Account warning from VOXA', body: input.reason.trim(),
          resourceType: 'MODERATION_REPORT', resourceId: reportId,
        }});
      }
      await tx.contentReport.update({ where: { id: reportId }, data: {
        status: 'ACTIONED', reviewerId: userId, moderatorNote: input.reason.trim(), reviewedAt: now,
      }});
      return { reportId, targetType: 'USER', targetId: target.id, action: input.action, status: 'ACTIONED', suspendedUntil };
    });
    if (input.action === 'SUSPEND_USER') {
      const liveRoomEnforcement = await this.live.disconnectUserFromLiveRooms(target.id);
      return { ...result, liveRoomEnforcement };
    }
    return result;
  }
}
