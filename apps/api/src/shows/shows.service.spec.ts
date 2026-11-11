import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShowsService } from './shows.service';

describe('ShowsService publishing and playback progress', () => {
  let service: ShowsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      creator: { findUnique: jest.fn() },
      show: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
      episode: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
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

  it('unpublishes an owned published episode back to an editable draft', async () => {
    prisma.show.findFirst.mockResolvedValue({ id: 'show-1', status: 'PUBLISHED' });
    prisma.episode.findFirst.mockResolvedValue({ id: 'episode-1', status: 'PUBLISHED' });
    prisma.episode.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.unpublishEpisode('creator-user', 'show-1', 'episode-1')).resolves.toMatchObject({ id: 'episode-1', showId: 'show-1', status: 'DRAFT', publishedAt: null });
    expect(prisma.episode.updateMany).toHaveBeenCalledWith({
      where: { id: 'episode-1', showId: 'show-1', status: 'PUBLISHED' },
      data: { status: 'DRAFT', publishedAt: null },
    });
  });

  it('does not allow another creator to unpublish an episode', async () => {
    prisma.show.findFirst.mockResolvedValue(null);
    await expect(service.unpublishEpisode('intruder', 'show-1', 'episode-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.episode.findFirst).not.toHaveBeenCalled();
    expect(prisma.episode.updateMany).not.toHaveBeenCalled();
  });

  it('rejects unpublishing an episode that is already a draft', async () => {
    prisma.show.findFirst.mockResolvedValue({ id: 'show-1', status: 'PUBLISHED' });
    prisma.episode.findFirst.mockResolvedValue({ id: 'episode-1', status: 'DRAFT' });
    await expect(service.unpublishEpisode('creator-user', 'show-1', 'episode-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.episode.updateMany).not.toHaveBeenCalled();
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
