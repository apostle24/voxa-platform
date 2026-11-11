import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PublicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShowDto } from './dto/create-show.dto';
import { UpdateShowDto } from './dto/update-show.dto';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { UpdateEpisodeDto } from './dto/update-episode.dto';

@Injectable()
export class ShowsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireCreator(userId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId }, select: { id: true } });
    if (!creator) throw new ForbiddenException('Create a creator profile before publishing a show');
    return creator;
  }

  private async requireOwnedShow(userId: string, showId: string) {
    const show = await this.prisma.show.findFirst({
      where: { id: showId, creator: { userId } },
      select: { id: true, status: true },
    });
    if (!show) throw new NotFoundException('Show not found');
    return show;
  }

  async listMyShows(userId: string) {
    const creator = await this.requireCreator(userId);
    return this.prisma.show.findMany({
      where: { creatorId: creator.id },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true, title: true, description: true, status: true, category: true,
        artworkUrl: true, publishedAt: true, updatedAt: true,
        episodes: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, title: true, description: true, artworkUrl: true, status: true,
            durationSeconds: true, mediaKey: true, membershipRequired: true, publishedAt: true,
            mediaAssets: {
              orderBy: { createdAt: 'desc' }, take: 1,
              select: { id: true, status: true, contentType: true },
            },
          },
        },
      },
    });
  }

  async createShow(userId: string, input: CreateShowDto) {
    const creator = await this.requireCreator(userId);
    return this.prisma.show.create({
      data: {
        creatorId: creator.id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        language: input.language?.trim() || 'en',
        category: input.category?.trim() || null,
        artworkUrl: input.artworkUrl || null,
      },
      select: { id: true, title: true, description: true, status: true, createdAt: true },
    });
  }

  async updateShow(userId: string, showId: string, input: UpdateShowDto) {
    await this.requireOwnedShow(userId, showId);
    return this.prisma.show.update({
      where: { id: showId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
        ...(input.language !== undefined ? { language: input.language.trim() } : {}),
        ...(input.category !== undefined ? { category: input.category.trim() || null } : {}),
        ...(input.artworkUrl !== undefined ? { artworkUrl: input.artworkUrl || null } : {}),
      },
      select: { id: true, title: true, description: true, category: true, artworkUrl: true, status: true, updatedAt: true },
    });
  }

  async publishShow(userId: string, showId: string) {
    await this.requireOwnedShow(userId, showId);
    const show = await this.prisma.show.findUniqueOrThrow({ where: { id: showId } });
    if (!show.title.trim()) throw new ConflictException('A show title is required');
    return this.prisma.show.update({
      where: { id: showId },
      data: { status: PublicationStatus.PUBLISHED, publishedAt: show.publishedAt ?? new Date() },
      select: { id: true, title: true, status: true, publishedAt: true },
    });
  }

  async createEpisode(userId: string, showId: string, input: CreateEpisodeDto) {
    await this.requireOwnedShow(userId, showId);
    return this.prisma.episode.create({
      data: {
        showId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        artworkUrl: input.artworkUrl || null,
        durationSeconds: input.durationSeconds,
        isExplicit: input.isExplicit ?? false,
      },
      select: { id: true, showId: true, title: true, status: true, createdAt: true },
    });
  }

  async updateEpisode(userId: string, showId: string, episodeId: string, input: UpdateEpisodeDto) {
    await this.requireOwnedShow(userId, showId);
    const episode = await this.prisma.episode.findFirst({ where: { id: episodeId, showId }, select: { id: true, status: true } });
    if (!episode) throw new NotFoundException('Episode not found');
    if (episode.status === PublicationStatus.PUBLISHED) {
      throw new ConflictException('Published episodes are locked from editing in this release');
    }
    return this.prisma.episode.update({
      where: { id: episodeId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
        ...(input.artworkUrl !== undefined ? { artworkUrl: input.artworkUrl || null } : {}),
        ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
        ...(input.isExplicit !== undefined ? { isExplicit: input.isExplicit } : {}),
      },
      select: { id: true, title: true, description: true, status: true, updatedAt: true },
    });
  }

  async publishEpisode(userId: string, showId: string, episodeId: string) {
    const show = await this.requireOwnedShow(userId, showId);
    if (show.status !== PublicationStatus.PUBLISHED) throw new ConflictException('Publish the show before publishing episodes');
    const episode = await this.prisma.episode.findFirst({ where: { id: episodeId, showId } });
    if (!episode) throw new NotFoundException('Episode not found');
    if (!episode.mediaKey) throw new ConflictException('A media asset must be attached before publishing');
    if (!episode.durationSeconds) throw new ConflictException('Episode duration is required before publishing');
    const readyAsset = await this.prisma.mediaAsset.findFirst({
      where: { episodeId, objectKey: episode.mediaKey, status: 'READY', playbackKey: { not: null } },
      select: { id: true },
    });
    if (!readyAsset) throw new ConflictException('Media processing must finish successfully before publishing');
    return this.prisma.episode.update({
      where: { id: episodeId },
      data: { status: PublicationStatus.PUBLISHED, publishedAt: episode.publishedAt ?? new Date() },
      select: { id: true, showId: true, title: true, status: true, publishedAt: true },
    });
  }

  async setEpisodeMembership(userId: string, showId: string, episodeId: string, required: boolean) {
    await this.requireOwnedShow(userId, showId);
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, showId },
      select: { id: true },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    if (required) {
      const creator = await this.prisma.creator.findFirst({
        where: { userId },
        select: { id: true, membershipPlans: { where: { isActive: true }, select: { id: true }, take: 1 } },
      });
      if (!creator?.membershipPlans.length) {
        throw new ConflictException('Create an active membership plan before restricting an episode');
      }
    }
    return this.prisma.episode.update({
      where: { id: episodeId },
      data: { membershipRequired: required },
      select: { id: true, title: true, membershipRequired: true, updatedAt: true },
    });
  }

  async getShow(showId: string) {
    const show = await this.prisma.show.findFirst({
      where: { id: showId, status: PublicationStatus.PUBLISHED },
      select: {
        id: true, title: true, description: true, language: true, category: true, artworkUrl: true, publishedAt: true,
        creator: { select: { handle: true, user: { select: { displayName: true } } } },
        episodes: {
          where: { status: PublicationStatus.PUBLISHED },
          orderBy: { publishedAt: 'desc' },
          select: { id: true, title: true, description: true, artworkUrl: true, durationSeconds: true, isExplicit: true, membershipRequired: true, isLiveReplay: true, publishedAt: true },
        },
      },
    });
    if (!show) throw new NotFoundException('Show not found');
    return show;
  }

  async getEpisode(episodeId: string) {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, status: PublicationStatus.PUBLISHED, show: { status: PublicationStatus.PUBLISHED } },
      select: {
        id: true, title: true, description: true, mediaKey: true, artworkUrl: true, durationSeconds: true, isExplicit: true, membershipRequired: true, isLiveReplay: true, publishedAt: true,
        show: { select: { id: true, title: true, creator: { select: { handle: true, user: { select: { displayName: true } } } } } },
      },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    return episode;
  }

  async getEpisodeChapters(episodeId: string, userId?: string) {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, status: PublicationStatus.PUBLISHED, show: { status: PublicationStatus.PUBLISHED } },
      select: { id: true, durationSeconds: true, membershipRequired: true, show: { select: { creator: { select: { id: true, userId: true } } } } },
    });
    if (!episode) throw new NotFoundException('Published episode not found');
    if (episode.membershipRequired && episode.show.creator.userId !== userId) {
      if (!userId) throw new ForbiddenException('Sign in and join this creator membership to access chapters');
      const subscription = await this.prisma.membershipSubscription.findFirst({
        where: { subscriberId: userId, creatorId: episode.show.creator.id, status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } },
        select: { id: true },
      });
      if (!subscription) throw new ForbiddenException('An active creator membership is required to access these chapters');
    }
    return this.prisma.episodeChapter.findMany({
      where: { episodeId }, orderBy: [{ position: 'asc' }, { startSeconds: 'asc' }],
      select: { id: true, title: true, startSeconds: true, position: true },
    });
  }

  async getCreatorEpisodeChapters(userId: string, showId: string, episodeId: string) {
    await this.requireOwnedShow(userId, showId);
    const episode = await this.prisma.episode.findFirst({ where: { id: episodeId, showId }, select: { id: true } });
    if (!episode) throw new NotFoundException('Episode not found');
    return this.prisma.episodeChapter.findMany({
      where: { episodeId }, orderBy: [{ position: 'asc' }, { startSeconds: 'asc' }],
      select: { id: true, title: true, startSeconds: true, position: true },
    });
  }

  async saveEpisodeChapters(userId: string, showId: string, episodeId: string, chapters: Array<{ title: string; startSeconds: number }>) {
    await this.requireOwnedShow(userId, showId);
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, showId }, select: { id: true, durationSeconds: true },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    if (!Array.isArray(chapters) || chapters.length > 100) throw new ConflictException('An episode can have up to 100 chapters');
    const normalized = chapters.map((chapter, position) => ({
      title: typeof chapter?.title === 'string' ? chapter.title.trim() : '',
      startSeconds: Number(chapter?.startSeconds),
      position,
    }));
    for (const chapter of normalized) {
      if (!chapter.title || chapter.title.length > 100) throw new ConflictException('Each chapter needs a title of 1–100 characters');
      if (!Number.isInteger(chapter.startSeconds) || chapter.startSeconds < 0 ||
          (episode.durationSeconds != null && chapter.startSeconds >= episode.durationSeconds)) {
        throw new ConflictException('Chapter timestamps must be whole seconds within the episode duration');
      }
    }
    normalized.sort((a, b) => a.startSeconds - b.startSeconds);
    if (normalized.some((chapter, index) => index > 0 && chapter.startSeconds === normalized[index - 1].startSeconds)) {
      throw new ConflictException('Chapter timestamps must be unique');
    }
    const ordered = normalized.map((chapter, position) => ({ ...chapter, position }));
    await this.prisma.$transaction([
      this.prisma.episodeChapter.deleteMany({ where: { episodeId } }),
      ...(ordered.length ? [this.prisma.episodeChapter.createMany({ data: ordered.map(chapter => ({ ...chapter, episodeId })) })] : []),
    ]);
    return this.prisma.episodeChapter.findMany({
      where: { episodeId }, orderBy: [{ position: 'asc' }],
      select: { id: true, title: true, startSeconds: true, position: true },
    });
  }

  async getEpisodeIntelligence(episodeId: string, userId?: string) {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, status: PublicationStatus.PUBLISHED, show: { status: PublicationStatus.PUBLISHED } },
      select: { id: true, membershipRequired: true, show: { select: { creator: { select: { id: true, userId: true } } } } },
    });
    if (!episode) throw new NotFoundException('Published episode not found');
    if (episode.membershipRequired && episode.show.creator.userId !== userId) {
      if (!userId) throw new ForbiddenException('Sign in and join this creator membership to access episode intelligence');
      const subscription = await this.prisma.membershipSubscription.findFirst({
        where: { subscriberId: userId, creatorId: episode.show.creator.id, status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } },
        select: { id: true },
      });
      if (!subscription) throw new ForbiddenException('An active creator membership is required to access episode intelligence');
    }
    return this.prisma.episodeIntelligence.findUnique({
      where: { episodeId },
      select: { summary: true, topics: true, model: true, generatedAt: true },
    });
  }

  async getEpisodeTranscript(episodeId: string, userId?: string) {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, status: PublicationStatus.PUBLISHED, show: { status: PublicationStatus.PUBLISHED } },
      select: { id: true, membershipRequired: true, show: { select: { creator: { select: { id: true, userId: true } } } } },
    });
    if (!episode) throw new NotFoundException('Published episode not found');
    if (episode.membershipRequired && episode.show.creator.userId !== userId) {
      if (!userId) throw new ForbiddenException('Sign in and join this creator membership to access the transcript');
      const subscription = await this.prisma.membershipSubscription.findFirst({
        where: { subscriberId: userId, creatorId: episode.show.creator.id, status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } },
        select: { id: true },
      });
      if (!subscription) throw new ForbiddenException('An active creator membership is required to access this transcript');
    }
    return this.prisma.episodeTranscript.findUnique({
      where: { episodeId }, select: { episodeId: true, content: true, language: true, segments: true, updatedAt: true },
    });
  }

  async getCreatorEpisodeTranscript(userId: string, showId: string, episodeId: string) {
    await this.requireOwnedShow(userId, showId);
    const episode = await this.prisma.episode.findFirst({ where: { id: episodeId, showId }, select: { id: true } });
    if (!episode) throw new NotFoundException('Episode not found');
    return this.prisma.episodeTranscript.findUnique({
      where: { episodeId }, select: { episodeId: true, content: true, language: true, updatedAt: true },
    });
  }

  async saveEpisodeTranscript(userId: string, showId: string, episodeId: string, content: string, language = 'en') {
    await this.requireOwnedShow(userId, showId);
    const episode = await this.prisma.episode.findFirst({ where: { id: episodeId, showId }, select: { id: true } });
    if (!episode) throw new NotFoundException('Episode not found');
    const value = content.trim();
    if (!value) {
      await this.prisma.episodeTranscript.deleteMany({ where: { episodeId } });
      return { episodeId, deleted: true };
    }
    return this.prisma.episodeTranscript.upsert({
      where: { episodeId },
      create: { episodeId, content: value, language: language.trim() || 'en' },
      update: { content: value, language: language.trim() || 'en', segments: Prisma.DbNull },
      select: { episodeId: true, content: true, language: true, updatedAt: true },
    });
  }

  async bookmark(userId: string, episodeId: string) {
    await this.getEpisode(episodeId);
    await this.prisma.episodeBookmark.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      create: { userId, episodeId },
      update: {},
    });
    return { bookmarked: true, episodeId };
  }

  async unbookmark(userId: string, episodeId: string) {
    await this.prisma.episodeBookmark.deleteMany({ where: { userId, episodeId } });
    return { bookmarked: false, episodeId };
  }

  async listBookmarks(userId: string) {
    const items = await this.prisma.episodeBookmark.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, episode: { select: { id: true, title: true, artworkUrl: true, durationSeconds: true, publishedAt: true, show: { select: { id: true, title: true } } } } },
    });
    return items.map(item => ({ savedAt: item.createdAt, episode: item.episode }));
  }

  async saveProgress(userId: string, episodeId: string, positionSeconds: number) {
    const episode = await this.getEpisode(episodeId);
    const boundedPosition = episode.durationSeconds ? Math.min(positionSeconds, episode.durationSeconds) : positionSeconds;
    const completed = !!episode.durationSeconds && boundedPosition >= episode.durationSeconds;
    return this.prisma.playbackProgress.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      create: { userId, episodeId, positionSeconds: boundedPosition, completed },
      update: { positionSeconds: boundedPosition, completed },
      select: { episodeId: true, positionSeconds: true, completed: true, updatedAt: true },
    });
  }

  async listProgress(userId: string) {
    return this.prisma.playbackProgress.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { episodeId: true, positionSeconds: true, completed: true, updatedAt: true, episode: { select: { title: true, artworkUrl: true, durationSeconds: true, show: { select: { id: true, title: true } } } } },
    });
  }

  private async requireCommunityAccess(userId: string, episodeId: string) {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, status: PublicationStatus.PUBLISHED, show: { status: PublicationStatus.PUBLISHED } },
      select: {
        id: true,
        membershipRequired: true,
        show: { select: { creator: { select: { id: true, userId: true } } } },
      },
    });
    if (!episode) throw new NotFoundException('Published episode not found');
    if (!episode.membershipRequired || episode.show.creator.userId === userId) return episode;
    const subscription = await this.prisma.membershipSubscription.findFirst({
      where: {
        subscriberId: userId,
        creatorId: episode.show.creator.id,
        status: 'ACTIVE',
        currentPeriodEnd: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!subscription) throw new ForbiddenException('An active creator membership is required to access this episode community');
    return episode;
  }

  async getEpisodeCommunity(userId: string, episodeId: string) {
    await this.requireCommunityAccess(userId, episodeId);
    const [likeCount, commentCount, liked, comments] = await Promise.all([
      this.prisma.episodeLike.count({ where: { episodeId } }),
      this.prisma.episodeComment.count({ where: { episodeId, deletedAt: null } }),
      this.prisma.episodeLike.findUnique({ where: { userId_episodeId: { userId, episodeId } }, select: { userId: true } }),
      this.prisma.episodeComment.findMany({
        where: { episodeId, parentId: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, content: true, deletedAt: true, createdAt: true, updatedAt: true,
          author: { select: { id: true, displayName: true } },
          replies: {
            orderBy: { createdAt: 'asc' },
            take: 30,
            select: {
              id: true, content: true, deletedAt: true, createdAt: true, updatedAt: true,
              author: { select: { id: true, displayName: true } },
            },
          },
        },
      }),
    ]);
    const visible = comments.map(comment => ({
      ...comment,
      content: comment.deletedAt ? '[deleted]' : comment.content,
      replies: comment.replies.map(reply => ({ ...reply, content: reply.deletedAt ? '[deleted]' : reply.content })),
    }));
    return { episodeId, likeCount, commentCount, likedByMe: Boolean(liked), comments: visible };
  }

  async createEpisodeComment(userId: string, episodeId: string, content: string, parentId?: string) {
    await this.requireCommunityAccess(userId, episodeId);
    if (parentId) {
      const parent = await this.prisma.episodeComment.findFirst({
        where: { id: parentId, episodeId, parentId: null, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Comment thread not found');
    }
    return this.prisma.episodeComment.create({
      data: { episodeId, authorId: userId, parentId: parentId || null, content: content.trim() },
      select: {
        id: true, content: true, createdAt: true, updatedAt: true,
        author: { select: { id: true, displayName: true } },
      },
    });
  }

  async deleteEpisodeComment(userId: string, episodeId: string, commentId: string) {
    const comment = await this.prisma.episodeComment.findFirst({
      where: { id: commentId, episodeId },
      select: { id: true, authorId: true, episode: { select: { show: { select: { creator: { select: { userId: true } } } } } } },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== userId && comment.episode.show.creator.userId !== userId) {
      throw new ForbiddenException('You can only delete your own comment or moderate comments on your show');
    }
    await this.prisma.episodeComment.update({
      where: { id: commentId },
      data: { content: '[deleted]', deletedAt: new Date() },
    });
    return { deleted: true };
  }

  async setEpisodeLike(userId: string, episodeId: string, liked: boolean) {
    await this.requireCommunityAccess(userId, episodeId);
    if (liked) {
      await this.prisma.episodeLike.upsert({
        where: { userId_episodeId: { userId, episodeId } },
        create: { userId, episodeId },
        update: {},
      });
    } else {
      await this.prisma.episodeLike.deleteMany({ where: { userId, episodeId } });
    }
    const likeCount = await this.prisma.episodeLike.count({ where: { episodeId } });
    return { episodeId, likedByMe: liked, likeCount };
  }

  async createMoment(userId: string, episodeId: string, caption: string, startSeconds: number, endSeconds: number) {
    const episode = await this.prisma.episode.findFirst({
      where: {
        id: episodeId,
        status: PublicationStatus.PUBLISHED,
        membershipRequired: false,
        show: { status: PublicationStatus.PUBLISHED, creator: { userId } },
      },
      select: { id: true, durationSeconds: true, show: { select: { creatorId: true } } },
    });
    if (!episode) throw new NotFoundException('A published public episode owned by your creator account is required');
    if (!Number.isInteger(startSeconds) || !Number.isInteger(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) {
      throw new ConflictException('Choose a valid clip range');
    }
    if (endSeconds - startSeconds > 90) throw new ConflictException('VOXA Moments can be up to 90 seconds long');
    if (!episode.durationSeconds || endSeconds > episode.durationSeconds) throw new ConflictException('Clip range exceeds the episode duration');
    const video = await this.prisma.mediaAsset.findFirst({
      where: { episodeId, status: 'READY', contentType: { startsWith: 'video/' }, playbackKey: { not: null } },
      select: { id: true },
    });
    if (!video) throw new ConflictException('A fully processed video episode is required to create a Moment');
    return this.prisma.moment.create({
      data: { creatorId: episode.show.creatorId, episodeId, caption: caption.trim(), startSeconds, endSeconds },
      select: { id: true, episodeId: true, caption: true, startSeconds: true, endSeconds: true, status: true, createdAt: true },
    });
  }

  async publishMoment(userId: string, momentId: string) {
    const moment = await this.prisma.moment.findFirst({
      where: { id: momentId, creator: { userId } },
      select: { id: true, status: true },
    });
    if (!moment) throw new NotFoundException('Moment not found');
    if (moment.status === PublicationStatus.PUBLISHED) return moment;
    return this.prisma.moment.update({
      where: { id: momentId },
      data: { status: PublicationStatus.PUBLISHED, publishedAt: new Date() },
      select: { id: true, status: true, publishedAt: true },
    });
  }

  async deleteMoment(userId: string, momentId: string) {
    const moment = await this.prisma.moment.findFirst({
      where: { id: momentId, creator: { userId } },
      select: { id: true },
    });
    if (!moment) throw new NotFoundException('Moment not found');
    await this.prisma.moment.delete({ where: { id: momentId } });
    return { deleted: true };
  }


  private async requirePublishedMoment(momentId: string) {
    const moment = await this.prisma.moment.findFirst({
      where: {
        id: momentId,
        status: PublicationStatus.PUBLISHED,
        episode: { status: PublicationStatus.PUBLISHED, membershipRequired: false, show: { status: PublicationStatus.PUBLISHED } },
      },
      select: { id: true, creator: { select: { userId: true } } },
    });
    if (!moment) throw new NotFoundException('Moment not found');
    return moment;
  }

  async getMomentCommunity(momentId: string) {
    await this.requirePublishedMoment(momentId);
    const [likeCount, commentCount, comments] = await Promise.all([
      this.prisma.momentLike.count({ where: { momentId } }),
      this.prisma.momentComment.count({ where: { momentId, deletedAt: null } }),
      this.prisma.momentComment.findMany({
        where: { momentId, parentId: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, content: true, deletedAt: true, createdAt: true,
          author: { select: { id: true, displayName: true } },
          replies: {
            orderBy: { createdAt: 'asc' }, take: 20,
            select: { id: true, content: true, deletedAt: true, createdAt: true, author: { select: { id: true, displayName: true } } },
          },
        },
      }),
    ]);
    return {
      momentId, likeCount, commentCount,
      comments: comments.map(comment => ({
        ...comment, content: comment.deletedAt ? '[deleted]' : comment.content,
        replies: comment.replies.map(reply => ({ ...reply, content: reply.deletedAt ? '[deleted]' : reply.content })),
      })),
    };
  }

  async setMomentLike(userId: string, momentId: string, liked: boolean) {
    await this.requirePublishedMoment(momentId);
    if (liked) {
      await this.prisma.momentLike.upsert({
        where: { userId_momentId: { userId, momentId } },
        create: { userId, momentId },
        update: {},
      });
    } else {
      await this.prisma.momentLike.deleteMany({ where: { userId, momentId } });
    }
    return { momentId, likedByMe: liked, likeCount: await this.prisma.momentLike.count({ where: { momentId } }) };
  }

  async createMomentComment(userId: string, momentId: string, content: string, parentId?: string) {
    await this.requirePublishedMoment(momentId);
    if (parentId) {
      const parent = await this.prisma.momentComment.findFirst({
        where: { id: parentId, momentId, parentId: null, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Moment comment thread not found');
    }
    return this.prisma.momentComment.create({
      data: { momentId, authorId: userId, parentId: parentId || null, content: content.trim() },
      select: { id: true, content: true, createdAt: true, author: { select: { id: true, displayName: true } } },
    });
  }

  async deleteMomentComment(userId: string, momentId: string, commentId: string) {
    const comment = await this.prisma.momentComment.findFirst({
      where: { id: commentId, momentId },
      select: { id: true, authorId: true, moment: { select: { creator: { select: { userId: true } } } } },
    });
    if (!comment) throw new NotFoundException('Moment comment not found');
    if (comment.authorId !== userId && comment.moment.creator.userId !== userId) {
      throw new ForbiddenException('You can only delete your own comment or moderate comments on your Moment');
    }
    await this.prisma.momentComment.update({
      where: { id: commentId }, data: { content: '[deleted]', deletedAt: new Date() },
    });
    return { deleted: true };
  }

  async discoverMoments(cursor?: string, requestedLimit?: number) {
    const limit = Math.max(1, Math.min(30, Number(requestedLimit) || 15));
    const items = await this.prisma.moment.findMany({
      where: {
        status: PublicationStatus.PUBLISHED,
        episode: {
          status: PublicationStatus.PUBLISHED,
          membershipRequired: false,
          show: { status: PublicationStatus.PUBLISHED },
          mediaAssets: { some: { status: 'READY', contentType: { startsWith: 'video/' }, playbackKey: { not: null } } },
        },
      },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true, episodeId: true, caption: true, startSeconds: true, endSeconds: true, publishedAt: true,
        creator: { select: { handle: true, user: { select: { displayName: true } } } },
        episode: { select: { id: true, title: true, artworkUrl: true, durationSeconds: true } },
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async discoverShows(params: { q?: string; category?: string; language?: string; cursor?: string; limit?: number }) {
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 20));
    const where: any = { status: PublicationStatus.PUBLISHED };
    if (params.category) where.category = { equals: params.category, mode: 'insensitive' };
    if (params.language) where.language = { equals: params.language, mode: 'insensitive' };
    if (params.q) where.OR = [
      { title: { contains: params.q, mode: 'insensitive' } },
      { description: { contains: params.q, mode: 'insensitive' } },
      { creator: { handle: { contains: params.q, mode: 'insensitive' } } },
    ];
    const items = await this.prisma.show.findMany({
      where, take: limit + 1, ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true, description: true, language: true, category: true, artworkUrl: true, publishedAt: true,
        creator: { select: { handle: true, user: { select: { displayName: true } } } },
        _count: { select: { episodes: { where: { status: PublicationStatus.PUBLISHED } } } } },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async discoverEpisodes(params: { q?: string; category?: string; language?: string; cursor?: string; limit?: number }) {
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 20));
    const where: any = { status: PublicationStatus.PUBLISHED, show: { status: PublicationStatus.PUBLISHED } };
    if (params.category) where.show.category = { equals: params.category, mode: 'insensitive' };
    if (params.language) where.show.language = { equals: params.language, mode: 'insensitive' };
    if (params.q) where.OR = [
      { title: { contains: params.q, mode: 'insensitive' } },
      { description: { contains: params.q, mode: 'insensitive' } },
      { show: { title: { contains: params.q, mode: 'insensitive' } } },
      { membershipRequired: false, transcript: { is: { content: { contains: params.q, mode: 'insensitive' } } } },
      { membershipRequired: false, intelligence: { is: { summary: { contains: params.q, mode: 'insensitive' } } } },
    ];
    const items = await this.prisma.episode.findMany({
      where, take: limit + 1, ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true, description: true, artworkUrl: true, durationSeconds: true, isExplicit: true, isLiveReplay: true, membershipRequired: true, publishedAt: true,
        transcript: { select: { segments: true } },
        show: { select: { id: true, title: true, category: true, language: true, creator: { select: { handle: true, user: { select: { displayName: true } } } } } } },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const term = params.q?.trim().toLocaleLowerCase();
    const results = page.map(item => {
      const rawSegments = item.transcript?.segments;
      const segments = Array.isArray(rawSegments) ? rawSegments as Array<{ startSeconds?: number; endSeconds?: number; text?: string; speaker?: string }> : [];
      const matchingMoments = !term || item.membershipRequired ? [] : segments
        .filter(segment => typeof segment.text === 'string' && segment.text.toLocaleLowerCase().includes(term))
        .slice(0, 5)
        .map(segment => ({
          startSeconds: Math.max(0, Number(segment.startSeconds) || 0),
          endSeconds: Math.max(0, Number(segment.endSeconds) || 0),
          text: String(segment.text).slice(0, 500),
          speaker: String(segment.speaker || 'Speaker').slice(0, 40),
        }));
      const { transcript, ...episode } = item;
      return { ...episode, matchingMoments };
    });
    return { items: results, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async discoveryCategories() {
    const categories = await this.prisma.show.findMany({
      where: { status: PublicationStatus.PUBLISHED, category: { not: null }, episodes: { some: { status: PublicationStatus.PUBLISHED } } },
      distinct: ['category'], orderBy: { category: 'asc' }, select: { category: true },
    });
    return { items: categories.map(item => item.category).filter((value): value is string => !!value) };
  }

}
