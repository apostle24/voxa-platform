import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LiveService } from './live.service';

describe('LiveService access boundaries', () => {
  let service: LiveService;
  let prisma: any;
  let config: any;

  beforeEach(() => {
    prisma = {
      liveRoom: { findUnique: jest.fn() },
      liveStageMember: { findMany: jest.fn() },
      liveChatMessage: { count: jest.fn() },
      stageRequest: { upsert: jest.fn(), groupBy: jest.fn() },
      liveStageMember: { findUnique: jest.fn() },
    };
    config = {
      get: jest.fn((key: string) => ({
        LIVEKIT_URL: 'wss://live.example.test',
        LIVEKIT_API_KEY: 'test-key',
        LIVEKIT_API_SECRET: 'test-secret',
      } as Record<string, string>)[key]),
    };
    service = new LiveService(prisma as unknown as PrismaService, config as unknown as ConfigService);
  });

  it('does not issue a join token to a non-host for a restricted room', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-1',
      hostId: 'host-1',
      status: 'LIVE',
      visibility: 'MEMBERS_ONLY',
      stage: [],
    });

    await expect(service.joinToken('listener-1', 'room-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not allow stage requests in restricted rooms', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-1',
      hostId: 'host-1',
      status: 'LIVE',
      visibility: 'PRIVATE',
    });

    await expect(service.requestStage('listener-1', 'room-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.stageRequest.upsert).not.toHaveBeenCalled();
  });

  it('returns room activity analytics only to the host', async () => {
    const startedAt = new Date('2026-11-11T10:00:00.000Z');
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', title: 'VOXA Live', status: 'LIVE', startedAt, endedAt: null });
    prisma.liveStageMember.findMany.mockResolvedValue([{ userId: 'speaker-1', role: 'SPEAKER', joinedAt: new Date('2026-11-11T10:05:00.000Z'), leftAt: null }]);
    prisma.stageRequest.groupBy.mockResolvedValue([{ status: 'APPROVED', _count: { _all: 1 } }, { status: 'PENDING', _count: { _all: 2 } }]);
    prisma.liveChatMessage.count.mockResolvedValueOnce(8).mockResolvedValueOnce(1);
    const result = await service.getRoomAnalytics('host-1', 'room-1');
    expect(result.stage.totalSpeakerSessions).toBe(1);
    expect(result.stage.activeSpeakers).toBe(1);
    expect(result.requests).toEqual({ pending: 2, approved: 1, rejected: 0 });
    expect(result.chat).toEqual({ totalMessages: 8, removedMessages: 1, visibleMessages: 7 });
    expect(result.measurementNote).toContain('unique viewers are not available');
  });

  it('does not disclose room analytics to a non-host', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    await expect(service.getRoomAnalytics('listener-1', 'room-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.liveStageMember.findMany).not.toHaveBeenCalled();
  });

});