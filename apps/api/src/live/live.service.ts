import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, EgressClient, EncodedFileOutput, RoomServiceClient, S3Upload, WebhookReceiver } from 'livekit-server-sdk';
import { LiveRoomStatus, LiveRoomVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLiveRoomDto } from './dto/create-live-room.dto';

@Injectable()
export class LiveService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  private liveKitConfig() {
    const url = this.config.get<string>('LIVEKIT_URL');
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
    if (!url || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('VOXA LIVE is not configured');
    }
    return { url, apiKey, apiSecret };
  }

  private roomServiceClient() {
    const { url, apiKey, apiSecret } = this.liveKitConfig();
    const host = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    return new RoomServiceClient(host, apiKey, apiSecret);
  }

  async getChatMessages(userId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, visibility: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.visibility !== LiveRoomVisibility.PUBLIC && room.hostId !== userId) throw new ForbiddenException('This room chat is not publicly accessible');
    const messages = await this.prisma.liveChatMessage.findMany({
      where: { roomId }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, content: true, deletedAt: true, createdAt: true, userId: true, author: { select: { displayName: true } } },
    });
    return { messages: messages.reverse().map(message => ({ ...message, content: message.deletedAt ? '[deleted]' : message.content })) };
  }

  async postChatMessage(userId: string, roomId: string, content: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true, visibility: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Chat is available only while the room is live');
    if (room.visibility !== LiveRoomVisibility.PUBLIC && room.hostId !== userId) throw new ForbiddenException('This room chat is not publicly accessible');
    const clean = content.trim();
    if (!clean) throw new ConflictException('Message cannot be empty');
    return this.prisma.liveChatMessage.create({
      data: { roomId, userId, content: clean },
      select: { id: true, content: true, createdAt: true, userId: true, author: { select: { displayName: true } } },
    });
  }

  async deleteChatMessage(userId: string, roomId: string, messageId: string) {
    const message = await this.prisma.liveChatMessage.findFirst({
      where: { id: messageId, roomId },
      select: { id: true, userId: true, room: { select: { hostId: true } } },
    });
    if (!message) throw new NotFoundException('Chat message not found');
    if (message.userId !== userId && message.room.hostId !== userId) throw new ForbiddenException('You can only remove your own message or moderate your room');
    await this.prisma.liveChatMessage.update({ where: { id: messageId }, data: { content: '[deleted]', deletedAt: new Date() } });
    return { deleted: true };
  }

  async endRoom(userId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== userId) throw new ForbiddenException('Only the host can end this room');
    if (room.status === LiveRoomStatus.ENDED || room.status === LiveRoomStatus.CANCELLED) {
      return { id: room.id, status: room.status, endedAt: room.endedAt };
    }

    // DeleteRoom forcibly disconnects all participants and prevents further joins.
    await this.roomServiceClient().deleteRoom(room.id);
    return this.prisma.$transaction(async (tx) => {
      const ended = await tx.liveRoom.update({
        where: { id: roomId },
        data: { status: LiveRoomStatus.ENDED, endedAt: new Date() },
        select: { id: true, status: true, endedAt: true },
      });
      const leftAt = ended.endedAt ?? new Date();
      await tx.liveStageMember.updateMany({ where: { roomId, leftAt: null }, data: { leftAt } });
      await tx.liveViewerSession.updateMany({ where: { roomId, leftAt: null }, data: { leftAt } });
      return ended;
    });
  }

  async createRoom(userId: string, input: CreateLiveRoomDto) {
    const room = await this.prisma.liveRoom.create({
      data: {
        hostId: userId,
        title: input.title.trim(),
        description: input.description?.trim(),
        isAudioOnly: input.isAudioOnly ?? false,
        visibility: (input.visibility ?? 'PUBLIC') as LiveRoomVisibility,
        status: LiveRoomStatus.DRAFT,
      },
      select: { id: true, title: true, description: true, visibility: true, isAudioOnly: true, status: true, createdAt: true },
    });
    return room;
  }

  async listLiveRooms() {
    return this.prisma.liveRoom.findMany({
      where: { status: { in: [LiveRoomStatus.LIVE, LiveRoomStatus.SCHEDULED] }, visibility: LiveRoomVisibility.PUBLIC },
      orderBy: [{ status: 'asc' }, { startedAt: 'desc' }, { scheduledAt: 'asc' }],
      take: 50,
      select: {
        id: true, title: true, description: true, isAudioOnly: true, status: true, startedAt: true,
        host: { select: { id: true, displayName: true, creator: { select: { handle: true } } } },
        _count: { select: { stage: true, requests: true } },
      },
    });
  }





  private egressClient() {
    const { url, apiKey, apiSecret } = this.liveKitConfig();
    const host = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    return new EgressClient(host, apiKey, apiSecret);
  }

  private recordingStorage() {
    const bucket = this.config.get<string>('LIVEKIT_RECORDING_S3_BUCKET') || this.config.get<string>('S3_BUCKET');
    const accessKey = this.config.get<string>('LIVEKIT_RECORDING_S3_ACCESS_KEY') || this.config.get<string>('S3_ACCESS_KEY_ID');
    const secret = this.config.get<string>('LIVEKIT_RECORDING_S3_SECRET_KEY') || this.config.get<string>('S3_SECRET_ACCESS_KEY');
    const region = this.config.get<string>('LIVEKIT_RECORDING_S3_REGION') || this.config.get<string>('S3_REGION') || 'auto';
    const endpoint = this.config.get<string>('LIVEKIT_RECORDING_S3_ENDPOINT') || this.config.get<string>('S3_ENDPOINT');
    if (!bucket || !accessKey || !secret) {
      throw new ServiceUnavailableException('Live room recording storage is not configured');
    }
    return new S3Upload({
      accessKey,
      secret,
      bucket,
      region,
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: this.config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
    });
  }

  async startRoomRecording(hostId: string, roomId: string, consentConfirmed: boolean) {
    if (this.config.get<string>('LIVEKIT_RECORDING_ENABLED') !== 'true') {
      throw new ServiceUnavailableException('Live room recording is disabled by configuration');
    }
    if (consentConfirmed !== true) throw new BadRequestException('Confirm that everyone speaking in the room has agreed to recording');
    const room = await this.prisma.liveRoom.findUnique({
      where: { id: roomId },
      select: { id: true, hostId: true, status: true, isAudioOnly: true, recordingStatus: true },
    });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the room host can start recording');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Recording can start only while the room is live');
    if (!['NOT_STARTED', 'FAILED'].includes(room.recordingStatus)) throw new ConflictException('A recording has already been started for this room');
    const consentAt = new Date();
    const claimed = await this.prisma.liveRoom.updateMany({
      where: { id: roomId, recordingStatus: room.recordingStatus },
      data: {
        recordingStatus: 'STARTING', recordingConsentAt: consentAt, recordingFailure: null,
        recordingEgressId: null, recordingObjectKey: null, recordingStartedAt: null, recordingEndedAt: null,
      },
    });
    if (claimed.count !== 1) throw new ConflictException('Recording state changed; refresh and try again');
    const filepath = `live-recordings/${roomId}/${Date.now()}.mp4`;
    try {
      const file = new EncodedFileOutput({
        filepath,
        output: { case: 's3', value: this.recordingStorage() },
      });
      const egress = await this.egressClient().startRoomCompositeEgress(roomId, { file }, { audioOnly: room.isAudioOnly });
      await this.prisma.liveRoom.update({
        where: { id: roomId },
        data: { recordingStatus: 'RECORDING', recordingEgressId: egress.egressId, recordingObjectKey: filepath, recordingStartedAt: new Date() },
      });
      return { roomId, recordingStatus: 'RECORDING', recordingId: egress.egressId };
    } catch (error) {
      await this.prisma.liveRoom.update({
        where: { id: roomId },
        data: { recordingStatus: 'FAILED', recordingFailure: 'Recording service could not start the recording' },
      });
      throw new ServiceUnavailableException('Unable to start live recording; verify LiveKit Egress and recording storage configuration');
    }
  }

  async stopRoomRecording(hostId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({
      where: { id: roomId },
      select: { id: true, hostId: true, recordingStatus: true, recordingEgressId: true },
    });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the room host can stop recording');
    if (room.recordingStatus !== 'RECORDING' || !room.recordingEgressId) throw new ConflictException('This room has no active recording');
    await this.prisma.liveRoom.update({ where: { id: roomId }, data: { recordingStatus: 'STOPPING' } });
    try {
      await this.egressClient().stopEgress(room.recordingEgressId);
      return { roomId, recordingStatus: 'STOPPING' };
    } catch {
      throw new ServiceUnavailableException('Unable to stop recording; check LiveKit Egress status before retrying');
    }
  }

  async receiveLiveKitWebhook(rawBody: string, authorization?: string) {
    if (!rawBody) throw new BadRequestException('LiveKit webhook body is required');
    const { apiKey, apiSecret } = this.liveKitConfig();
    let event;
    try {
      event = await new WebhookReceiver(apiKey, apiSecret).receive(rawBody, authorization);
    } catch {
      throw new UnauthorizedException('LiveKit webhook signature verification failed');
    }
    if (!event.id || !event.event) throw new BadRequestException('LiveKit webhook event is incomplete');

    const roomId = event.room?.name || null;
    const participantIdentity = event.participant?.identity || null;
    return this.prisma.$transaction(async (tx) => {
      const inserted = await tx.liveKitWebhookEvent.createMany({
        data: [{ eventId: event.id, eventType: event.event, roomId, participantIdentity }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return { received: true, duplicate: true };

      if (event.egressInfo?.egressId && event.event === 'egress_ended') {
        const fileLocation = event.egressInfo.fileResults?.[0]?.location || null;
        await tx.liveRoom.updateMany({
          where: { recordingEgressId: event.egressInfo.egressId },
          data: {
            recordingStatus: event.egressInfo.status === 4 ? 'FAILED' : 'COMPLETED',
            recordingEndedAt: new Date(),
            ...(fileLocation ? { recordingObjectKey: fileLocation } : {}),
            ...(event.egressInfo.status === 4 ? { recordingFailure: 'LiveKit Egress reported a recording failure' } : {}),
          },
        });
      }
      if (roomId && event.event === 'room_finished') {
        const endedAt = new Date();
        await tx.liveRoom.updateMany({
          where: { id: roomId, status: { notIn: [LiveRoomStatus.ENDED, LiveRoomStatus.CANCELLED] } },
          data: { status: LiveRoomStatus.ENDED, endedAt },
        });
        await tx.liveStageMember.updateMany({ where: { roomId, leftAt: null }, data: { leftAt: endedAt } });
        await tx.liveViewerSession.updateMany({ where: { roomId, leftAt: null }, data: { leftAt: endedAt } });
      } else if (roomId && participantIdentity &&
        (event.event === 'participant_left' || event.event === 'participant_connection_aborted')) {
        const leftAt = new Date();
        await tx.liveViewerSession.updateMany({
          where: { roomId, userId: participantIdentity, leftAt: null }, data: { leftAt },
        });
        await tx.liveStageMember.updateMany({
          where: { roomId, userId: participantIdentity, leftAt: null }, data: { leftAt },
        });
      }
      return { received: true, duplicate: false, event: event.event };
    });
  }

  private validateViewerSessionId(sessionId: string) {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(sessionId)) {
      throw new ConflictException('A valid viewer session ID is required');
    }
  }

  async heartbeatViewer(userId: string, roomId: string, sessionId: string) {
    this.validateViewerSessionId(sessionId);
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, status: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Viewer presence is available only while the room is live');
    const stageMember = await this.prisma.liveStageMember.findUnique({ where: { roomId_userId: { roomId, userId } }, select: { leftAt: true } });
    const existingSession = await this.prisma.liveViewerSession.findUnique({ where: { roomId_sessionId: { roomId, sessionId } }, select: { userId: true } });
    if (existingSession && existingSession.userId !== userId) throw new ForbiddenException('Viewer session belongs to another account');
    if (room.hostId === userId || (stageMember && stageMember.leftAt === null)) {
      await this.prisma.liveViewerSession.updateMany({ where: { roomId, userId, leftAt: null }, data: { leftAt: new Date() } });
      return { tracked: false, reason: 'HOST_OR_SPEAKER' };
    }
    const now = new Date();
    await this.prisma.liveViewerSession.upsert({
      where: { roomId_sessionId: { roomId, sessionId } },
      create: { roomId, userId, sessionId, joinedAt: now, lastSeenAt: now },
      update: { lastSeenAt: now, leftAt: null },
    });
    const activeSince = new Date(now.getTime() - 45_000);
    const [activeUsers, activeStageMembers] = await Promise.all([
      this.prisma.liveViewerSession.groupBy({ by: ['userId'], where: { roomId, leftAt: null, lastSeenAt: { gte: activeSince } } }),
      this.prisma.liveStageMember.findMany({ where: { roomId, leftAt: null }, select: { userId: true } }),
    ]);
    const excludedUserIds = new Set([room.hostId, ...activeStageMembers.map(member => member.userId)]);
    const concurrentViewers = activeUsers.filter(viewer => !excludedUserIds.has(viewer.userId)).length;
    await this.prisma.liveRoom.updateMany({
      where: { id: roomId, peakAudienceCount: { lt: concurrentViewers } },
      data: { peakAudienceCount: concurrentViewers },
    });
    return { tracked: true, concurrentViewers };
  }

  async leaveViewer(userId: string, roomId: string, sessionId: string) {
    this.validateViewerSessionId(sessionId);
    const result = await this.prisma.liveViewerSession.updateMany({
      where: { roomId, userId, sessionId, leftAt: null }, data: { leftAt: new Date() },
    });
    return { left: result.count > 0 };
  }

  async getRoomAnalytics(hostId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, title: true, status: true, startedAt: true, endedAt: true, peakAudienceCount: true, recordingStatus: true, recordingStartedAt: true, recordingEndedAt: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the room host can view room analytics');
    const activeSince = new Date(Date.now() - 45_000);
    const [stageMembers, requestCounts, chatMessageCount, deletedMessageCount, activeViewerUsers] = await Promise.all([
      this.prisma.liveStageMember.findMany({ where: { roomId }, orderBy: { joinedAt: 'asc' }, select: { userId: true, role: true, joinedAt: true, leftAt: true } }),
      this.prisma.stageRequest.groupBy({ by: ['status'], where: { roomId }, _count: { _all: true } }),
      this.prisma.liveChatMessage.count({ where: { roomId } }),
      this.prisma.liveChatMessage.count({ where: { roomId, deletedAt: { not: null } } }),
      this.prisma.liveViewerSession.groupBy({ by: ['userId'], where: { roomId, leftAt: null, lastSeenAt: { gte: activeSince } } }),
    ]);
    const now = room.endedAt ?? new Date();
    const durationSeconds = room.startedAt ? Math.max(0, Math.floor((now.getTime() - room.startedAt.getTime()) / 1000)) : 0;
    const speakers = stageMembers.map(member => ({
      userId: member.userId, role: member.role, joinedAt: member.joinedAt, leftAt: member.leftAt,
      durationSeconds: Math.max(0, Math.floor(((member.leftAt ?? now).getTime() - member.joinedAt.getTime()) / 1000)),
      currentlyOnStage: member.leftAt === null,
    }));
    const requests = Object.fromEntries(requestCounts.map(item => [item.status.toLowerCase(), item._count._all]));
    const stageUserIds = new Set([room.hostId, ...stageMembers.filter(member => member.leftAt === null).map(member => member.userId)]);
    const concurrentViewers = activeViewerUsers.filter(viewer => !stageUserIds.has(viewer.userId)).length;
    return {
      room: { id: room.id, title: room.title, status: room.status, startedAt: room.startedAt, endedAt: room.endedAt, durationSeconds, recordingStatus: room.recordingStatus, recordingStartedAt: room.recordingStartedAt, recordingEndedAt: room.recordingEndedAt },
      stage: { totalSpeakerSessions: speakers.length, activeSpeakers: speakers.filter(speaker => speaker.currentlyOnStage).length, speakers },
      requests: { pending: requests.pending ?? 0, approved: requests.approved ?? 0, rejected: requests.rejected ?? 0 },
      audience: { concurrentViewers, peakConcurrentViewers: room.peakAudienceCount },
      chat: { totalMessages: chatMessageCount, removedMessages: deletedMessageCount, visibleMessages: chatMessageCount - deletedMessageCount },
      measurementNote: 'Concurrent and peak audience counts use authenticated viewer heartbeats. A viewer is present for 45 seconds after their latest heartbeat; brief network interruptions may affect the estimate.',
    };
  }

  async getStageState(userId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true } });
    if (!room) throw new NotFoundException('Live room not found');
    const isHost = room.hostId === userId;
    const [requests, speakers, ownRequest] = await Promise.all([
      isHost ? this.prisma.stageRequest.findMany({
        where: { roomId, status: 'PENDING' },
        orderBy: { requestedAt: 'asc' },
        select: { id: true, userId: true, status: true, requestedAt: true },
      }) : Promise.resolve([]),
      this.prisma.liveStageMember.findMany({
        where: { roomId, leftAt: null },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true, role: true, joinedAt: true },
      }),
      !isHost ? this.prisma.stageRequest.findUnique({
        where: { roomId_userId: { roomId, userId } },
        select: { status: true, requestedAt: true },
      }) : Promise.resolve(null),
    ]);
    return { isHost, hostId: room.hostId, requests, speakers, ownRequest, status: room.status };
  }

  async joinToken(userId: string, roomId: string) {
    const { url, apiKey, apiSecret } = this.liveKitConfig();
    const room = await this.prisma.liveRoom.findUnique({
      where: { id: roomId },
      include: { stage: { where: { leftAt: null }, select: { userId: true, role: true } } },
    });
    if (!room) throw new NotFoundException('Live room not found');
    const isHost = room.hostId === userId;
    const isSpeaker = room.stage.some((member) => member.userId === userId);
    if (room.status === LiveRoomStatus.ENDED || room.status === LiveRoomStatus.CANCELLED) {
      throw new ConflictException('This live room has ended');
    }
    if (!isHost && room.visibility !== LiveRoomVisibility.PUBLIC) {
      throw new ForbiddenException('This room is not publicly accessible; membership and invite entitlements are not enabled yet');
    }
    if (room.status === LiveRoomStatus.DRAFT && !isHost) {
      throw new ConflictException('This live room has not started');
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      ttl: '10m',
      metadata: JSON.stringify({ voxaUserId: userId, roomId, role: isHost ? 'HOST' : isSpeaker ? 'SPEAKER' : 'AUDIENCE' }),
    });
    token.addGrant({
      roomJoin: true,
      room: room.id,
      canPublish: isHost || isSpeaker,
      canSubscribe: true,
      canPublishData: true,
    });

    if (isHost && room.status === LiveRoomStatus.DRAFT) {
      await this.prisma.liveRoom.update({
        where: { id: roomId },
        data: { status: LiveRoomStatus.LIVE, startedAt: new Date() },
      });
      const creator = await this.prisma.creator.findUnique({
        where: { userId },
        select: { id: true, followers: { select: { followerId: true } } },
      });
      if (creator?.followers.length) {
        await this.prisma.notification.createMany({
          data: creator.followers.map(({ followerId }) => ({
            recipientId: followerId,
            actorId: userId,
            type: 'CREATOR_LIVE',
            title: 'A creator you follow is live',
            body: room.title,
            resourceType: 'live_room',
            resourceId: room.id,
          })),
        });
      }
    }

    return { serverUrl: url, roomName: room.id, token: await token.toJwt(), canPublish: isHost || isSpeaker, expiresInSeconds: 600 };
  }

  async removeSpeaker(hostId: string, roomId: string, speakerId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the host can remove speakers');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Room is not live');
    if (speakerId === hostId) throw new ConflictException('The host cannot remove themselves from the stage');

    const member = await this.prisma.liveStageMember.findUnique({
      where: { roomId_userId: { roomId, userId: speakerId } },
    });
    if (!member || member.leftAt) throw new NotFoundException('Active stage member not found');

    // LiveKit removes the participant and revokes the current token on LiveKit Cloud.
    await this.roomServiceClient().removeParticipant(roomId, speakerId);
    const leftAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.liveStageMember.update({
        where: { roomId_userId: { roomId, userId: speakerId } }, data: { leftAt },
      });
      await tx.liveViewerSession.updateMany({
        where: { roomId, userId: speakerId, leftAt: null }, data: { leftAt },
      });
    });
    return { roomId, userId: speakerId, removedFromStage: true };
  }

  async requestStage(userId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true, visibility: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Stage requests are available only while the room is live');
    if (room.hostId === userId) throw new ConflictException('The host is already on stage');
    if (room.visibility !== LiveRoomVisibility.PUBLIC) throw new ForbiddenException('Stage requests for restricted rooms are not enabled yet');
    const active = await this.prisma.liveStageMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
    if (active && !active.leftAt) throw new ConflictException('You are already on stage');
    return this.prisma.stageRequest.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { roomId, userId },
      update: { status: 'PENDING', requestedAt: new Date(), decidedAt: null },
      select: { id: true, roomId: true, status: true, requestedAt: true },
    });
  }

  async decideStageRequest(hostId: string, roomId: string, requestId: string, approve: boolean) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the room host can approve speakers');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Room is not live');
    const request = await this.prisma.stageRequest.findFirst({ where: { id: requestId, roomId, status: 'PENDING' } });
    if (!request) throw new NotFoundException('Pending stage request not found');
    return this.prisma.$transaction(async (tx) => {
      if (approve) {
        await tx.liveViewerSession.updateMany({
          where: { roomId, userId: request.userId, leftAt: null }, data: { leftAt: new Date() },
        });
        await tx.liveStageMember.upsert({
          where: { roomId_userId: { roomId, userId: request.userId } },
          create: { roomId, userId: request.userId, role: 'SPEAKER' },
          update: { role: 'SPEAKER', leftAt: null, joinedAt: new Date() },
        });
      }
      return tx.stageRequest.update({
        where: { id: requestId },
        data: { status: approve ? 'APPROVED' : 'REJECTED', decidedAt: new Date() },
        select: { id: true, roomId: true, userId: true, status: true, decidedAt: true },
      });
    });
  }
}
