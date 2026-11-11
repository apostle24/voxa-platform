import { createHash } from 'node:crypto';
import { createUserNotification } from '../notifications/notification-writer';
import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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
            durationSeconds: true, mediaKey: true, membershipRequired: true, isLiveReplay: true, publishedAt: true,
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

  async unpublishEpisode(userId: string, showId: string, episodeId: string) {
    await this.requireOwnedShow(userId, showId);
    const episode = await this.prisma.episode.findFirst({ where: { id: episodeId, showId }, select: { id: true, status: true } });
    if (!episode) throw new NotFoundException('Episode not found');
    if (episode.status !== PublicationStatus.PUBLISHED) throw new ConflictException('Only published episodes can be unpublished');
    const result = await this.prisma.episode.updateMany({
      where: { id: episodeId, showId, status: PublicationStatus.PUBLISHED },
      data: { status: PublicationStatus.DRAFT, publishedAt: null },
    });
    if (result.count !== 1) throw new ConflictException('Episode publication state changed. Refresh and try again.');
    return { id: episodeId, showId, status: PublicationStatus.DRAFT, unpublished: true };
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

  async generateEpisodeProductionAdvice(userId: string, showId: string, episodeId: string) {
    await this.requireOwnedShow(userId, showId);
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, showId },
      select: { id: true, title: true, description: true, status: true, durationSeconds: true,
        show: { select: { title: true, category: true, description: true } },
        transcript: { select: { content: true, language: true } },
        chapters: { orderBy: { position: 'asc' }, select: { title: true, startSeconds: true } },
      },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    if (episode.status === PublicationStatus.PUBLISHED) {
      throw new ConflictException('Production advice is available for draft episodes only');
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException('AI production assistance is not configured. Set OPENAI_API_KEY on the API server.');
    const sourceText = (episode.transcript?.content || '').slice(0, 14000);
    if (!episode.title.trim() && !sourceText) {
      throw new ConflictException('Add an episode title or transcript before requesting production advice');
    }
    const prompt = {
      show: episode.show.title,
      category: episode.show.category,
      showDescription: episode.show.description,
      episodeTitle: episode.title,
      episodeDescription: episode.description,
      durationSeconds: episode.durationSeconds,
      transcriptLanguage: episode.transcript?.language,
      transcript: sourceText,
      chapters: episode.chapters,
    };
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.VOXA_CREATOR_ASSISTANT_MODEL || 'gpt-4o-mini',
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are VOXA Creator Production Assistant. Review only the supplied podcast draft. Do not invent facts, guests, claims, quotations, or events. Preserve the creator voice and meaning. Return JSON with keys: titleOptions (array of exactly 3 concise titles), description (a polished 1-2 paragraph episode description), strengths (array of 2-4 specific strengths), improvements (array of 2-5 actionable editorial improvements), readiness (one of READY_TO_REVIEW, NEEDS_WORK, INSUFFICIENT_SOURCE), and sourceNote (brief note about transcript availability/limits). Suggestions are optional editorial assistance, never auto-publish.' },
            { role: 'user', content: JSON.stringify(prompt) },
          ],
        }),
      });
    } catch {
      throw new ServiceUnavailableException('VOXA could not reach the AI production service');
    }
    if (!response.ok) throw new ServiceUnavailableException('AI production assistance is temporarily unavailable');
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new ServiceUnavailableException('AI production service returned an empty response');
    try {
      const result = JSON.parse(content);
      return {
        episodeId,
        titleOptions: Array.isArray(result.titleOptions) ? result.titleOptions.filter((v: unknown) => typeof v === 'string').slice(0, 3) : [],
        description: typeof result.description === 'string' ? result.description : '',
        strengths: Array.isArray(result.strengths) ? result.strengths.filter((v: unknown) => typeof v === 'string').slice(0, 4) : [],
        improvements: Array.isArray(result.improvements) ? result.improvements.filter((v: unknown) => typeof v === 'string').slice(0, 5) : [],
        readiness: ['READY_TO_REVIEW', 'NEEDS_WORK', 'INSUFFICIENT_SOURCE'].includes(result.readiness) ? result.readiness : 'NEEDS_WORK',
        sourceNote: typeof result.sourceNote === 'string' ? result.sourceNote : 'Suggestions are based only on the episode details supplied.',
      };
    } catch {
      throw new ServiceUnavailableException('AI production service returned an invalid review');
    }
  }

  async generateEpisodeContentPack(userId: string, showId: string, episodeId: string) {
    await this.requireOwnedShow(userId, showId);
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, showId },
      select: {
        id: true, title: true, description: true, durationSeconds: true,
        show: { select: { title: true, category: true, description: true } },
        transcript: { select: { content: true, language: true } },
        chapters: { orderBy: { position: 'asc' }, select: { title: true, startSeconds: true } },
      },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    const transcript = (episode.transcript?.content || '').slice(0, 18000);
    if (!transcript && !episode.description?.trim()) {
      throw new ConflictException('Add an episode transcript or description before creating a content pack');
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException('Content repurposing is not configured. Set OPENAI_API_KEY on the API server.');
    const source = {
      show: episode.show.title,
      category: episode.show.category,
      showDescription: episode.show.description,
      episodeTitle: episode.title,
      episodeDescription: episode.description,
      transcriptLanguage: episode.transcript?.language || 'unknown',
      transcript,
      chapters: episode.chapters,
      durationSeconds: episode.durationSeconds,
    };
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.VOXA_CONTENT_REPURPOSING_MODEL || 'gpt-4o-mini',
          temperature: 0.5,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are VOXA Creator Content Repurposing Studio. Create reusable written content strictly from the supplied podcast source. Never invent names, quotations, statistics, claims, links, timestamps, guests, or events. Quote only exact wording present in the transcript; if the transcript is absent, return no quoteCandidates. Keep each format distinct, faithful to the creator voice, useful and ready for human editing. Return valid JSON with: socialPosts (exactly 3 objects {platform, text}), keyTakeaways (3-6 strings), quoteCandidates (0-5 objects {quote, context}), newsletter (object {subject, preview, body}), blogDraft (object {title, excerpt, body}). Do not include hashtags unless grounded in the subject; avoid fabricated calls to action. Make all copy concise and clearly label any inferred framing.' },
            { role: 'user', content: JSON.stringify(source) },
          ],
        }),
      });
    } catch {
      throw new ServiceUnavailableException('VOXA could not reach the AI content service');
    }
    if (!response.ok) throw new ServiceUnavailableException('AI content repurposing is temporarily unavailable');
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new ServiceUnavailableException('AI content service returned an empty response');
    try {
      const result = JSON.parse(content);
      const strings = (value: unknown, max: number) => Array.isArray(value) ? value.filter((item: unknown) => typeof item === 'string' && item.trim()).slice(0, max) : [];
      const object = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const socialPosts = Array.isArray(result.socialPosts) ? result.socialPosts.slice(0, 3).map((item: unknown) => {
        const post = object(item);
        return { platform: typeof post.platform === 'string' ? post.platform.slice(0, 30) : 'Social', text: typeof post.text === 'string' ? post.text.slice(0, 1200) : '' };
      }).filter((post: {text:string}) => post.text) : [];
      const quotes = Array.isArray(result.quoteCandidates) ? result.quoteCandidates.slice(0, 5).map((item: unknown) => {
        const quote = object(item);
        return { quote: typeof quote.quote === 'string' ? quote.quote.slice(0, 400) : '', context: typeof quote.context === 'string' ? quote.context.slice(0, 300) : '' };
      }).filter((item: {quote:string}) => item.quote) : [];
      const newsletter = object(result.newsletter);
      const blog = object(result.blogDraft);
      return {
        episodeId,
        socialPosts,
        keyTakeaways: strings(result.keyTakeaways, 6),
        quoteCandidates: quotes,
        newsletter: {
          subject: typeof newsletter.subject === 'string' ? newsletter.subject.slice(0, 160) : '',
          preview: typeof newsletter.preview === 'string' ? newsletter.preview.slice(0, 240) : '',
          body: typeof newsletter.body === 'string' ? newsletter.body.slice(0, 5000) : '',
        },
        blogDraft: {
          title: typeof blog.title === 'string' ? blog.title.slice(0, 180) : '',
          excerpt: typeof blog.excerpt === 'string' ? blog.excerpt.slice(0, 400) : '',
          body: typeof blog.body === 'string' ? blog.body.slice(0, 8000) : '',
        },
        sourceNote: transcript ? 'Generated from the episode transcript and metadata. Verify every quote against the original recording.' : 'Generated from episode metadata only; no transcript was available, so no direct quotes are supplied.',
      };
    } catch {
      throw new ServiceUnavailableException('AI content service returned an invalid content pack');
    }
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
    const comment = await this.prisma.episodeComment.create({
      data: { episodeId, authorId: userId, parentId: parentId || null, content: content.trim() },
      select: {
        id: true, content: true, createdAt: true, updatedAt: true,
        author: { select: { id: true, displayName: true } },
      },
    });
    const [episode, parent] = await Promise.all([
      this.prisma.episode.findUnique({ where: { id: episodeId }, select: { title: true, show: { select: { creator: { select: { userId: true } } } } } }),
      parentId ? this.prisma.episodeComment.findUnique({ where: { id: parentId }, select: { authorId: true } }) : Promise.resolve(null),
    ]);
    const recipients = new Set([episode?.show.creator.userId, parent?.authorId].filter((id): id is string => Boolean(id) && id !== userId));
    await Promise.all([...recipients].map(recipientId => createUserNotification(this.prisma, {
      recipientId, actorId: userId, type: parentId ? 'COMMENT_REPLY' : 'EPISODE_COMMENT',
      title: parentId ? 'New reply to a discussion' : 'New episode comment',
      body: parentId ? 'Someone replied to a comment thread.' : `Someone commented on ${episode?.title ?? 'your episode'}.`,
      resourceType: 'episode', resourceId: episodeId, category: 'comments',
    })));
    return comment;
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
    const comment = await this.prisma.momentComment.create({
      data: { momentId, authorId: userId, parentId: parentId || null, content: content.trim() },
      select: { id: true, content: true, createdAt: true, author: { select: { id: true, displayName: true } } },
    });
    const [moment, parent] = await Promise.all([
      this.prisma.moment.findUnique({ where: { id: momentId }, select: { creator: { select: { userId: true } } } }),
      parentId ? this.prisma.momentComment.findUnique({ where: { id: parentId }, select: { authorId: true } }) : Promise.resolve(null),
    ]);
    const recipients = new Set([moment?.creator.userId, parent?.authorId].filter((id): id is string => Boolean(id) && id !== userId));
    await Promise.all([...recipients].map(recipientId => createUserNotification(this.prisma, {
      recipientId, actorId: userId, type: parentId ? 'COMMENT_REPLY' : 'MOMENT_COMMENT',
      title: parentId ? 'New reply to a discussion' : 'New Moment comment',
      body: 'Someone joined the conversation on a Moment.',
      resourceType: 'moment', resourceId: momentId, category: 'comments',
    })));
    return comment;
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


  async discoverCreators(q?: string) {
    const search = q?.trim();
    const items = await this.prisma.creator.findMany({
      where: {
        shows: { some: { status: PublicationStatus.PUBLISHED } },
        ...(search ? { OR: [
          { handle: { contains: search, mode: 'insensitive' } },
          { bio: { contains: search, mode: 'insensitive' } },
          { user: { displayName: { contains: search, mode: 'insensitive' } } },
          { shows: { some: { status: PublicationStatus.PUBLISHED, title: { contains: search, mode: 'insensitive' } } } },
        ] } : {}),
      },
      orderBy: [{ followers: { _count: 'desc' } }, { createdAt: 'desc' }],
      take: 12,
      select: {
        id: true, handle: true, bio: true, verifiedAt: true,
        user: { select: { displayName: true } },
        _count: { select: { followers: true, shows: { where: { status: PublicationStatus.PUBLISHED } } } },
      },
    });
    return { items };
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


  private async requestTextEmbeddings(inputs: string[]): Promise<number[][]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException('Semantic search is not configured. Set OPENAI_API_KEY on the API server.');
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.VOXA_EMBEDDING_MODEL || 'text-embedding-3-small', input: inputs }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ServiceUnavailableException(detail.slice(0, 300) || 'The semantic search provider is temporarily unavailable');
    }
    const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
    if (!payload.data || payload.data.length !== inputs.length) throw new ServiceUnavailableException('The semantic search provider returned an incomplete embedding response');
    return [...payload.data].sort((a, b) => a.index - b.index).map(item => item.embedding);
  }

  private cosineSimilarity(left: number[], right: number[]) {
    if (!left.length || left.length !== right.length) return 0;
    let dot = 0, leftMagnitude = 0, rightMagnitude = 0;
    for (let index = 0; index < left.length; index++) {
      dot += left[index] * right[index];
      leftMagnitude += left[index] * left[index];
      rightMagnitude += right[index] * right[index];
    }
    return leftMagnitude && rightMagnitude ? dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude)) : 0;
  }

  async semanticSearch(query: string) {
    const term = query.trim().replace(/\s+/g, ' ');
    if (term.length < 3 || term.length > 500) throw new ConflictException('Enter a search description between 3 and 500 characters');
    const queryVector = (await this.requestTextEmbeddings([term]))[0];
    const candidates = await this.prisma.episode.findMany({
      where: { status: PublicationStatus.PUBLISHED, membershipRequired: false, show: { status: PublicationStatus.PUBLISHED } },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 250,
      select: {
        id: true, title: true, description: true, artworkUrl: true, durationSeconds: true,
        isExplicit: true, isLiveReplay: true, membershipRequired: true, publishedAt: true,
        show: { select: { id: true, title: true, category: true, language: true, creator: { select: { handle: true, user: { select: { displayName: true } } } } } },
        transcript: { select: { content: true, segments: true } },
        intelligence: { select: { summary: true, topics: true } },
        semanticEmbedding: { select: { vector: true, contentHash: true } },
      },
    });
    if (!candidates.length) return { query: term, items: [], searched: 0 };
    const embeddingModel = process.env.VOXA_EMBEDDING_MODEL || 'text-embedding-3-small';
    const documents = candidates.map(episode => [
      episode.title, episode.description || '', episode.show.title, episode.show.category || '',
      episode.intelligence?.summary || '', JSON.stringify(episode.intelligence?.topics || []),
      episode.transcript?.content || '',
    ].join('\n').slice(0, 8000));
    const hashes = documents.map(document => createHash('sha256').update(embeddingModel + '\n' + document).digest('hex'));
    const vectors: Array<number[] | null> = candidates.map((episode, index) => {
      const cached = episode.semanticEmbedding;
      return cached && cached.contentHash === hashes[index] && Array.isArray(cached.vector) ? cached.vector as number[] : null;
    });
    const missing: number[] = [];
    vectors.forEach((vector, index) => { if (!vector) missing.push(index); });
    for (let offset = 0; offset < missing.length; offset += 32) {
      const indexes = missing.slice(offset, offset + 32);
      const batch = await this.requestTextEmbeddings(indexes.map(index => documents[index]));
      await Promise.all(indexes.map(async (candidateIndex, batchIndex) => {
        const vector = batch[batchIndex];
        vectors[candidateIndex] = vector;
        await this.prisma.episodeEmbedding.upsert({
          where: { episodeId: candidates[candidateIndex].id },
          create: { episodeId: candidates[candidateIndex].id, vector, contentHash: hashes[candidateIndex] },
          update: { vector, contentHash: hashes[candidateIndex] },
        });
      }));
    }
    const ranked = candidates.map((episode, index) => ({ episode, score: this.cosineSimilarity(queryVector, vectors[index] || []) }))
      .sort((a, b) => b.score - a.score).slice(0, 20);
    return {
      query: term, searched: candidates.length,
      items: ranked.map(({ episode, score }) => {
        const raw = episode.transcript?.segments;
        const segments = Array.isArray(raw) ? raw as Array<{ text?: string; startSeconds?: number; endSeconds?: number; speaker?: string }> : [];
        const queryTerms = [...new Set(term.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 3))];
        const matchingSegments = segments.map(segment => ({
          segment,
          relevance: queryTerms.reduce((total, word) => total + (String(segment.text || '').toLocaleLowerCase().includes(word) ? 1 : 0), 0),
        })).filter(item => item.relevance > 0)
          .sort((a, b) => b.relevance - a.relevance || (Number(a.segment.startSeconds) || 0) - (Number(b.segment.startSeconds) || 0));
        const bestSegment = matchingSegments[0]?.segment;
        const excerpt = bestSegment?.text || episode.intelligence?.summary || episode.description || '';
        return {
          id: episode.id, title: episode.title, description: episode.description, artworkUrl: episode.artworkUrl,
          durationSeconds: episode.durationSeconds, isExplicit: episode.isExplicit, isLiveReplay: episode.isLiveReplay,
          membershipRequired: false, publishedAt: episode.publishedAt, show: episode.show,
          semanticScore: Number(score.toFixed(4)), semanticExcerpt: excerpt.slice(0, 360),
          semanticExcerptStartSeconds: bestSegment?.startSeconds ?? null,
          semanticExcerptEndSeconds: bestSegment?.endSeconds ?? null,
          semanticExcerptSpeaker: bestSegment?.speaker || null,
        };
      }),
    };
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


  async getPersonalizedRecommendations(userId: string, requestedLimit?: number) {
    const limit = Math.max(1, Math.min(20, Number(requestedLimit) || 12));
    const [recentProgress, bookmarks, follows] = await Promise.all([
      this.prisma.playbackProgress.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 30,
        select: { episodeId: true, episode: { select: { show: { select: { category: true, creatorId: true } } } } } }),
      this.prisma.episodeBookmark.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30,
        select: { episodeId: true, episode: { select: { show: { select: { category: true, creatorId: true } } } } } }),
      this.prisma.follow.findMany({ where: { followerId: userId }, select: { creatorId: true } }),
    ]);
    const categoryCounts = new Map<string, number>();
    const creatorCounts = new Map<string, number>();
    const excludedIds = new Set<string>();
    for (const signal of [...recentProgress, ...bookmarks]) {
      excludedIds.add(signal.episodeId);
      const category = signal.episode?.show?.category;
      const creatorId = signal.episode?.show?.creatorId;
      if (category) categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
      if (creatorId) creatorCounts.set(creatorId, (creatorCounts.get(creatorId) || 0) + 1);
    }
    const followedCreatorIds = follows.map(item => item.creatorId);
    const preferredCategories = [...categoryCounts.entries()].sort((a,b) => b[1]-a[1]).slice(0,5).map(([v])=>v);
    const listenedCreatorIds = [...creatorCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([v])=>v);
    const creatorIds = [...new Set([...followedCreatorIds, ...listenedCreatorIds])];
    const select = {
      id: true, title: true, description: true, artworkUrl: true, durationSeconds: true,
      isExplicit: true, isLiveReplay: true, publishedAt: true,
      show: { select: { id: true, title: true, category: true, creatorId: true,
        creator: { select: { handle: true, user: { select: { displayName: true } } } } } },
    };
    const candidates = await this.prisma.episode.findMany({
      where: { status: PublicationStatus.PUBLISHED, membershipRequired: false, show: { status: PublicationStatus.PUBLISHED },
        ...(excludedIds.size ? { id: { notIn: [...excludedIds] } } : {}),
        ...(preferredCategories.length || creatorIds.length ? { OR: [
          ...(preferredCategories.length ? [{ show: { category: { in: preferredCategories } } }] : []),
          ...(creatorIds.length ? [{ show: { creatorId: { in: creatorIds } } }] : []),
        ] } : {}),
      },
      take: limit * 3, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], select,
    });
    const recommendations = candidates.map(episode => {
      const followed = followedCreatorIds.includes(episode.show.creatorId);
      const categoryMatch = Boolean(episode.show.category && preferredCategories.includes(episode.show.category));
      const creatorMatch = creatorIds.includes(episode.show.creatorId);
      const score = (followed ? 100 : 0) + (categoryMatch ? 20 : 0) + (creatorMatch ? 10 : 0);
      const reason = followed ? 'From a creator you follow' : categoryMatch ? 'Based on topics you listen to'
        : creatorMatch ? 'From a creator you have listened to' : 'Popular on VOXA';
      return { ...episode, score, reason };
    }).sort((a,b)=>b.score-a.score || new Date(b.publishedAt || 0).getTime()-new Date(a.publishedAt || 0).getTime())
      .slice(0,limit).map(({score,...episode})=>episode);
    if (recommendations.length) return { items: recommendations, personalized: true };
    const fallback = await this.prisma.episode.findMany({
      where: { status: PublicationStatus.PUBLISHED, membershipRequired: false, show: { status: PublicationStatus.PUBLISHED },
        ...(excludedIds.size ? { id: { notIn: [...excludedIds] } } : {}) },
      take: limit, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], select,
    });
    return { items: fallback.map(episode => ({ ...episode, reason: 'Popular on VOXA' })), personalized: false };
  }


  private topicLabels(value: Prisma.JsonValue): string[] {
    const values = Array.isArray(value) ? value : value && typeof value === 'object'
      ? Object.values(value as Record<string, Prisma.JsonValue>) : [];
    return values.flatMap(item => {
      if (typeof item === 'string') return [item.trim()].filter(Boolean);
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const record = item as Record<string, Prisma.JsonValue>;
        const label = record.topic ?? record.name ?? record.label ?? record.title;
        return typeof label === 'string' ? [label.trim()].filter(Boolean) : [];
      }
      return [];
    }).slice(0, 30);
  }

  async discoverTopics() {
    const intelligence = await this.prisma.episodeIntelligence.findMany({
      where: { episode: { status: PublicationStatus.PUBLISHED, membershipRequired: false, show: { status: PublicationStatus.PUBLISHED } } },
      orderBy: { generatedAt: 'desc' }, take: 500, select: { topics: true },
    });
    const counts = new Map<string, number>();
    for (const item of intelligence) {
      for (const label of this.topicLabels(item.topics)) {
        const normalized = label.replace(/\s+/g, ' ').trim();
        if (normalized.length < 2 || normalized.length > 60) continue;
        const existing = [...counts.keys()].find(value => value.toLocaleLowerCase() === normalized.toLocaleLowerCase());
        const key = existing || normalized;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return { items: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 24).map(([topic, count]) => ({ topic, count })) };
  }

  async discoverTopicEpisodes(topic: string) {
    const selectedTopic = topic.trim();
    if (!selectedTopic || selectedTopic.length > 60) return { items: [] };
    const intelligence = await this.prisma.episodeIntelligence.findMany({
      where: { episode: { status: PublicationStatus.PUBLISHED, membershipRequired: false, show: { status: PublicationStatus.PUBLISHED } } },
      orderBy: { generatedAt: 'desc' }, take: 500,
      select: {
        topics: true,
        episode: { select: {
          id: true, title: true, description: true, artworkUrl: true, durationSeconds: true,
          isExplicit: true, isLiveReplay: true, membershipRequired: true, publishedAt: true,
          show: { select: { id: true, title: true, category: true, language: true,
            creator: { select: { handle: true, user: { select: { displayName: true } } } } } },
        } },
      },
    });
    const needle = selectedTopic.toLocaleLowerCase();
    const items = intelligence
      .filter(item => this.topicLabels(item.topics).some(label => label.toLocaleLowerCase() === needle))
      .map(item => item.episode)
      .filter((episode, index, all) => all.findIndex(candidate => candidate.id === episode.id) === index)
      .slice(0, 30)
      .map(episode => ({ ...episode, matchingMoments: [] }));
    return { topic: selectedTopic, items };
  }

  async discoveryCategories() {
    const categories = await this.prisma.show.findMany({
      where: { status: PublicationStatus.PUBLISHED, category: { not: null }, episodes: { some: { status: PublicationStatus.PUBLISHED } } },
      distinct: ['category'], orderBy: { category: 'asc' }, select: { category: true },
    });
    return { items: categories.map(item => item.category).filter((value): value is string => !!value) };
  }

}
