import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShowsService } from './shows.service';

describe('ShowsService publishing and playback progress', () => {
  let service: ShowsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      creator: { findUnique: jest.fn() },
      show: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
      episode: { findFirst: jest.fn(), update: jest.fn() },
      playbackProgress: { upsert: jest.fn() },
    };
    service = new ShowsService(prisma as unknown as PrismaService);
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
