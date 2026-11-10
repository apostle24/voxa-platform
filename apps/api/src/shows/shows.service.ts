import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PublicationStatus } from '@prisma/client';
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
          select: { id: true, title: true, description: true, artworkUrl: true, durationSeconds: true, isExplicit: true, publishedAt: true },
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
        id: true, title: true, description: true, mediaKey: true, artworkUrl: true, durationSeconds: true, isExplicit: true, publishedAt: true,
        show: { select: { id: true, title: true, creator: { select: { handle: true, user: { select: { displayName: true } } } } } },
      },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    return episode;
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
    ];
    const items = await this.prisma.episode.findMany({
      where, take: limit + 1, ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true, description: true, artworkUrl: true, durationSeconds: true, isExplicit: true, publishedAt: true,
        show: { select: { id: true, title: true, category: true, language: true, creator: { select: { handle: true, user: { select: { displayName: true } } } } } } },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async discoveryCategories() {
    const categories = await this.prisma.show.findMany({
      where: { status: PublicationStatus.PUBLISHED, category: { not: null }, episodes: { some: { status: PublicationStatus.PUBLISHED } } },
      distinct: ['category'], orderBy: { category: 'asc' }, select: { category: true },
    });
    return { items: categories.map(item => item.category).filter((value): value is string => !!value) };
  }

}
