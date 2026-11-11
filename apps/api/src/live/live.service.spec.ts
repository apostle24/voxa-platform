import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookReceiver } from 'livekit-server-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { LiveService } from './live.service';

describe('LiveService access boundaries', () => {
  let service: LiveService;
  let prisma: any;
  let config: any;

  beforeEach(() => {
    prisma = {
      userBlock: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      liveRoom: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
      liveStageMember: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      liveViewerSession: { upsert: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn(), findUnique: jest.fn() },
      liveChatMessage: { count: jest.fn(), findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      stageRequest: { upsert: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), groupBy: jest.fn() },
      liveKitWebhookEvent: { createMany: jest.fn() },
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

  it('hides live chat messages from accounts blocked in either direction', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', visibility: 'PUBLIC' });
    prisma.userBlock.findMany.mockResolvedValue([{ blockerId: 'viewer-1', blockedUserId: 'blocked-1' }]);
    prisma.liveChatMessage.findMany.mockResolvedValue([]);
    await service.getChatMessages('viewer-1', 'room-1');
    expect(prisma.liveChatMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId: 'room-1', userId: { notIn: ['blocked-1'] } },
    }));
  });

  it('prevents a user from chatting in a room hosted by a blocked account', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE', visibility: 'PUBLIC' });
    prisma.userBlock.findFirst.mockResolvedValue({ id: 'block-1' });
    await expect(service.postChatMessage('viewer-1', 'room-1', 'Hello')).rejects.toThrow('blocked');
    expect(prisma.liveChatMessage.create).not.toHaveBeenCalled();
  });

  it('verifies and idempotently reconciles a participant-left webhook', async () => {
    const receiver = jest.spyOn(WebhookReceiver.prototype, 'receive').mockResolvedValue({
      id: 'evt-left-1', event: 'participant_left', room: { name: 'room-1' },
      participant: { identity: 'viewer-1' },
    } as any);
    prisma.liveKitWebhookEvent.createMany.mockResolvedValue({ count: 1 });
    prisma.liveViewerSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.liveStageMember.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.receiveLiveKitWebhook('{"event":"participant_left"}', 'signed-token');
    expect(result).toEqual({ received: true, duplicate: false, event: 'participant_left' });
    expect(receiver).toHaveBeenCalledWith('{"event":"participant_left"}', 'signed-token');
    expect(prisma.liveViewerSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId: 'room-1', userId: 'viewer-1', leftAt: null },
    }));
    receiver.mockRestore();
  });

  it('does not reprocess duplicate LiveKit webhook deliveries', async () => {
    const receiver = jest.spyOn(WebhookReceiver.prototype, 'receive').mockResolvedValue({
      id: 'evt-left-duplicate', event: 'participant_left', room: { name: 'room-1' },
      participant: { identity: 'viewer-1' },
    } as any);
    prisma.liveKitWebhookEvent.createMany.mockResolvedValue({ count: 0 });
    const result = await service.receiveLiveKitWebhook('{"event":"participant_left"}', 'signed-token');
    expect(result).toEqual({ received: true, duplicate: true });
    expect(prisma.liveViewerSession.updateMany).not.toHaveBeenCalled();
    receiver.mockRestore();
  });

  it('rejects invalid LiveKit webhook signatures', async () => {
    const receiver = jest.spyOn(WebhookReceiver.prototype, 'receive').mockRejectedValue(new Error('bad signature'));
    await expect(service.receiveLiveKitWebhook('{"event":"room_finished"}', 'invalid'))
      .rejects.toThrow('LiveKit webhook signature verification failed');
    receiver.mockRestore();
  });

  it('marks an Egress recording failed from the signed egress_ended status', async () => {
    const receiver = jest.spyOn(WebhookReceiver.prototype, 'receive').mockResolvedValue({
      id: 'evt-egress-failed-1',
      event: 'egress_ended',
      egressInfo: { egressId: 'egress-1', status: 4, fileResults: [] },
    } as any);
    prisma.liveKitWebhookEvent.createMany.mockResolvedValue({ count: 1 });
    prisma.liveRoom.updateMany.mockResolvedValue({ count: 1 });
    await service.receiveLiveKitWebhook('{"event":"egress_ended"}', 'signed-token');
    expect(prisma.liveRoom.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recordingEgressId: 'egress-1' },
      data: expect.objectContaining({ recordingStatus: 'FAILED', recordingFailure: 'LiveKit Egress reported a recording failure' }),
    }));
    receiver.mockRestore();
  });




  it('allows a host to cancel a scheduled room', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-scheduled', hostId: 'host-1', status: 'SCHEDULED' });
    prisma.liveRoom.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.cancelScheduledRoom('host-1', 'room-scheduled'))
      .resolves.toEqual({ id: 'room-scheduled', status: 'CANCELLED' });
    expect(prisma.liveRoom.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'room-scheduled', hostId: 'host-1', status: 'SCHEDULED' },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
  });

  it('prevents non-hosts from cancelling scheduled rooms', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-scheduled', hostId: 'host-1', status: 'SCHEDULED' });
    await expect(service.cancelScheduledRoom('listener-1', 'room-scheduled'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.liveRoom.updateMany).not.toHaveBeenCalled();
  });

  it('does not cancel a room after it has started', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-scheduled', hostId: 'host-1', status: 'LIVE' });
    await expect(service.cancelScheduledRoom('host-1', 'room-scheduled'))
      .rejects.toThrow('Only scheduled rooms can be cancelled');
    expect(prisma.liveRoom.updateMany).not.toHaveBeenCalled();
  });

  it('includes the scheduled start time in the public live room listing', async () => {
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
    prisma.liveRoom.findMany.mockResolvedValue([{
      id: 'room-scheduled', title: 'Global Creator Roundtable', status: 'SCHEDULED', scheduledAt,
    }]);
    const rooms = await service.listLiveRooms();
    expect(prisma.liveRoom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ['LIVE', 'SCHEDULED'] }, visibility: 'PUBLIC' },
      select: expect.objectContaining({ scheduledAt: true }),
    }));
    expect(rooms[0].scheduledAt).toEqual(scheduledAt);
  });

  it('returns scheduled start time with host stage state', async () => {
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-scheduled', hostId: 'host-1', status: 'SCHEDULED', scheduledAt,
    });
    prisma.stageRequest.findMany.mockResolvedValue([]);
    prisma.liveStageMember.findMany.mockResolvedValue([]);
    const state = await service.getStageState('host-1', 'room-scheduled');
    expect(state).toEqual(expect.objectContaining({ isHost: true, status: 'SCHEDULED', scheduledAt }));
  });

  it('creates a scheduled room with its requested start time', async () => {
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
    prisma.liveRoom.create.mockResolvedValue({
      id: 'room-scheduled', title: 'Global Creator Roundtable', status: 'SCHEDULED', scheduledAt,
    });
    const result = await service.createRoom('host-1', {
      title: 'Global Creator Roundtable', scheduledAt: scheduledAt.toISOString(),
    } as any);
    expect(prisma.liveRoom.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ hostId: 'host-1', status: 'SCHEDULED', scheduledAt }),
    }));
    expect(result.status).toBe('SCHEDULED');
  });

  it('rejects scheduled rooms less than one minute in the future', async () => {
    await expect(service.createRoom('host-1', {
      title: 'Too soon', scheduledAt: new Date(Date.now() + 10_000).toISOString(),
    } as any)).rejects.toThrow('at least one minute in the future');
    expect(prisma.liveRoom.create).not.toHaveBeenCalled();
  });

  it('prevents listeners entering a scheduled room before it starts', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-scheduled', hostId: 'host-1', status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000), visibility: 'PUBLIC', stage: [],
    });
    await expect(service.joinToken('listener-1', 'room-scheduled'))
      .rejects.toThrow('This room is scheduled. Join when the host starts it.');
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