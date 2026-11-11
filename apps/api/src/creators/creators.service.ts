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

  async getFollowing(userId: string) {
    const follows = await this.prisma.follow.findMany({
      where: { followerId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        creator: {
          select: {
            id: true,
            handle: true,
            bio: true,
            verifiedAt: true,
            user: {
              select: {
                displayName: true,
                liveRooms: {
                  where: { status: 'LIVE', visibility: 'PUBLIC' },
                  orderBy: { startedAt: 'desc' },
                  take: 1,
                  select: { id: true, title: true },
                },
              },
            },
            _count: { select: { followers: true, shows: true } },
          },
        },
      },
    });
    return follows.map(({ createdAt, creator }) => ({
      followedAt: createdAt,
      id: creator.id,
      handle: creator.handle,
      bio: creator.bio,
      verifiedAt: creator.verifiedAt,
      displayName: creator.user.displayName,
      liveRoom: creator.user.liveRooms[0] || null,
      followerCount: creator._count.followers,
      showCount: creator._count.shows,
    }));
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


  async getMyAudience(userId: string, query?: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId }, select: { id: true, handle: true } });
    if (!creator) throw new NotFoundException('Create a creator profile first');
    const search = query?.trim();
    const where = { creatorId: creator.id, ...(search ? { follower: { displayName: { contains: search, mode: 'insensitive' as const } } } : {}) };
    const [total, follows] = await Promise.all([
      this.prisma.follow.count({ where }),
      this.prisma.follow.findMany({
        where, orderBy: { createdAt: 'desc' }, take: 100,
        select: { createdAt: true, follower: { select: { id: true, displayName: true, createdAt: true } } },
      }),
    ]);
    return { creator, total, returned: follows.length, hasMore: total > follows.length, followers: follows.map(({ createdAt, follower }) => ({ ...follower, followedAt: createdAt })) };
  }
  async getMyAnalytics(userId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId }, select: { id: true, handle: true } });
    if (!creator) throw new NotFoundException('Create a creator profile first');
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [followers, publishedShows, publishedEpisodes, publishedLiveReplays, totalProgress, recentProgress, completedProgress,
      activeMembers, publishedMoments, momentLikes, momentComments] = await Promise.all([
      this.prisma.follow.count({ where: { creatorId: creator.id } }),
      this.prisma.show.count({ where: { creatorId: creator.id, status: 'PUBLISHED' } }),
      this.prisma.episode.count({ where: { show: { creatorId: creator.id }, status: 'PUBLISHED' } }),
      this.prisma.episode.count({ where: { show: { creatorId: creator.id }, status: 'PUBLISHED', isLiveReplay: true } }),
      this.prisma.playbackProgress.count({ where: { episode: { show: { creatorId: creator.id } } } }),
      this.prisma.playbackProgress.count({ where: { episode: { show: { creatorId: creator.id } }, updatedAt: { gte: since } } }),
      this.prisma.playbackProgress.count({ where: { episode: { show: { creatorId: creator.id } }, completed: true } }),
      this.prisma.membershipSubscription.count({ where: { creatorId: creator.id, status: 'ACTIVE', currentPeriodEnd: { gt: now } } }),
      this.prisma.moment.count({ where: { creatorId: creator.id, status: 'PUBLISHED' } }),
      this.prisma.momentLike.count({ where: { moment: { creatorId: creator.id } } }),
      this.prisma.momentComment.count({ where: { moment: { creatorId: creator.id }, deletedAt: null } }),
    ]);
    return {
      creator,
      period: { since: since.toISOString(), until: now.toISOString(), days: 30 },
      audience: { followers, activeMembers },
      publishing: { publishedShows, publishedEpisodes, publishedLiveReplays, publishedMoments },
      listening: {
        recordedEpisodeProgressEntries: totalProgress,
        progressEntriesUpdatedLast30Days: recentProgress,
        completedEpisodeProgressEntries: completedProgress,
        metricNote: 'Progress entries are per listener and episode, not raw play events or unique listeners.',
      },
      moments: { likes: momentLikes, comments: momentComments },
      generatedAt: now.toISOString(),
    };
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
