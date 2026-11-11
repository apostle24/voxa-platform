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
      liveRoom: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
      liveStageMember: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      liveViewerSession: { upsert: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn(), findUnique: jest.fn() },
      liveChatMessage: { count: jest.fn() },
      stageRequest: { upsert: jest.fn(), groupBy: jest.fn() },
      $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => callback(prisma)),
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

  it('ends the room and closes stage and audience sessions atomically', async () => {
    const endedAt = new Date('2026-11-11T12:00:00.000Z');
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    prisma.liveRoom.update.mockResolvedValue({ id: 'room-1', status: 'ENDED', endedAt });
    prisma.liveStageMember.updateMany.mockResolvedValue({ count: 2 });
    prisma.liveViewerSession.updateMany.mockResolvedValue({ count: 4 });
    jest.spyOn(service as any, 'roomServiceClient').mockReturnValue({ deleteRoom: jest.fn().mockResolvedValue(undefined) });
    const result = await service.endRoom('host-1', 'room-1');
    expect(result).toEqual({ id: 'room-1', status: 'ENDED', endedAt });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.liveStageMember.updateMany).toHaveBeenCalledWith({ where: { roomId: 'room-1', leftAt: null }, data: { leftAt: endedAt } });
    expect(prisma.liveViewerSession.updateMany).toHaveBeenCalledWith({ where: { roomId: 'room-1', leftAt: null }, data: { leftAt: endedAt } });
  });

  it('returns room activity analytics only to the host', async () => {
    const startedAt = new Date('2026-11-11T10:00:00.000Z');
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', title: 'VOXA Live', status: 'LIVE', startedAt, endedAt: null, peakAudienceCount: 6 });
    prisma.liveStageMember.findMany.mockResolvedValue([{ userId: 'speaker-1', role: 'SPEAKER', joinedAt: new Date('2026-11-11T10:05:00.000Z'), leftAt: null }]);
    prisma.stageRequest.groupBy.mockResolvedValue([{ status: 'APPROVED', _count: { _all: 1 } }, { status: 'PENDING', _count: { _all: 2 } }]);
    prisma.liveChatMessage.count.mockResolvedValueOnce(8).mockResolvedValueOnce(1);
    prisma.liveViewerSession.groupBy.mockResolvedValue([{ userId: 'viewer-1' }, { userId: 'viewer-2' }, { userId: 'viewer-3' }, { userId: 'speaker-1' }, { userId: 'host-1' }]);
    const result = await service.getRoomAnalytics('host-1', 'room-1');
    expect(result.stage.totalSpeakerSessions).toBe(1);
    expect(result.stage.activeSpeakers).toBe(1);
    expect(result.requests).toEqual({ pending: 2, approved: 1, rejected: 0 });
    expect(result.chat).toEqual({ totalMessages: 8, removedMessages: 1, visibleMessages: 7 });
    expect(result.audience).toEqual({ concurrentViewers: 3, peakConcurrentViewers: 6 });
    expect(result.measurementNote).toContain('45 seconds');
  });

  it('does not disclose room analytics to a non-host', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    await expect(service.getRoomAnalytics('listener-1', 'room-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.liveStageMember.findMany).not.toHaveBeenCalled();
  });


  it('records one authenticated audience session and updates peak concurrent viewers', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', status: 'LIVE', hostId: 'host-1' });
    prisma.liveStageMember.findUnique.mockResolvedValue(null);
    prisma.liveStageMember.findMany.mockResolvedValue([]);
    prisma.liveViewerSession.findUnique.mockResolvedValue(null);
    prisma.liveViewerSession.upsert.mockResolvedValue({});
    prisma.liveViewerSession.groupBy.mockResolvedValue([{ userId: 'viewer-1' }, { userId: 'viewer-2' }]);
    const result = await service.heartbeatViewer('viewer-1', 'room-1', 'session_1234567890123456');
    expect(result).toEqual({ tracked: true, concurrentViewers: 2 });
    expect(prisma.liveViewerSession.upsert).toHaveBeenCalled();
    expect(prisma.liveRoom.updateMany).toHaveBeenCalledWith({
      where: { id: 'room-1', peakAudienceCount: { lt: 2 } }, data: { peakAudienceCount: 2 },
    });
  });

  it('rejects attempts to take over another account viewer session', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', status: 'LIVE', hostId: 'host-1' });
    prisma.liveStageMember.findUnique.mockResolvedValue(null);
    prisma.liveViewerSession.findUnique.mockResolvedValue({ userId: 'different-user' });
    await expect(service.heartbeatViewer('viewer-1', 'room-1', 'session_1234567890123456'))
      .rejects.toThrow('Viewer session belongs to another account');
    expect(prisma.liveViewerSession.upsert).not.toHaveBeenCalled();
  });

  it('does not count hosts as audience viewers', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', status: 'LIVE', hostId: 'host-1' });
    const result = await service.heartbeatViewer('host-1', 'room-1', 'session_1234567890123456');
    expect(result).toEqual({ tracked: false, reason: 'HOST_OR_SPEAKER' });
    expect(prisma.liveViewerSession.upsert).not.toHaveBeenCalled();
  });

  it('closes a viewer session on explicit leave', async () => {
    prisma.liveViewerSession.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.leaveViewer('viewer-1', 'room-1', 'session_1234567890123456');
    expect(result).toEqual({ left: true });
  });

});