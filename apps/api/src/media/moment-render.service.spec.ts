import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaService } from './media.service';

describe('MediaService Moment rendering', () => {
  const moment = {
    id: 'moment-1', startSeconds: 12, endSeconds: 42,
    episode: {
      durationSeconds: 120, mediaKey: 'source.mp4', status: 'PUBLISHED', membershipRequired: false,
      show: { status: 'PUBLISHED' },
      mediaAssets: [{ playbackKey: 'processed/source.mp4', contentType: 'video/mp4' }],
    },
  };
  let prisma: any;
  let service: MediaService;

  beforeEach(() => {
    prisma = {
      moment: { findFirst: jest.fn().mockResolvedValue(moment) },
      momentRender: { create: jest.fn().mockResolvedValue({ id: 'render-1', status: 'QUEUED', aspectRatio: '9:16' }) },
    };
    const config = { get: (key: string, fallback?: unknown) => key === 'S3_BUCKET' ? 'voxa-test' : fallback };
    service = new MediaService(prisma, config as ConfigService);
  });

  it('queues an owner-authorized vertical render from a processed public video', async () => {
    await expect(service.createMomentRender('creator-1', 'moment-1', { aspectRatio: '9:16', subtitles: 'A key insight' }))
      .resolves.toMatchObject({ id: 'render-1', queued: true });
    expect(prisma.momentRender.create).toHaveBeenCalledWith({
      data: { momentId: 'moment-1', aspectRatio: '9:16', subtitles: 'A key insight' },
      select: { id: true, status: true, aspectRatio: true, createdAt: true },
    });
  });

  it('rejects render requests for Moments not owned by the caller', async () => {
    prisma.moment.findFirst.mockResolvedValue(null);
    await expect(service.createMomentRender('other-user', 'moment-1', { aspectRatio: '16:9' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.momentRender.create).not.toHaveBeenCalled();
  });

  it('rejects Moments without a ready video source', async () => {
    prisma.moment.findFirst.mockResolvedValue({ ...moment, episode: { ...moment.episode, mediaAssets: [] } });
    await expect(service.createMomentRender('creator-1', 'moment-1', { aspectRatio: '16:9' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects private or unpublished source episodes', async () => {
    prisma.moment.findFirst.mockResolvedValue({ ...moment, episode: { ...moment.episode, membershipRequired: true } });
    await expect(service.createMomentRender('creator-1', 'moment-1', { aspectRatio: '9:16' }))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
