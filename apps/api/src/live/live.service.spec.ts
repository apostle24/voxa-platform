import { ConflictException, ForbiddenException } from '@nestjs/common';
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
      liveRoomModerator: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn(), deleteMany: jest.fn() },
      liveRoomCoHost: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn(), deleteMany: jest.fn() },
      liveRoomHostTransfer: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      liveGuestInvitation: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      notification: { create: jest.fn().mockResolvedValue({ id: 'notification-1', recipientId: 'guest-1', type: 'LIVE_GUEST_INVITATION', title: 'You are invited to speak on VOXA LIVE', body: null, resourceType: 'live_room', resourceId: 'room-1' }) },
      notificationDevice: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      livePoll: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
      livePollOption: { findFirst: jest.fn() },
      livePollVote: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      liveQuestion: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      liveAgendaItem: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
      liveSpeakerTurn: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
      user: { findUnique: jest.fn() },
      liveStageMember: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      liveViewerSession: { upsert: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn(), findUnique: jest.fn() },
      liveChatMessage: { count: jest.fn(), findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      stageRequest: { upsert: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), groupBy: jest.fn() },
      liveKitWebhookEvent: { createMany: jest.fn() },
      mediaAsset: { findUnique: jest.fn() },
      episodeTranscript: { upsert: jest.fn().mockResolvedValue({ episodeId: 'episode-1' }) },
      $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => callback(prisma)),
    };
    config = {
      get: jest.fn((key: string) => ({
        LIVEKIT_URL: 'wss://live.example.test',
        LIVEKIT_API_KEY: 'test-key',
        LIVEKIT_API_SECRET: 'test-secret',
        S3_BUCKET: 'voxa-test',
        LIVEKIT_CAPTIONS_INGEST_SECRET: 'test-ingest-secret',
      } as Record<string, string>)[key]),
    };
    service = new LiveService(prisma as unknown as PrismaService, config as unknown as ConfigService);
  });

  afterEach(() => { jest.restoreAllMocks(); });


  it('rejects LIVE transcript ingestion without the shared worker secret', async () => {
    await expect(service.ingestLiveTranscript('room-1', 'wrong-secret', {
      segments: [{ id: 'seg-1', text: 'Hello', speaker: 'speaker-1', startSeconds: 0, endSeconds: 1 }],
    })).rejects.toThrow('authentication failed');
    expect(prisma.liveRoom.findUnique).not.toHaveBeenCalled();
  });

  it('persists final transcript segments and updates an existing replay transcript', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-1', recordingStatus: 'COMPLETED',
      recordingObjectKey: 'live-recordings/room-1/session.mp4',
      recordingTranscript: { language: 'en', segments: [] },
    });
    prisma.liveRoom.update.mockResolvedValue({ id: 'room-1' });
    prisma.mediaAsset.findUnique.mockResolvedValue({ id: 'asset-1', episodeId: 'episode-1', episode: { isLiveReplay: true } });
    const result = await service.ingestLiveTranscript('room-1', 'test-ingest-secret', {
      language: 'en',
      segments: [{ id: 'seg-1', text: 'Welcome to VOXA', speaker: 'host-1', startSeconds: 2.5, endSeconds: 4 }],
    });
    expect(result).toEqual({ roomId: 'room-1', segmentCount: 1, replayTranscriptUpdated: true });
    expect(prisma.liveRoom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { recordingTranscript: expect.objectContaining({ segments: [expect.objectContaining({ id: 'seg-1', speaker: 'host-1' })] }) },
    }));
    expect(prisma.episodeTranscript.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { episodeId: 'episode-1' },
      create: expect.objectContaining({ episodeId: 'episode-1', content: expect.stringContaining('Welcome to VOXA') }),
    }));
  });

  it('rejects malformed transcript timestamps before writing to storage', async () => {
    await expect(service.ingestLiveTranscript('room-1', 'test-ingest-secret', {
      segments: [{ id: 'seg-1', text: 'Hello', speaker: 'speaker-1', startSeconds: 4, endSeconds: 2 }],
    })).rejects.toThrow('invalid IDs, text, speakers, or timestamps');
    expect(prisma.liveRoom.update).not.toHaveBeenCalled();
  });

  it('allows only the host or co-host to invite a guest into a future speaking slot', async () => {
    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'SCHEDULED' });
    prisma.user.findUnique.mockResolvedValue({ id: 'guest-1', displayName: 'Guest' });
    prisma.liveGuestInvitation.findUnique.mockResolvedValue(null);
    prisma.liveGuestInvitation.findFirst.mockResolvedValue(null);
    prisma.liveGuestInvitation.upsert.mockResolvedValue({ id: 'invite-1', status: 'PENDING' });
    const result = await service.inviteLiveGuest('host-1', 'room-1', {
      userId: 'guest-1', slotStartsAt: startsAt.toISOString(), slotEndsAt: endsAt.toISOString(),
    });
    expect(result).toEqual({ id: 'invite-1', status: 'PENDING' });
    expect(prisma.liveGuestInvitation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId_inviteeId: { roomId: 'room-1', inviteeId: 'guest-1' } },
    }));
    await expect(service.inviteLiveGuest('intruder-1', 'room-1', {
      userId: 'guest-1', slotStartsAt: startsAt.toISOString(), slotEndsAt: endsAt.toISOString(),
    })).rejects.toThrow(ForbiddenException);
  });

  it('prevents a guest speaker from receiving a handoff outside the accepted booking window', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    prisma.liveRoomCoHost.findUnique.mockResolvedValue(null);
    prisma.liveStageMember.findUnique.mockResolvedValue({ userId: 'guest-1', role: 'GUEST', leftAt: null });
    prisma.liveGuestInvitation.findFirst.mockResolvedValue(null);
    await expect(service.handoffSpeaker('host-1', 'room-1', 'guest-1'))
      .rejects.toThrow('accepted booking slot');
    expect(prisma.liveSpeakerTurn.create).not.toHaveBeenCalled();
  });

  it('records one poll vote per user and rejects a second vote', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE', visibility: 'PUBLIC' });
    prisma.livePoll.findFirst.mockResolvedValue({ id: 'poll-1', status: 'OPEN' });
    prisma.livePollOption.findFirst.mockResolvedValue({ id: 'option-1' });
    prisma.livePollVote.findUnique.mockResolvedValue(null);
    prisma.livePollVote.create.mockResolvedValue({ id: 'vote-1' });

    await expect(service.voteLivePoll('viewer-1', 'room-1', 'poll-1', 'option-1'))
      .resolves.toEqual({ pollId: 'poll-1', optionId: 'option-1', recorded: true });
    expect(prisma.livePollVote.create).toHaveBeenCalledWith({
      data: { pollId: 'poll-1', optionId: 'option-1', userId: 'viewer-1' },
    });

    prisma.livePollVote.findUnique.mockResolvedValue({ id: 'vote-1' });
    await expect(service.voteLivePoll('viewer-1', 'room-1', 'poll-1', 'option-2'))
      .rejects.toThrow('already voted');
    expect(prisma.livePollVote.create).toHaveBeenCalledTimes(1);
  });

  it('prevents overlapping accepted guest speaker bookings', async () => {
    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    prisma.liveGuestInvitation.findFirst.mockResolvedValue({ id: 'other-booking' });
    prisma.liveGuestInvitation.findUnique.mockResolvedValue({ id: 'invite-1', status: 'PENDING', slotStartsAt: startsAt, slotEndsAt: endsAt });
    await expect(service.respondToGuestInvitation('guest-1', 'room-1', 'invite-1', 'ACCEPTED'))
      .rejects.toThrow(ConflictException);
    expect(prisma.liveGuestInvitation.update).not.toHaveBeenCalled();
  });

  it('does not allow another account to answer a guest invitation', async () => {
    prisma.liveGuestInvitation.findFirst.mockResolvedValue(null);
    await expect(service.respondToGuestInvitation('intruder-1', 'room-1', 'invite-1', 'ACCEPTED'))
      .rejects.toThrow('Guest invitation not found');
  });

  it('lists only the signed-in host live rooms, including scheduled and past rooms', async () => {
    prisma.liveRoom.findMany.mockResolvedValue([{ id: 'room-1', hostId: 'host-1', status: 'SCHEDULED' }]);
    await expect(service.listMyLiveRooms('host-1')).resolves.toEqual([{ id: 'room-1', hostId: 'host-1', status: 'SCHEDULED' }]);
    expect(prisma.liveRoom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { hostId: 'host-1' }, take: 30,
    }));
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

  it('marks aborted Egress recordings as failed instead of publishing a replay', async () => {
    const receiver = jest.spyOn(WebhookReceiver.prototype, 'receive').mockResolvedValue({
      id: 'evt-egress-aborted-1',
      event: 'egress_ended',
      egressInfo: { egressId: 'egress-aborted', status: 5, fileResults: [{ location: 'live-recordings/room-1/partial.mp4' }] },
    } as any);
    prisma.liveKitWebhookEvent.createMany.mockResolvedValue({ count: 1 });
    prisma.liveRoom.updateMany.mockResolvedValue({ count: 1 });
    await service.receiveLiveKitWebhook('{"event":"egress_ended"}', 'signed-token');
    expect(prisma.liveRoom.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recordingEgressId: 'egress-aborted' },
      data: expect.objectContaining({ recordingStatus: 'FAILED', recordingObjectKey: null }),
    }));
    receiver.mockRestore();
  });

  it('does not mark a completed Egress as replay-ready when no file was uploaded', async () => {
    const receiver = jest.spyOn(WebhookReceiver.prototype, 'receive').mockResolvedValue({
      id: 'evt-egress-empty-1',
      event: 'egress_ended',
      egressInfo: { egressId: 'egress-empty', status: 3, fileResults: [] },
    } as any);
    prisma.liveKitWebhookEvent.createMany.mockResolvedValue({ count: 1 });
    prisma.liveRoom.updateMany.mockResolvedValue({ count: 1 });
    await service.receiveLiveKitWebhook('{"event":"egress_ended"}', 'signed-token');
    expect(prisma.liveRoom.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recordingEgressId: 'egress-empty' },
      data: expect.objectContaining({ recordingStatus: 'FAILED', recordingObjectKey: null }),
    }));
    receiver.mockRestore();
  });

  it('marks Egress complete only when LiveKit supplies the finished media location', async () => {
    const receiver = jest.spyOn(WebhookReceiver.prototype, 'receive').mockResolvedValue({
      id: 'evt-egress-complete-1',
      event: 'egress_ended',
      egressInfo: { egressId: 'egress-complete', status: 3, fileResults: [{ location: 's3://voxa-media/live-recordings/room-1/final.mp4' }] },
    } as any);
    prisma.liveKitWebhookEvent.createMany.mockResolvedValue({ count: 1 });
    prisma.liveRoom.updateMany.mockResolvedValue({ count: 1 });
    await service.receiveLiveKitWebhook('{"event":"egress_ended"}', 'signed-token');
    expect(prisma.liveRoom.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recordingEgressId: 'egress-complete' },
      data: expect.objectContaining({
        recordingStatus: 'COMPLETED',
        recordingObjectKey: 's3://voxa-media/live-recordings/room-1/final.mp4',
        recordingFailure: null,
      }),
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


  it('does not grant a stage member microphone publishing permission until the host hands over the floor', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-1', hostId: 'host-1', status: 'LIVE', visibility: 'PUBLIC',
      stage: [{ userId: 'speaker-2', role: 'SPEAKER' }],
    });
    prisma.liveSpeakerTurn.findFirst.mockResolvedValue(null);
    const result = await service.joinToken('speaker-2', 'room-1');
    expect(result.canPublish).toBe(false);
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

  it('moves a manual recording stop to STOPPING only once', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-1', hostId: 'host-1', recordingStatus: 'RECORDING', recordingEgressId: 'egress-1',
    });
    prisma.liveRoom.updateMany.mockResolvedValue({ count: 1 });
    const stopEgress = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(service as any, 'egressClient').mockReturnValue({ stopEgress });

    await expect(service.stopRoomRecording('host-1', 'room-1'))
      .resolves.toEqual({ roomId: 'room-1', recordingStatus: 'STOPPING' });
    expect(prisma.liveRoom.updateMany).toHaveBeenCalledWith({
      where: { id: 'room-1', recordingStatus: 'RECORDING', recordingEgressId: 'egress-1' },
      data: { recordingStatus: 'STOPPING' },
    });
    expect(stopEgress).toHaveBeenCalledWith('egress-1');
  });

  it('restores RECORDING when a manual stop request fails', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-1', hostId: 'host-1', recordingStatus: 'RECORDING', recordingEgressId: 'egress-1',
    });
    prisma.liveRoom.updateMany.mockResolvedValue({ count: 1 });
    jest.spyOn(service as any, 'egressClient').mockReturnValue({
      stopEgress: jest.fn().mockRejectedValue(new Error('egress unavailable')),
    });

    await expect(service.stopRoomRecording('host-1', 'room-1'))
      .rejects.toThrow('Unable to stop recording');
    expect(prisma.liveRoom.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'room-1', recordingStatus: 'STOPPING', recordingEgressId: 'egress-1' },
      data: { recordingStatus: 'RECORDING' },
    });
  });

  it('stops an active recording before deleting the live room', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-1', hostId: 'host-1', status: 'LIVE',
      recordingStatus: 'RECORDING', recordingEgressId: 'egress-1',
    });
    prisma.liveRoom.updateMany.mockResolvedValue({ count: 1 });
    prisma.liveRoom.update.mockResolvedValue({ id: 'room-1', status: 'ENDED', endedAt: new Date() });
    prisma.liveStageMember.updateMany.mockResolvedValue({ count: 0 });
    prisma.liveViewerSession.updateMany.mockResolvedValue({ count: 0 });
    const stopEgress = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(service as any, 'egressClient').mockReturnValue({ stopEgress });
    const deleteRoom = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(service as any, 'roomServiceClient').mockReturnValue({ deleteRoom });

    await service.endRoom('host-1', 'room-1');

    expect(stopEgress).toHaveBeenCalledWith('egress-1');
    expect(prisma.liveRoom.updateMany).toHaveBeenCalledWith({
      where: { id: 'room-1', recordingStatus: 'RECORDING', recordingEgressId: 'egress-1' },
      data: { recordingStatus: 'STOPPING' },
    });
    expect(deleteRoom).toHaveBeenCalledWith('room-1');
  });

  it('does not end the room when an active recording cannot be finalized', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-1', hostId: 'host-1', status: 'LIVE',
      recordingStatus: 'RECORDING', recordingEgressId: 'egress-1',
    });
    prisma.liveRoom.updateMany.mockResolvedValue({ count: 1 });
    const stopEgress = jest.fn().mockRejectedValue(new Error('egress unavailable'));
    jest.spyOn(service as any, 'egressClient').mockReturnValue({ stopEgress });
    const deleteRoom = jest.fn();
    jest.spyOn(service as any, 'roomServiceClient').mockReturnValue({ deleteRoom });

    await expect(service.endRoom('host-1', 'room-1')).rejects.toThrow('Unable to finalize the live recording');
    expect(deleteRoom).not.toHaveBeenCalled();
    expect(prisma.liveRoom.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'room-1', recordingStatus: 'STOPPING', recordingEgressId: 'egress-1' },
      data: { recordingStatus: 'RECORDING' },
    });
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

  it('returns the existing replay draft and processing state to its room host', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-1', hostId: 'host-1', title: 'VOXA Live', status: 'ENDED',
      startedAt: new Date('2026-11-11T10:00:00.000Z'), endedAt: new Date('2026-11-11T11:00:00.000Z'),
      peakAudienceCount: 6, recordingStatus: 'COMPLETED',
      recordingObjectKey: 's3://voxa-test/live-recordings/room-1/final.mp4',
    });
    prisma.liveStageMember.findMany.mockResolvedValue([]);
    prisma.stageRequest.groupBy.mockResolvedValue([]);
    prisma.liveChatMessage.count.mockResolvedValue(0);
    prisma.liveViewerSession.groupBy.mockResolvedValue([]);
    prisma.mediaAsset.findUnique.mockResolvedValue({
      id: 'asset-1', episodeId: 'episode-1', status: 'READY',
      episode: { status: 'DRAFT', isLiveReplay: true },
    });

    const result = await service.getRoomAnalytics('host-1', 'room-1');

    expect(prisma.mediaAsset.findUnique).toHaveBeenCalledWith({
      where: { objectKey: 'live-recordings/room-1/final.mp4' },
      select: { id: true, episodeId: true, status: true, episode: { select: { status: true, isLiveReplay: true } } },
    });
    expect(result.replayDraft).toEqual({
      episodeId: 'episode-1', mediaAssetId: 'asset-1',
      processingStatus: 'READY', episodeStatus: 'DRAFT',
    });
  });

  it('returns no replay draft when a completed recording has not been imported yet', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-1', hostId: 'host-1', title: 'VOXA Live', status: 'ENDED',
      startedAt: null, endedAt: null, peakAudienceCount: 0, recordingStatus: 'COMPLETED',
      recordingObjectKey: 'live-recordings/room-1/final.mp4',
    });
    prisma.liveStageMember.findMany.mockResolvedValue([]);
    prisma.stageRequest.groupBy.mockResolvedValue([]);
    prisma.liveChatMessage.count.mockResolvedValue(0);
    prisma.liveViewerSession.groupBy.mockResolvedValue([]);
    prisma.mediaAsset.findUnique.mockResolvedValue(null);

    const result = await service.getRoomAnalytics('host-1', 'room-1');
    expect(result.replayDraft).toBeNull();
  });

  it('does not disclose room analytics to a non-host', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    await expect(service.getRoomAnalytics('listener-1', 'room-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.liveStageMember.findMany).not.toHaveBeenCalled();
    expect(prisma.mediaAsset.findUnique).not.toHaveBeenCalled();
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


  it('lets the host assign a moderator to their room', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'moderator-1', displayName: 'Moderator One' });
    prisma.liveRoomModerator.upsert.mockResolvedValue({ id: 'assignment-1', userId: 'moderator-1' });
    await expect(service.addRoomModerator('host-1', 'room-1', 'moderator-1'))
      .resolves.toMatchObject({ id: 'assignment-1', userId: 'moderator-1', displayName: 'Moderator One' });
    expect(prisma.liveRoomModerator.upsert).toHaveBeenCalled();
  });

  it('prevents non-hosts from assigning room moderators', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    await expect(service.addRoomModerator('listener-1', 'room-1', 'moderator-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.liveRoomModerator.upsert).not.toHaveBeenCalled();
  });

  it('allows an assigned moderator to remove chat messages from their room', async () => {
    prisma.liveChatMessage.findFirst.mockResolvedValue({ id: 'message-1', userId: 'viewer-1', room: { hostId: 'host-1' } });
    prisma.liveRoomModerator.findUnique.mockResolvedValue({ id: 'assignment-1' });
    prisma.liveChatMessage.update.mockResolvedValue({});
    await expect(service.deleteChatMessage('moderator-1', 'room-1', 'message-1')).resolves.toEqual({ deleted: true });
    expect(prisma.liveChatMessage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'message-1' }, data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    }));
  });

  it('does not let an unassigned viewer moderate another user chat message', async () => {
    prisma.liveChatMessage.findFirst.mockResolvedValue({ id: 'message-1', userId: 'viewer-1', room: { hostId: 'host-1' } });
    prisma.liveRoomModerator.findUnique.mockResolvedValue(null);
    await expect(service.deleteChatMessage('stranger-1', 'room-1', 'message-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.liveChatMessage.update).not.toHaveBeenCalled();
  });

  it('returns moderator stage controls only to the assigned room moderator', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE', scheduledAt: null });
    prisma.liveRoomModerator.findUnique.mockResolvedValue({ id: 'assignment-1' });
    prisma.stageRequest.findMany.mockResolvedValue([{ id: 'request-1', userId: 'listener-1' }]);
    prisma.liveStageMember.findMany.mockResolvedValue([]);
    prisma.stageRequest.findUnique.mockResolvedValue(null);
    prisma.liveRoomModerator.findMany.mockResolvedValue([{ userId: 'moderator-1' }]);
    const state = await service.getStageState('moderator-1', 'room-1');
    expect(state).toMatchObject({ isHost: false, isModerator: true, requests: [{ id: 'request-1' }] });
  });


  it('allows an assigned moderator to create a poll with unique options', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    prisma.liveRoomModerator.findUnique.mockResolvedValue({ id: 'assignment-1' });
    prisma.livePoll.findFirst.mockResolvedValue(null);
    prisma.livePoll.create.mockResolvedValue({ id: 'poll-1', question: 'Which topic next?', status: 'OPEN', options: [{ id: 'a', text: 'Design' }, { id: 'b', text: 'Technology' }] });
    const result = await service.createLivePoll('moderator-1', 'room-1', 'Which topic next?', ['Design', 'Technology', 'Design']);
    expect(result).toMatchObject({ id: 'poll-1', status: 'OPEN' });
    expect(prisma.livePoll.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ roomId: 'room-1', createdBy: 'moderator-1', options: { create: [{ text: 'Design' }, { text: 'Technology' }] } }),
    }));
  });

  it('prevents a second open poll in the same live room', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    prisma.livePoll.findFirst.mockResolvedValue({ id: 'poll-open' });
    await expect(service.createLivePoll('host-1', 'room-1', 'Which topic next?', ['One', 'Two']))
      .rejects.toThrow('Close the current live poll');
    expect(prisma.livePoll.create).not.toHaveBeenCalled();
  });

  it('converts a concurrent open-poll unique-index conflict into a clear response', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    prisma.livePoll.findFirst.mockResolvedValue(null);
    prisma.livePoll.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.createLivePoll('host-1', 'room-1', 'Which topic next?', ['One', 'Two']))
      .rejects.toThrow('Close the current live poll');
  });

  it('prevents an unassigned listener from creating a live poll', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    prisma.liveRoomModerator.findUnique.mockResolvedValue(null);
    await expect(service.createLivePoll('listener-1', 'room-1', 'Which topic next?', ['One', 'Two']))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.livePoll.create).not.toHaveBeenCalled();
  });

  it('records one vote per user and rejects an option from another poll', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE', visibility: 'PUBLIC' });
    prisma.livePoll.findFirst.mockResolvedValue({ id: 'poll-1', status: 'OPEN' });
    prisma.livePollOption.findFirst.mockResolvedValue({ id: 'option-1' });
    prisma.livePollVote.upsert.mockResolvedValue({});
    await expect(service.voteLivePoll('listener-1', 'room-1', 'poll-1', 'option-1'))
      .resolves.toEqual({ pollId: 'poll-1', optionId: 'option-1', recorded: true });
    expect(prisma.livePollVote.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { pollId_userId: { pollId: 'poll-1', userId: 'listener-1' } },
    }));
    prisma.livePollOption.findFirst.mockResolvedValue(null);
    await expect(service.voteLivePoll('listener-1', 'room-1', 'poll-1', 'foreign-option')).rejects.toThrow('Choose an option from this poll');
  });

  it('stores audience questions as pending until a moderator approves them', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE', visibility: 'PUBLIC' });
    prisma.liveQuestion.create.mockResolvedValue({ id: 'question-1', question: 'Can you explain this?', status: 'PENDING' });
    await expect(service.submitLiveQuestion('listener-1', 'room-1', 'Can you explain this?'))
      .resolves.toMatchObject({ id: 'question-1', status: 'PENDING' });
    expect(prisma.liveQuestion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { roomId: 'room-1', userId: 'listener-1', question: 'Can you explain this?' },
    }));
  });

  it('allows a room moderator to approve and answer an audience question', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    prisma.liveRoomModerator.findUnique.mockResolvedValue({ id: 'assignment-1' });
    prisma.liveQuestion.findFirst.mockResolvedValue({ id: 'question-1', status: 'PENDING' });
    prisma.liveQuestion.update.mockResolvedValue({ id: 'question-1', status: 'ANSWERED', answer: 'Here is the answer.' });
    await expect(service.moderateLiveQuestion('moderator-1', 'room-1', 'question-1', { status: 'APPROVED', answer: 'Here is the answer.' }))
      .resolves.toMatchObject({ status: 'ANSWERED', answer: 'Here is the answer.' });
    expect(prisma.liveQuestion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'question-1' },
      data: expect.objectContaining({ status: 'ANSWERED', answeredBy: 'moderator-1', answer: 'Here is the answer.' }),
    }));
  });

  it('prevents an unassigned viewer from moderating audience questions', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    prisma.liveRoomModerator.findUnique.mockResolvedValue(null);
    await expect(service.moderateLiveQuestion('listener-1', 'room-1', 'question-1', { status: 'APPROVED' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.liveQuestion.update).not.toHaveBeenCalled();
  });




  it('grants appointed co-hosts private live-room access and host-level publishing permission', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({
      id: 'room-1', hostId: 'host-1', status: 'LIVE', visibility: 'PRIVATE', stage: [],
    });
    prisma.liveRoomCoHost.findUnique.mockResolvedValue({ id: 'cohost-assignment' });
    const token = await service.joinToken('cohost-1', 'room-1');
    expect(token.canPublish).toBe(true);
    expect(token.expiresInSeconds).toBe(600);
  });

  it('allows only the primary host to appoint a co-host', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'cohost-1', displayName: 'Co Host' });
    prisma.liveRoomCoHost.upsert.mockResolvedValue({ id: 'assignment-1', userId: 'cohost-1', assignedAt: new Date() });
    jest.spyOn(service as any, 'roomServiceClient').mockReturnValue({ listParticipants: jest.fn().mockResolvedValue([]), updateParticipant: jest.fn() });
    await expect(service.addRoomCoHost('host-1', 'room-1', 'cohost-1'))
      .resolves.toMatchObject({ userId: 'cohost-1', displayName: 'Co Host', role: 'CO_HOST' });
    expect(prisma.liveRoomModerator.deleteMany).toHaveBeenCalledWith({ where: { roomId: 'room-1', userId: 'cohost-1' } });
  });

  it('rejects co-host appointment by a moderator or another participant', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    await expect(service.addRoomCoHost('moderator-1', 'room-1', 'cohost-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.liveRoomCoHost.upsert).not.toHaveBeenCalled();
  });


  it('removes co-host privileges and closes that participant active speaker turn', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    prisma.liveRoomCoHost.deleteMany.mockResolvedValue({ count: 1 });
    const liveKitClient = {
      listParticipants: jest.fn().mockResolvedValue([{ identity: 'cohost-1' }]),
      updateParticipant: jest.fn().mockResolvedValue({}),
    };
    jest.spyOn(service as any, 'roomServiceClient').mockReturnValue(liveKitClient);
    await expect(service.removeRoomCoHost('host-1', 'room-1', 'cohost-1'))
      .resolves.toMatchObject({ removed: true, userId: 'cohost-1' });
    expect(prisma.liveSpeakerTurn.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId: 'room-1', status: 'ACTIVE', speakerId: 'cohost-1' },
    }));
    expect(liveKitClient.updateParticipant).toHaveBeenCalledWith('room-1', 'cohost-1', undefined, expect.objectContaining({ canPublish: false }));
  });

  it('transfers ownership only to an appointed co-host and preserves the former host as co-host', async () => {
    prisma.liveRoom.findUnique
      .mockResolvedValueOnce({ id: 'room-1', hostId: 'host-1', status: 'LIVE' })
      .mockResolvedValueOnce({ id: 'room-1', hostId: 'cohost-1', title: 'Live show', status: 'LIVE' });
    prisma.liveRoomCoHost.findUnique.mockResolvedValue({ userId: 'cohost-1' });
    prisma.liveRoom.updateMany.mockResolvedValue({ count: 1 });
    prisma.liveRoomCoHost.deleteMany.mockResolvedValue({ count: 1 });
    prisma.liveRoomCoHost.upsert.mockResolvedValue({ userId: 'host-1' });
    prisma.liveRoomModerator.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.transferRoomHost('host-1', 'room-1', 'cohost-1'))
      .resolves.toMatchObject({ hostId: 'cohost-1', previousHostId: 'host-1', newHostId: 'cohost-1', transferred: true });
    expect(prisma.liveRoom.updateMany).toHaveBeenCalledWith({
      where: { id: 'room-1', hostId: 'host-1' }, data: { hostId: 'cohost-1' },
    });
    expect(prisma.liveRoomCoHost.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId_userId: { roomId: 'room-1', userId: 'host-1' } },
      create: { roomId: 'room-1', userId: 'host-1', assignedById: 'cohost-1' },
    }));
  });

  it('does not transfer ownership to someone who is not an appointed co-host', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    prisma.liveRoomCoHost.findUnique.mockResolvedValue(null);
    await expect(service.transferRoomHost('host-1', 'room-1', 'listener-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.liveRoom.updateMany).not.toHaveBeenCalled();
  });

  it('allows an appointed co-host to control the session agenda', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    prisma.liveRoomCoHost.findUnique.mockResolvedValue({ id: 'cohost-assignment' });
    prisma.liveAgendaItem.findFirst.mockResolvedValue({ position: 0 });
    prisma.liveAgendaItem.create.mockResolvedValue({ id: 'agenda-2', title: 'Panel discussion', position: 1, status: 'PENDING' });
    await expect(service.createAgendaItem('cohost-1', 'room-1', { title: 'Panel discussion', durationSeconds: 600 }))
      .resolves.toMatchObject({ id: 'agenda-2', title: 'Panel discussion' });
  });

  it('allows an assigned moderator to add a session agenda item', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1' });
    prisma.liveRoomModerator.findUnique.mockResolvedValue({ id: 'mod-assignment' });
    prisma.liveAgendaItem.findFirst.mockResolvedValue({ position: 1 });
    prisma.liveAgendaItem.create.mockResolvedValue({ id: 'agenda-2', title: 'Audience questions', position: 2, status: 'PENDING' });
    await expect(service.createAgendaItem('moderator-1', 'room-1', { title: 'Audience questions', description: 'Questions from listeners', durationSeconds: 300 }))
      .resolves.toMatchObject({ id: 'agenda-2', position: 2, status: 'PENDING' });
    expect(prisma.liveAgendaItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ roomId: 'room-1', title: 'Audience questions', position: 2, durationSeconds: 300 }),
    }));
  });


  it('allows an appointed co-host to hand off the speaking turn without granting that power to moderators', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    prisma.liveRoomCoHost.findUnique.mockResolvedValue({ id: 'cohost-assignment' });
    prisma.liveStageMember.findUnique.mockResolvedValue({ userId: 'speaker-2', leftAt: null });
    prisma.liveSpeakerTurn.findFirst.mockResolvedValue(null);
    prisma.liveStageMember.findMany.mockResolvedValue([{ userId: 'speaker-2' }]);
    jest.spyOn(service as any, 'roomServiceClient').mockReturnValue({
      listParticipants: jest.fn().mockResolvedValue([{ identity: 'speaker-2' }]),
      updateParticipant: jest.fn().mockResolvedValue({}),
    });
    prisma.liveSpeakerTurn.create.mockResolvedValue({ id: 'turn-3', speakerId: 'speaker-2', status: 'ACTIVE' });
    await expect(service.handoffSpeaker('cohost-1', 'room-1', 'speaker-2'))
      .resolves.toMatchObject({ id: 'turn-3', speakerId: 'speaker-2' });
  });

  it('does not allow a moderator to take control of the speaker handoff', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    await expect(service.handoffSpeaker('moderator-1', 'room-1', 'speaker-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.liveSpeakerTurn.create).not.toHaveBeenCalled();
  });

  it('only hands the turn to a participant already admitted to the live stage', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    prisma.liveStageMember.findUnique.mockResolvedValue({ userId: 'listener-1', leftAt: new Date() });
    await expect(service.handoffSpeaker('host-1', 'room-1', 'listener-1')).rejects.toThrow('already be an active stage speaker');
    expect(prisma.liveSpeakerTurn.create).not.toHaveBeenCalled();
  });

  it('completes the previous speaker turn and records the host handoff', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    prisma.liveStageMember.findUnique.mockResolvedValue({ userId: 'speaker-2', leftAt: null });
    prisma.liveSpeakerTurn.findFirst.mockResolvedValue({ speakerId: 'speaker-1' });
    prisma.liveStageMember.findMany.mockResolvedValue([{ userId: 'speaker-1' }, { userId: 'speaker-2' }]);
    const liveKitClient = { listParticipants: jest.fn().mockResolvedValue([{ identity: 'speaker-1' }, { identity: 'speaker-2' }]), updateParticipant: jest.fn().mockResolvedValue({}) };
    jest.spyOn(service as any, 'roomServiceClient').mockReturnValue(liveKitClient);
    prisma.liveSpeakerTurn.create.mockResolvedValue({ id: 'turn-2', speakerId: 'speaker-2', status: 'ACTIVE' });
    await expect(service.handoffSpeaker('host-1', 'room-1', 'speaker-2'))
      .resolves.toMatchObject({ id: 'turn-2', speakerId: 'speaker-2', status: 'ACTIVE' });
    expect(prisma.liveSpeakerTurn.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId: 'room-1', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
    expect(prisma.liveSpeakerTurn.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { roomId: 'room-1', speakerId: 'speaker-2', agendaItemId: null },
    }));
    expect(liveKitClient.updateParticipant).toHaveBeenCalledWith('room-1', 'speaker-2', undefined, expect.objectContaining({ canPublish: true }));
    expect(liveKitClient.updateParticipant).toHaveBeenCalledWith('room-1', 'speaker-1', undefined, expect.objectContaining({ canPublish: false }));
  });

  it('starts a pending agenda segment and completes any previously active segment', async () => {
    prisma.liveRoom.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'host-1', status: 'LIVE' });
    prisma.liveAgendaItem.findFirst.mockResolvedValue({ id: 'agenda-1', status: 'PENDING' });
    prisma.liveAgendaItem.update.mockResolvedValue({ id: 'agenda-1', status: 'ACTIVE' });
    await expect(service.startAgendaItem('host-1', 'room-1', 'agenda-1')).resolves.toMatchObject({ id: 'agenda-1', status: 'ACTIVE' });
    expect(prisma.liveAgendaItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { roomId: 'room-1', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
  });

});
