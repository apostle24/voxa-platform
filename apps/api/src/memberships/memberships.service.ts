import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipSubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMembershipPlanDto } from './dto/create-membership-plan.dto';
import { UpdateMembershipPlanDto } from './dto/update-membership-plan.dto';

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublicPlans(handle: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { handle: handle.toLowerCase() },
      select: { id: true, handle: true, user: { select: { displayName: true } } },
    });
    if (!creator) throw new NotFoundException('Creator not found');
    const plans = await this.prisma.membershipPlan.findMany({
      where: { creatorId: creator.id, isActive: true },
      orderBy: [{ priceMinor: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, description: true, priceMinor: true, currency: true, interval: true },
    });
    return { creator, plans };
  }

  async createPlan(userId: string, input: CreateMembershipPlanDto) {
    const creator = await this.prisma.creator.findUnique({ where: { userId }, select: { id: true } });
    if (!creator) throw new ForbiddenException('Create a creator profile before setting up memberships');
    return this.prisma.membershipPlan.create({
      data: {
        creatorId: creator.id,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        priceMinor: input.priceMinor,
        currency: input.currency,
      },
      select: { id: true, name: true, description: true, priceMinor: true, currency: true, interval: true, isActive: true, createdAt: true },
    });
  }

  async updatePlan(userId: string, planId: string, input: UpdateMembershipPlanDto) {
    const plan = await this.prisma.membershipPlan.findFirst({
      where: { id: planId, creator: { userId } },
      select: { id: true },
    });
    if (!plan) throw new NotFoundException('Membership plan not found');
    return this.prisma.membershipPlan.update({
      where: { id: planId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
        ...(input.priceMinor !== undefined ? { priceMinor: input.priceMinor } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: { id: true, name: true, description: true, priceMinor: true, currency: true, interval: true, isActive: true, updatedAt: true },
    });
  }

  async myMemberships(userId: string) {
    const now = new Date();
    return this.prisma.membershipSubscription.findMany({
      where: { subscriberId: userId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, cancelAtPeriodEnd: true,
        creator: { select: { handle: true, user: { select: { displayName: true } } } },
        plan: { select: { id: true, name: true, priceMinor: true, currency: true, interval: true } },
      },
    }).then(items => items.map(item => ({
      ...item,
      accessActive: item.status === MembershipSubscriptionStatus.ACTIVE && !!item.currentPeriodEnd && item.currentPeriodEnd > now,
    })));
  }

  async creatorMemberships(userId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId }, select: { id: true } });
    if (!creator) throw new ForbiddenException('Creator profile required');
    return this.prisma.membershipSubscription.findMany({
      where: { creatorId: creator.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, createdAt: true,
        subscriber: { select: { id: true, displayName: true } },
        plan: { select: { name: true, priceMinor: true, currency: true } },
      },
    });
  }

  async hasActiveMembership(userId: string, creatorId: string) {
    const subscription = await this.prisma.membershipSubscription.findFirst({
      where: {
        subscriberId: userId,
        creatorId,
        status: MembershipSubscriptionStatus.ACTIVE,
        currentPeriodEnd: { gt: new Date() },
      },
      select: { id: true },
    });
    return !!subscription;
  }

  async requireActiveMembership(userId: string, creatorId: string) {
    if (!(await this.hasActiveMembership(userId, creatorId))) {
      throw new ForbiddenException('An active creator membership is required to access this episode');
    }
  }
}
