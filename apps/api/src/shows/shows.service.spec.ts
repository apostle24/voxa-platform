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
