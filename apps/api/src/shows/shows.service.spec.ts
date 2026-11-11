import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShowsService } from './shows.service';

describe('ShowsService publishing and playback progress', () => {
  let service: ShowsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      creator: { findUnique: jest.fn() },
      show: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
      episode: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      mediaAsset: { findFirst: jest.fn() },
      moment: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn(), findMany: jest.fn() },
      playbackProgress: { upsert: jest.fn() },
    };
    service = new ShowsService(prisma as unknown as PrismaService);
  });


  it('includes the live replay marker in public episode discovery results', async () => {
    prisma.episode.findMany.mockResolvedValue([{
      id: 'episode-live-1',
      title: 'Community Q&A',
      isLiveReplay: true,
      show: { id: 'show-1', title: 'VOXA LIVE Replays' },
    }]);

    const result = await service.discoverEpisodes({ limit: 10 });

    expect(prisma.episode.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ isLiveReplay: true }),
    }));
    expect(result.items[0].isLiveReplay).toBe(true);
  });

  it('requires the parent show to be published before publishing an episode', async () => {
    prisma.show.findFirst.mockResolvedValue({ id: 'show-1', status: 'DRAFT' });
    await expect(service.publishEpisode('creator-user', 'show-1', 'episode-1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.episode.findFirst).not.toHaveBeenCalled();
    expect(prisma.episode.update).not.toHaveBeenCalled();
  });

  it('requires an attached media object before publishing an episode', async () => {
    prisma.show.findFirst.mockResolvedValue({ id: 'show-1', status: 'PUBLISHED' });
    prisma.episode.findFirst.mockResolvedValue({
      id: 'episode-1', mediaKey: null, durationSeconds: 120,
    });
    await expect(service.publishEpisode('creator-user', 'show-1', 'episode-1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.episode.update).not.toHaveBeenCalled();
  });

  it('requires media processing to reach READY before publishing an episode', async () => {
    prisma.show.findFirst.mockResolvedValue({ id: 'show-1', status: 'PUBLISHED' });
    prisma.episode.findFirst.mockResolvedValue({
      id: 'episode-1', mediaKey: 'users/u/episodes/e/source.mp3', durationSeconds: 120,
    });
    prisma.mediaAsset.findFirst.mockResolvedValue(null);

    await expect(service.publishEpisode('creator-user', 'show-1', 'episode-1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.episode.update).not.toHaveBeenCalled();
  });

  it('bounds saved playback progress to the published episode duration', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'episode-1', durationSeconds: 120,
    });
    prisma.playbackProgress.upsert.mockResolvedValue({
      episodeId: 'episode-1', positionSeconds: 120, completed: true,
    });

    await service.saveProgress('listener-1', 'episode-1', 180);

    expect(prisma.playbackProgress.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ positionSeconds: 120, completed: true }),
      update: expect.objectContaining({ positionSeconds: 120, completed: true }),
    }));
  });
});


describe('ShowsService VOXA Moments', () => {
  let service: ShowsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      episode: { findFirst: jest.fn() },
      mediaAsset: { findFirst: jest.fn() },
      moment: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn(), findMany: jest.fn() },
    };
    service = new ShowsService(prisma as unknown as PrismaService);
  });

  it('creates a Moment only from a ready public video episode owned by the creator', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'episode-1',
      durationSeconds: 600,
      show: { creatorId: 'creator-1' },
    });
    prisma.mediaAsset.findFirst.mockResolvedValue({ id: 'asset-1' });
    prisma.moment.create.mockResolvedValue({ id: 'moment-1', status: 'DRAFT' });

    await service.createMoment('creator-user', 'episode-1', 'A useful highlight', 30, 75);

    expect(prisma.episode.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'episode-1',
        status: 'PUBLISHED',
        membershipRequired: false,
        show: expect.objectContaining({ status: 'PUBLISHED', creator: { userId: 'creator-user' } }),
      }),
    }));
    expect(prisma.mediaAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        episodeId: 'episode-1',
        status: 'READY',
        contentType: { startsWith: 'video/' },
        playbackKey: { not: null },
      }),
    }));
    expect(prisma.moment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { creatorId: 'creator-1', episodeId: 'episode-1', caption: 'A useful highlight', startSeconds: 30, endSeconds: 75 },
    }));
  });

  it('rejects a clip longer than 90 seconds', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'episode-1', durationSeconds: 600, show: { creatorId: 'creator-1' },
    });

    await expect(service.createMoment('creator-user', 'episode-1', 'Too long', 0, 91))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.mediaAsset.findFirst).not.toHaveBeenCalled();
    expect(prisma.moment.create).not.toHaveBeenCalled();
  });

  it('does not allow Moments from members-only or unowned episodes', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);

    await expect(service.createMoment('creator-user', 'episode-1', 'Private source', 0, 30))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.mediaAsset.findFirst).not.toHaveBeenCalled();
    expect(prisma.moment.create).not.toHaveBeenCalled();
  });
});


describe('ShowsService episode transcripts', () => {
  let service: ShowsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      show: { findFirst: jest.fn() },
      episode: { findFirst: jest.fn() },
      episodeTranscript: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
      membershipSubscription: { findFirst: jest.fn() },
    };
    service = new ShowsService(prisma as unknown as PrismaService);
  });

  it('returns a transcript for a published public episode', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'episode-1', membershipRequired: false, show: { creator: { id: 'creator-1', userId: 'owner-1' } },
    });
    prisma.episodeTranscript.findUnique.mockResolvedValue({ episodeId: 'episode-1', content: 'Welcome to VOXA.', language: 'en' });
    await expect(service.getEpisodeTranscript('episode-1')).resolves.toMatchObject({ content: 'Welcome to VOXA.' });
  });

  it('does not expose a members-only transcript to anonymous listeners', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'episode-1', membershipRequired: true, show: { creator: { id: 'creator-1', userId: 'owner-1' } },
    });
    await expect(service.getEpisodeTranscript('episode-1')).rejects.toThrow('Sign in and join this creator membership');
    expect(prisma.episodeTranscript.findUnique).not.toHaveBeenCalled();
  });

  it('allows a creator to save a transcript for an episode they own', async () => {
    prisma.show.findFirst.mockResolvedValue({ id: 'show-1', status: 'PUBLISHED' });
    prisma.episode.findFirst.mockResolvedValue({ id: 'episode-1' });
    prisma.episodeTranscript.upsert.mockResolvedValue({ episodeId: 'episode-1', content: 'Transcript text', language: 'en' });
    await service.saveEpisodeTranscript('owner-1', 'show-1', 'episode-1', ' Transcript text ', 'en');
    expect(prisma.episodeTranscript.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { episodeId: 'episode-1' },
      create: expect.objectContaining({ content: 'Transcript text', language: 'en' }),
    }));
  });

  it('rejects transcript edits for shows the creator does not own', async () => {
    prisma.show.findFirst.mockResolvedValue(null);
    await expect(service.saveEpisodeTranscript('intruder', 'show-1', 'episode-1', 'Transcript')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.episodeTranscript.upsert).not.toHaveBeenCalled();
  });
});


describe('ShowsService episode chapters', () => {
  let service: ShowsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      show: { findFirst: jest.fn() },
      episode: { findFirst: jest.fn() },
      episodeChapter: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    service = new ShowsService(prisma as unknown as PrismaService);
  });

  it('saves chapters in chronological order with stable positions', async () => {
    prisma.show.findFirst.mockResolvedValue({ id: 'show-1', status: 'PUBLISHED' });
    prisma.episode.findFirst.mockResolvedValue({ id: 'episode-1', durationSeconds: 900 });
    prisma.episodeChapter.deleteMany.mockResolvedValue({ count: 0 });
    prisma.episodeChapter.createMany.mockResolvedValue({ count: 2 });
    prisma.episodeChapter.findMany.mockResolvedValue([
      { id: 'chapter-1', title: 'Opening', startSeconds: 0, position: 0 },
      { id: 'chapter-2', title: 'Main topic', startSeconds: 120, position: 1 },
    ]);

    const result = await service.saveEpisodeChapters('owner-1', 'show-1', 'episode-1', [
      { title: 'Main topic', startSeconds: 120 },
      { title: 'Opening', startSeconds: 0 },
    ]);

    expect(prisma.episodeChapter.createMany).toHaveBeenCalledWith({ data: [
      { title: 'Opening', startSeconds: 0, position: 0, episodeId: 'episode-1' },
      { title: 'Main topic', startSeconds: 120, position: 1, episodeId: 'episode-1' },
    ] });
    expect(result).toHaveLength(2);
  });

  it('rejects duplicate timestamps and timestamps outside the episode', async () => {
    prisma.show.findFirst.mockResolvedValue({ id: 'show-1', status: 'PUBLISHED' });
    prisma.episode.findFirst.mockResolvedValue({ id: 'episode-1', durationSeconds: 100 });
    await expect(service.saveEpisodeChapters('owner-1', 'show-1', 'episode-1', [
      { title: 'One', startSeconds: 10 }, { title: 'Two', startSeconds: 10 },
    ])).rejects.toThrow('Chapter timestamps must be unique');
    await expect(service.saveEpisodeChapters('owner-1', 'show-1', 'episode-1', [
      { title: 'Beyond end', startSeconds: 100 },
    ])).rejects.toThrow('within the episode duration');
    expect(prisma.episodeChapter.createMany).not.toHaveBeenCalled();
  });

  it('does not allow a different creator to edit chapter guides', async () => {
    prisma.show.findFirst.mockResolvedValue(null);
    await expect(service.saveEpisodeChapters('intruder', 'show-1', 'episode-1', [
      { title: 'Opening', startSeconds: 0 },
    ])).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.episodeChapter.createMany).not.toHaveBeenCalled();
  });
});


describe('ShowsService personalized discovery', () => {
  let service: ShowsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      playbackProgress: { findMany: jest.fn().mockResolvedValue([]) },
      episodeBookmark: { findMany: jest.fn().mockResolvedValue([]) },
      follow: { findMany: jest.fn().mockResolvedValue([]) },
      episode: { findMany: jest.fn() },
    };
    service = new ShowsService(prisma as unknown as PrismaService);
  });

  it('provides recent public episodes to a new listener with no history', async () => {
    prisma.episode.findMany.mockResolvedValue([{
      id: 'episode-new', title: 'A fresh start', publishedAt: new Date(),
      show: { id: 'show-1', title: 'VOXA Daily', category: 'Culture', creatorId: 'creator-1',
        creator: { handle: 'voxa', user: { displayName: 'VOXA' } } },
    }]);

    const result = await service.getPersonalizedRecommendations('listener-new', 8);

    expect(result.personalized).toBe(false);
    expect(result.items[0]).toMatchObject({ id: 'episode-new', reason: 'Popular on VOXA' });
    expect(prisma.episode.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'PUBLISHED',
        membershipRequired: false,
        show: { status: 'PUBLISHED' },
      }),
    }));
  });

  it('uses listening categories and excludes episodes already heard or saved', async () => {
    prisma.playbackProgress.findMany.mockResolvedValue([{
      episodeId: 'already-heard',
      episode: { show: { category: 'Technology', creatorId: 'creator-tech' } },
    }]);
    prisma.episodeBookmark.findMany.mockResolvedValue([{
      episodeId: 'already-saved',
      episode: { show: { category: 'Technology', creatorId: 'creator-tech' } },
    }]);
    prisma.episode.findMany.mockResolvedValue([{
      id: 'recommended-1', title: 'Building useful tools', publishedAt: new Date(),
      show: { id: 'show-2', title: 'Tech Voices', category: 'Technology', creatorId: 'creator-other',
        creator: { handle: 'techvoices', user: { displayName: 'Tech Voices' } } },
    }]);

    const result = await service.getPersonalizedRecommendations('listener-1', 8);
    const candidateQuery = prisma.episode.findMany.mock.calls[0][0];

    expect(result.personalized).toBe(true);
    expect(result.items[0]).toMatchObject({ id: 'recommended-1', reason: 'Based on topics you listen to' });
    expect(candidateQuery.where.membershipRequired).toBe(false);
    expect(candidateQuery.where.id.notIn).toEqual(expect.arrayContaining(['already-heard', 'already-saved']));
    expect(candidateQuery.where.OR).toEqual(expect.arrayContaining([
      { show: { category: { in: ['Technology'] } } },
    ]));
  });
});


describe('ShowsService episode unpublishing', () => {
  let service: ShowsService;
  let prisma: any;
  beforeEach(() => {
    prisma = {
      show: { findFirst: jest.fn() },
      episode: { findFirst: jest.fn(), updateMany: jest.fn() },
    };
    service = new ShowsService(prisma as unknown as PrismaService);
  });
  it('returns an owned published episode to draft', async () => {
    prisma.show.findFirst.mockResolvedValue({ id: 'show-1', status: 'PUBLISHED' });
    prisma.episode.findFirst.mockResolvedValue({ id: 'episode-1', status: 'PUBLISHED' });
    prisma.episode.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.unpublishEpisode('creator-1', 'show-1', 'episode-1')).resolves.toEqual({
      id: 'episode-1', showId: 'show-1', status: 'DRAFT', unpublished: true,
    });
    expect(prisma.episode.updateMany).toHaveBeenCalledWith({
      where: { id: 'episode-1', showId: 'show-1', status: 'PUBLISHED' },
      data: { status: 'DRAFT', publishedAt: null },
    });
  });
  it('does not unpublish an episode outside the creator account', async () => {
    prisma.show.findFirst.mockResolvedValue(null);
    await expect(service.unpublishEpisode('intruder', 'show-1', 'episode-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.episode.updateMany).not.toHaveBeenCalled();
  });
});


describe('ShowsService AI topic discovery', () => {
  let service: ShowsService;
  let prisma: any;

  beforeEach(() => {
    prisma = { episodeIntelligence: { findMany: jest.fn() } };
    service = new ShowsService(prisma as unknown as PrismaService);
  });

  it('aggregates topic labels from published public episode intelligence', async () => {
    prisma.episodeIntelligence.findMany.mockResolvedValue([
      { topics: ['Leadership', 'Faith'] },
      { topics: ['leadership', 'Personal growth'] },
    ]);

    await expect(service.discoverTopics()).resolves.toEqual({
      items: [
        { topic: 'Leadership', count: 2 },
        { topic: 'Faith', count: 1 },
        { topic: 'Personal growth', count: 1 },
      ],
    });
    expect(prisma.episodeIntelligence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { episode: { status: 'PUBLISHED', membershipRequired: false, show: { status: 'PUBLISHED' } } },
      take: 500,
    }));
  });

  it('returns only public published episodes tagged with the selected topic', async () => {
    prisma.episodeIntelligence.findMany.mockResolvedValue([
      { topics: ['Faith'], episode: { id: 'episode-1', title: 'Faith in action' } },
      { topics: ['Leadership'], episode: { id: 'episode-2', title: 'Leading well' } },
    ]);

    await expect(service.discoverTopicEpisodes('Faith')).resolves.toMatchObject({
      topic: 'Faith',
      items: [{ id: 'episode-1', title: 'Faith in action', matchingMoments: [] }],
    });
    expect(prisma.episodeIntelligence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { episode: { status: 'PUBLISHED', membershipRequired: false, show: { status: 'PUBLISHED' } } },
    }));
  });

  it('rejects blank and oversized topic requests without querying the database', async () => {
    await expect(service.discoverTopicEpisodes('  ')).resolves.toEqual({ items: [] });
    await expect(service.discoverTopicEpisodes('x'.repeat(61))).resolves.toEqual({ items: [] });
    expect(prisma.episodeIntelligence.findMany).not.toHaveBeenCalled();
  });
});


describe('ShowsService semantic podcast search', () => {
  let service: ShowsService;
  let prisma: any;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    prisma = { episode: { findMany: jest.fn() }, episodeEmbedding: { upsert: jest.fn() } };
    service = new ShowsService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('rejects short queries before calling the embedding provider', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    await expect(service.semanticSearch('hi')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.episode.findMany).not.toHaveBeenCalled();
  });

  it('fails clearly when semantic search has no server-side provider key', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(service.semanticSearch('episodes about courage')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.episode.findMany).not.toHaveBeenCalled();
  });


  it('ranks public episodes using cached document vectors and returns semantic context', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const provider = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [1, 0] }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [
          { index: 0, embedding: [0.95, 0.05] },
          { index: 1, embedding: [0, 1] },
        ] }),
      } as Response);
    prisma.episode.findMany.mockResolvedValue([
      {
        id: 'episode-best', title: 'Finding courage', description: 'A story about fear and hope',
        artworkUrl: null, durationSeconds: 600, isExplicit: false, isLiveReplay: false,
        membershipRequired: false, publishedAt: new Date(),
        show: { id: 'show-1', title: 'Human stories', category: 'Life', language: 'en', creator: { handle: 'host', user: { displayName: 'Host' } } },
        transcript: { content: 'A conversation about fear and courage', segments: [{ text: 'Choose courage when fear arrives', startSeconds: 45, speaker: 'Host' }] },
        intelligence: { summary: 'A hopeful story', topics: ['Resilience'] }, semanticEmbedding: null,
      },
      {
        id: 'episode-other', title: 'Cooking basics', description: 'Kitchen tips',
        artworkUrl: null, durationSeconds: 300, isExplicit: false, isLiveReplay: false,
        membershipRequired: false, publishedAt: new Date(),
        show: { id: 'show-2', title: 'Food school', category: 'Food', language: 'en', creator: { handle: 'chef', user: { displayName: 'Chef' } } },
        transcript: null, intelligence: null, semanticEmbedding: null,
      },
    ]);
    prisma.episodeEmbedding.upsert.mockResolvedValue({});

    const result = await service.semanticSearch('how to face fear and become brave');

    expect(result.items[0].id).toBe('episode-best');
    expect(result.items[0].semanticExcerpt).toContain('Choose courage');
    expect(result.items[0].semanticExcerptStartSeconds).toBe(45);
    expect(prisma.episode.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PUBLISHED', membershipRequired: false, show: { status: 'PUBLISHED' } },
      take: 250,
    }));
    expect(prisma.episodeEmbedding.upsert).toHaveBeenCalledTimes(2);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('ranks vectors by cosine similarity and handles mismatched dimensions safely', () => {
    expect((service as any).cosineSimilarity([1, 0], [0.9, 0.1])).toBeGreaterThan(
      (service as any).cosineSimilarity([1, 0], [0, 1]),
    );
    expect((service as any).cosineSimilarity([1, 0], [1])).toBe(0);
  });
});


describe('ShowsService creator production assistant', () => {
  let service: ShowsService;
  let prisma: any;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    prisma = {
      show: { findFirst: jest.fn() },
      episode: { findFirst: jest.fn() },
    };
    service = new ShowsService(prisma as unknown as PrismaService);
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('only reviews episodes belonging to the authenticated creator', async () => {
    prisma.show.findFirst.mockResolvedValue(null);
    await expect(service.generateEpisodeProductionAdvice('intruder', 'show-1', 'episode-1'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.episode.findFirst).not.toHaveBeenCalled();
  });

  it('requires the AI provider key before generating advice', async () => {
    prisma.show.findFirst.mockResolvedValue({ id: 'show-1', status: 'DRAFT' });
    prisma.episode.findFirst.mockResolvedValue({
      id: 'episode-1', title: 'A draft episode', description: null, status: 'DRAFT',
      durationSeconds: 300, show: { title: 'My show', category: 'Culture', description: null },
      transcript: null, chapters: [],
    });
    await expect(service.generateEpisodeProductionAdvice('owner-1', 'show-1', 'episode-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not generate production advice for published episodes', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    prisma.show.findFirst.mockResolvedValue({ id: 'show-1', status: 'PUBLISHED' });
    prisma.episode.findFirst.mockResolvedValue({
      id: 'episode-1', title: 'Published episode', status: 'PUBLISHED',
    });
    await expect(service.generateEpisodeProductionAdvice('owner-1', 'show-1', 'episode-1'))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
