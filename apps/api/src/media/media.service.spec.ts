import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from './media.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://storage.example/upload'),
}));

describe('MediaService upload safeguards', () => {
  let service: MediaService;
  let prisma: any;
  let config: any;
  let sendSpy: jest.SpyInstance;

  beforeEach(() => {
    prisma = {
      episode: {
        findFirst: jest.fn().mockResolvedValue({ id: 'episode-1', status: 'DRAFT' }),
        update: jest.fn(),
      },
      mediaAsset: {
        upsert: jest.fn().mockResolvedValue({ id: 'asset-1', status: 'QUEUED' }),
        findFirst: jest.fn(),
      },
    };
    config = {
      get: jest.fn((key: string, fallback?: unknown) => {
        const values: Record<string, unknown> = {
          S3_BUCKET: 'voxa-test',
          S3_UPLOAD_URL_TTL_SECONDS: 600,
          MEDIA_MAX_AUDIO_BYTES: 1000,
          MEDIA_MAX_VIDEO_BYTES: 2000,
        };
        return values[key] ?? fallback;
      }),
    };
    sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      ContentLength: 500,
      ContentType: 'audio/mpeg',
      Metadata: { ownerid: 'user-1', episodeid: 'episode-1' },
    } as never);
    service = new MediaService(prisma as unknown as PrismaService, config as ConfigService);
    jest.clearAllMocks();
    (getSignedUrl as jest.Mock).mockResolvedValue('https://storage.example/upload');
  });

  afterEach(() => sendSpy.mockRestore());

  it('issues a short-lived preview URL only for the creator owner of a READY draft', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'episode-1', mediaKey: 'live-recordings/room-1/replay.mp4',
    });
    prisma.mediaAsset.findFirst.mockResolvedValue({
      playbackKey: 'processed/episode-1/asset-1.mp4',
      contentType: 'video/mp4', sizeBytes: BigInt(2048), durationSeconds: 120,
    });

    const result = await service.getCreatorDraftPreviewUrl('user-1', 'episode-1');
    expect(result).toMatchObject({
      url: 'https://storage.example/upload', contentType: 'video/mp4',
      sizeBytes: '2048', durationSeconds: 120, expiresIn: 600,
    });
    expect(prisma.episode.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'episode-1', status: 'DRAFT', show: { creator: { userId: 'user-1' } } },
    }));
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('does not issue a draft preview URL to a non-owner', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);
    await expect(service.getCreatorDraftPreviewUrl('user-2', 'episode-1'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('does not preview a draft until its media asset is READY', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      id: 'episode-1', mediaKey: 'live-recordings/room-1/replay.mp4',
    });
    prisma.mediaAsset.findFirst.mockResolvedValue(null);
    await expect(service.getCreatorDraftPreviewUrl('user-1', 'episode-1'))
      .rejects.toThrow('still being processed');
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('does not issue a playback URL until a processed asset is READY', async () => {
    prisma.episode.findFirst.mockResolvedValue({
      mediaKey: 'users/user-1/episodes/episode-1/source.mp3',
      membershipRequired: false,
      show: { creatorId: 'creator-1' },
    });
    prisma.mediaAsset.findFirst.mockResolvedValue(null);

    await expect(service.getPlaybackUrl('episode-1')).rejects.toThrow('still being processed');
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses upload URL creation when the episode is not owned by the caller', async () => {
    prisma.episode.findFirst.mockResolvedValue(null);
    await expect(service.createUploadUrl('user-2', 'show-1', 'episode-1', {
      contentType: 'audio/mpeg', sizeBytes: 500,
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('rejects files larger than the configured audio limit before signing an upload', async () => {
    await expect(service.createUploadUrl('user-1', 'show-1', 'episode-1', {
      contentType: 'audio/mpeg', sizeBytes: 1001,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('creates a short-lived upload URL only for an owned draft episode', async () => {
    const result = await service.createUploadUrl('user-1', 'show-1', 'episode-1', {
      contentType: 'audio/mpeg', sizeBytes: 500,
    });
    expect(result).toMatchObject({
      uploadUrl: 'https://storage.example/upload',
      method: 'PUT',
      expiresIn: 600,
      headers: { 'Content-Type': 'audio/mpeg' },
    });
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('rejects completion when stored object ownership metadata does not match the caller', async () => {
    sendSpy.mockResolvedValueOnce({
      ContentLength: 500,
      ContentType: 'audio/mpeg',
      Metadata: { ownerid: 'someone-else', episodeid: 'episode-1' },
    } as never);
    await expect(service.completeUpload(
      'user-1', 'show-1', 'episode-1',
      'users/user-1/episodes/episode-1/123e4567-e89b-12d3-a456-426614174000.mp3',
    )).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.mediaAsset.upsert).not.toHaveBeenCalled();
    expect(prisma.episode.update).not.toHaveBeenCalled();
  });

  it('rejects object keys outside the caller and episode namespace', async () => {
    await expect(service.completeUpload(
      'user-1', 'show-1', 'episode-1',
      'users/user-2/episodes/episode-1/123e4567-e89b-12d3-a456-426614174000.mp3',
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('rejects a file whose bytes do not match its declared MIME type', async () => {
    sendSpy
      .mockResolvedValueOnce({
        ContentLength: 500,
        ContentType: 'audio/mpeg',
        Metadata: { ownerid: 'user-1', episodeid: 'episode-1' },
      } as never)
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]) },
      } as never);

    await expect(service.completeUpload(
      'user-1', 'show-1', 'episode-1',
      'users/user-1/episodes/episode-1/123e4567-e89b-12d3-a456-426614174000.mp3',
    )).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.mediaAsset.upsert).not.toHaveBeenCalled();
  });

  it('accepts an MP3 signature before recording the uploaded asset', async () => {
    sendSpy
      .mockResolvedValueOnce({
        ContentLength: 500,
        ContentType: 'audio/mpeg',
        Metadata: { ownerid: 'user-1', episodeid: 'episode-1' },
      } as never)
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0]) },
      } as never);

    const result = await service.completeUpload(
      'user-1', 'show-1', 'episode-1',
      'users/user-1/episodes/episode-1/123e4567-e89b-12d3-a456-426614174000.mp3',
    );
    expect(result).toMatchObject({ uploaded: true, contentType: 'audio/mpeg', processingStatus: 'QUEUED' });
    expect(prisma.mediaAsset.upsert).toHaveBeenCalledTimes(1);
  });
});
