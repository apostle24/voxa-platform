import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreatorDto } from './dto/create-creator.dto';

@Injectable()
export class CreatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async onboard(userId: string, input: CreateCreatorDto) {
    const handle = input.handle.trim().toLowerCase();
    const existing = await this.prisma.creator.findUnique({ where: { handle } });
    if (existing) throw new ConflictException('Creator handle is already taken');

    const current = await this.prisma.creator.findUnique({ where: { userId } });
    if (current) throw new ConflictException('This account already has a creator profile');

    return this.prisma.$transaction(async (tx) => {
      const creator = await tx.creator.create({
        data: { userId, handle, bio: input.bio?.trim() || null },
        select: {
          id: true,
          handle: true,
          bio: true,
          createdAt: true,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { role: 'CREATOR' },
      });
      return creator;
    });
  }

  async updateMyProfile(userId: string, bio?: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId }, select: { id: true } });
    if (!creator) throw new NotFoundException('Create a creator profile first');
    return this.prisma.creator.update({
      where: { userId },
      data: { bio: bio?.trim() || null },
      select: { id: true, handle: true, bio: true, verifiedAt: true, createdAt: true },
    });
  }

  async getByHandle(handle: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { handle: handle.toLowerCase() },
      select: {
        id: true,
        handle: true,
        bio: true,
        verifiedAt: true,
        createdAt: true,
        user: {
          select: {
            displayName: true,
            liveRooms: { where: { status: 'LIVE', visibility: 'PUBLIC' }, orderBy: { startedAt: 'desc' }, take: 3,
              select: { id: true, title: true, description: true, startedAt: true } },
          },
        },
        shows: {
          where: { status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' }, take: 12,
          select: { id: true, title: true, description: true, artworkUrl: true, category: true, publishedAt: true,
            _count: { select: { episodes: true } } },
        },
        _count: { select: { followers: true, shows: true } },
      },
    });
    if (!creator) throw new NotFoundException('Creator not found');
    return {
      ...creator,
      followerCount: creator._count.followers,
      showCount: creator._count.shows,
      _count: undefined,
    };
  }

  async getFollowStatus(userId: string, handle: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { handle: handle.toLowerCase() },
      select: { id: true, userId: true },
    });
    if (!creator) throw new NotFoundException('Creator not found');
    if (creator.userId === userId) return { following: false, isOwnProfile: true };
    const follow = await this.prisma.follow.findUnique({
      where: { followerId_creatorId: { followerId: userId, creatorId: creator.id } },
      select: { followerId: true },
    });
    return { following: Boolean(follow), isOwnProfile: false };
  }

  async follow(userId: string, handle: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { handle: handle.toLowerCase() },
      select: { id: true, userId: true },
    });
    if (!creator) throw new NotFoundException('Creator not found');
    if (creator.userId === userId) throw new ConflictException('You cannot follow your own creator profile');

    const existing = await this.prisma.follow.findUnique({ where: { followerId_creatorId: { followerId: userId, creatorId: creator.id } }, select: { followerId: true } });
    await this.prisma.follow.upsert({
      where: { followerId_creatorId: { followerId: userId, creatorId: creator.id } },
      create: { followerId: userId, creatorId: creator.id },
      update: {},
    });
    if (!existing) {
      await this.prisma.notification.create({ data: {
        recipientId: creator.userId, actorId: userId, type: 'NEW_FOLLOWER',
        title: 'You have a new follower', body: 'Someone started following your creator profile.',
        resourceType: 'creator', resourceId: creator.id,
      } });
    }
    return { following: true, creatorHandle: handle.toLowerCase() };
  }

  async unfollow(userId: string, handle: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { handle: handle.toLowerCase() },
      select: { id: true },
    });
    if (!creator) throw new NotFoundException('Creator not found');
    await this.prisma.follow.deleteMany({
      where: { followerId: userId, creatorId: creator.id },
    });
    return { following: false, creatorHandle: handle.toLowerCase() };
  }
}
