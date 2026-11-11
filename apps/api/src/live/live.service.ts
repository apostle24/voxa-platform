import { createUserNotification } from '../notifications/notification-writer';
import { timingSafeEqual } from 'crypto';
import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, AgentDispatchClient, EgressClient, EncodedFileOutput, RoomServiceClient, S3Upload, WebhookReceiver } from 'livekit-server-sdk';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { LiveRoomStatus, LiveRoomVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLiveRoomDto } from './dto/create-live-room.dto';

// LiveKit EgressStatus.COMPLETE from the LiveKit protocol enum.
const LIVEKIT_EGRESS_STATUS_COMPLETE = 3;

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

  private async dispatchCaptionsAgent(roomId: string) {
    if (this.config.get<string>('LIVEKIT_CAPTIONS_AGENT_ENABLED') !== 'true') return;
    const { url, apiKey, apiSecret } = this.liveKitConfig();
    const host = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    const agentName = this.config.get<string>('LIVEKIT_CAPTIONS_AGENT_NAME') || 'voxa-live-captions';
    try {
      const dispatches = await new AgentDispatchClient(host, apiKey, apiSecret).listDispatch(roomId);
      if (dispatches.some((dispatch) => dispatch.agentName === agentName)) return;
      await new AgentDispatchClient(host, apiKey, apiSecret).createDispatch(roomId, agentName);
    } catch (error) {
      // Captions are an optional enhancement: a worker outage must not prevent the host joining.
      console.warn('[VOXA LIVE] Unable to dispatch captions agent for room', roomId, error instanceof Error ? error.message : 'unknown error');
    }
  }


  private async isRoomCoHost(roomId: string, userId: string) {
    const assignment = await this.prisma.liveRoomCoHost.findUnique({
      where: { roomId_userId: { roomId, userId } }, select: { id: true },
    });
    return Boolean(assignment);
  }

  private async canManageLiveSession(roomId: string, userId: string, hostId: string) {
    return userId === hostId || this.isRoomCoHost(roomId, userId);
  }

  private async canModerateRoom(roomId: string, userId: string, hostId: string) {
    if (userId === hostId || await this.isRoomCoHost(roomId, userId)) return true;
    const assignment = await this.prisma.liveRoomModerator.findUnique({ where: { roomId_userId: { roomId, userId } }, select: { id: true } });
    return Boolean(assignment);
  }

  async listRoomModerators(hostId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the host can manage room moderators');
    return this.prisma.liveRoomModerator.findMany({ where: { roomId }, orderBy: { assignedAt: 'asc' }, select: { id: true, userId: true, assignedAt: true } });
  }

  async addRoomModerator(hostId: string, roomId: string, moderatorUserId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the host can manage room moderators');
    const targetId = moderatorUserId?.trim();
    if (!targetId) throw new BadRequestException('Enter a valid VOXA user ID');
    if (targetId === hostId) throw new ConflictException('The room host already has full room permissions');
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, displayName: true } });
    if (!target) throw new NotFoundException('VOXA user not found');
    if (await this.isRoomCoHost(roomId, targetId)) throw new ConflictException('This user is already a co-host');
    const assignment = await this.prisma.liveRoomModerator.upsert({
      where: { roomId_userId: { roomId, userId: targetId } },
      create: { roomId, userId: targetId },
      update: {},
      select: { id: true, userId: true, assignedAt: true },
    });
    return { ...assignment, displayName: target.displayName };
  }

  async removeRoomModerator(hostId: string, roomId: string, moderatorUserId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the host can manage room moderators');
    const result = await this.prisma.liveRoomModerator.deleteMany({ where: { roomId, userId: moderatorUserId } });
    if (!result.count) throw new NotFoundException('Room moderator not found');
    return { roomId, userId: moderatorUserId, removed: true };
  }



  private async syncCoHostPublishingPermission(roomId: string, userId: string, canPublish: boolean) {
    const client = this.roomServiceClient();
    try {
      const participants = await client.listParticipants(roomId);
      if (!participants.some(participant => participant.identity === userId)) return;
      await client.updateParticipant(roomId, userId, undefined, { canPublish, canSubscribe: true, canPublishData: true });
    } catch {
      try {
        // Force a fresh token if the current LiveKit participant cannot be updated in place.
        await client.removeParticipant(roomId, userId);
      } catch {
        throw new ServiceUnavailableException('The co-host assignment changed, but LiveKit could not refresh or revoke the existing participant session');
      }
    }
  }

  async listRoomCoHosts(userId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (!(await this.canManageLiveSession(roomId, userId, room.hostId))) throw new ForbiddenException('Only the host and appointed co-hosts can view the room leadership team');
    const [coHosts, host, transfers] = await Promise.all([
      this.prisma.liveRoomCoHost.findMany({
        where: { roomId }, orderBy: { assignedAt: 'asc' },
        select: { id: true, userId: true, assignedAt: true, user: { select: { displayName: true } }, assignedBy: { select: { displayName: true } } },
      }),
      this.prisma.user.findUnique({ where: { id: room.hostId }, select: { id: true, displayName: true } }),
      this.prisma.liveRoomHostTransfer.findMany({ where: { roomId }, orderBy: { transferredAt: 'desc' }, take: 20, select: { id: true, previousHostId: true, newHostId: true, transferredAt: true, previousHost: { select: { displayName: true } }, newHost: { select: { displayName: true } } } }),
    ]);
    return { host, coHosts, transfers };
  }

  async addRoomCoHost(hostId: string, roomId: string, coHostUserId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the primary host can appoint co-hosts');
    const targetId = coHostUserId?.trim();
    if (!targetId) throw new BadRequestException('Enter a valid VOXA user ID');
    if (targetId === hostId) throw new ConflictException('The primary host already has full room permissions');
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, displayName: true } });
    if (!target) throw new NotFoundException('VOXA user not found');
    const assignment = await this.prisma.$transaction(async (tx) => {
      await tx.liveRoomModerator.deleteMany({ where: { roomId, userId: targetId } });
      return tx.liveRoomCoHost.upsert({
        where: { roomId_userId: { roomId, userId: targetId } },
        create: { roomId, userId: targetId, assignedById: hostId },
        update: {},
        select: { id: true, userId: true, assignedAt: true },
      });
    });
    await this.syncCoHostPublishingPermission(roomId, targetId, true);
    return { ...assignment, displayName: target.displayName, role: 'CO_HOST' };
  }

  async removeRoomCoHost(hostId: string, roomId: string, coHostUserId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the primary host can remove co-hosts');
    const result = await this.prisma.liveRoomCoHost.deleteMany({ where: { roomId, userId: coHostUserId } });
    if (!result.count) throw new NotFoundException('Room co-host not found');
    await this.prisma.liveSpeakerTurn.updateMany({ where: { roomId, status: 'ACTIVE', speakerId: coHostUserId }, data: { status: 'COMPLETED', endedAt: new Date() } });
    await this.syncCoHostPublishingPermission(roomId, coHostUserId, false);
    return { roomId, userId: coHostUserId, removed: true };
  }

  async transferRoomHost(hostId: string, roomId: string, newHostUserId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the current primary host can transfer room ownership');
    if ([LiveRoomStatus.ENDED, LiveRoomStatus.CANCELLED].includes(room.status)) throw new ConflictException('Ownership cannot be transferred after the room has ended');
    const targetId = newHostUserId?.trim();
    if (!targetId) throw new BadRequestException('Select an appointed co-host');
    if (targetId === hostId) throw new ConflictException('You are already the primary host');
    const target = await this.prisma.liveRoomCoHost.findUnique({
      where: { roomId_userId: { roomId, userId: targetId } }, select: { userId: true },
    });
    if (!target) throw new ConflictException('You can transfer ownership only to an appointed co-host');
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimedCoHost = await tx.liveRoomCoHost.deleteMany({ where: { roomId, userId: targetId } });
      if (claimedCoHost.count !== 1) throw new ConflictException('The selected co-host is no longer assigned to this room');
      const claimed = await tx.liveRoom.updateMany({ where: { id: roomId, hostId }, data: { hostId: targetId } });
      if (claimed.count !== 1) throw new ConflictException('Room ownership changed; refresh and try again');
      await tx.liveRoomHostTransfer.create({ data: { roomId, previousHostId: hostId, newHostId: targetId } });
      await tx.liveRoomCoHost.upsert({
        where: { roomId_userId: { roomId, userId: hostId } },
        create: { roomId, userId: hostId, assignedById: targetId },
        update: { assignedById: targetId, assignedAt: new Date() },
      });
      await tx.liveRoomModerator.deleteMany({ where: { roomId, userId: { in: [hostId, targetId] } } });
      return tx.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, title: true, status: true } });
    });
    return { ...updated, previousHostId: hostId, newHostId: targetId, transferred: true };
  }

  async getChatMessages(userId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, visibility: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.visibility !== LiveRoomVisibility.PUBLIC && !(await this.canManageLiveSession(roomId, userId, room.hostId))) throw new ForbiddenException('This room chat is not publicly accessible');
    const blocks = await this.prisma.userBlock.findMany({
      where: { OR: [{ blockerId: userId }, { blockedUserId: userId }] }, select: { blockerId: true, blockedUserId: true },
    });
    const hiddenUsers = [...new Set(blocks.map(block => block.blockerId === userId ? block.blockedUserId : block.blockerId))];
    const messages = await this.prisma.liveChatMessage.findMany({
      where: { roomId, ...(hiddenUsers.length ? { userId: { notIn: hiddenUsers } } : {}) }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, content: true, deletedAt: true, createdAt: true, userId: true, author: { select: { displayName: true } } },
    });
    return { messages: messages.reverse().map(message => ({ ...message, content: message.deletedAt ? '[deleted]' : message.content })) };
  }

  async postChatMessage(userId: string, roomId: string, content: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true, visibility: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Chat is available only while the room is live');
    if (room.visibility !== LiveRoomVisibility.PUBLIC && !(await this.canManageLiveSession(roomId, userId, room.hostId))) throw new ForbiddenException('This room chat is not publicly accessible');
    const blockedHost = await this.prisma.userBlock.findFirst({ where: { OR: [
      { blockerId: userId, blockedUserId: room.hostId },
      { blockerId: room.hostId, blockedUserId: userId },
    ] }, select: { id: true } });
    if (blockedHost) throw new ForbiddenException('You cannot chat in a room hosted by an account you have blocked or that has blocked you');
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
    if (message.userId !== userId && !(await this.canModerateRoom(roomId, userId, message.room.hostId))) throw new ForbiddenException('You can only remove your own message or moderate your room');
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

    // Ask Egress to finalize its file before deleting the room and disconnecting participants.
    // A STOPPING state prevents concurrent end requests from issuing duplicate stop commands.
    if (room.recordingStatus === 'RECORDING' && room.recordingEgressId) {
      const claimed = await this.prisma.liveRoom.updateMany({
        where: { id: roomId, recordingStatus: 'RECORDING', recordingEgressId: room.recordingEgressId },
        data: { recordingStatus: 'STOPPING' },
      });
      if (claimed.count === 1) {
        try {
          await this.egressClient().stopEgress(room.recordingEgressId);
        } catch {
          // Restore only if the completion webhook has not already moved the recording forward.
          await this.prisma.liveRoom.updateMany({
            where: { id: roomId, recordingStatus: 'STOPPING', recordingEgressId: room.recordingEgressId },
            data: { recordingStatus: 'RECORDING' },
          });
          throw new ServiceUnavailableException('Unable to finalize the live recording; the room was not ended. Check LiveKit Egress and try again');
        }
      }
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
      await tx.liveSpeakerTurn.updateMany({ where: { roomId, status: 'ACTIVE' }, data: { status: 'COMPLETED', endedAt: leftAt } });
      await tx.liveAgendaItem.updateMany({ where: { roomId, status: 'ACTIVE' }, data: { status: 'COMPLETED', completedAt: leftAt } });
      await tx.liveGuestInvitation.updateMany({ where: { roomId, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'CANCELLED', respondedAt: leftAt } });
      return ended;
    });
  }

  async createRoom(userId: string, input: CreateLiveRoomDto) {
    if (input.scheduledAt) {
      const scheduledAt = new Date(input.scheduledAt);
      if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() + 60_000) {
        throw new BadRequestException('Choose a live room start time at least one minute in the future');
      }
    }
    const room = await this.prisma.liveRoom.create({
      data: {
        hostId: userId,
        title: input.title.trim(),
        description: input.description?.trim(),
        isAudioOnly: input.isAudioOnly ?? false,
        visibility: (input.visibility ?? 'PUBLIC') as LiveRoomVisibility,
        status: input.scheduledAt ? LiveRoomStatus.SCHEDULED : LiveRoomStatus.DRAFT,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      },
      select: { id: true, title: true, description: true, visibility: true, isAudioOnly: true, status: true, scheduledAt: true, createdAt: true },
    });
    return room;
  }

  async cancelScheduledRoom(hostId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({
      where: { id: roomId },
      select: { id: true, hostId: true, status: true },
    });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the room host can cancel this room');
    if (room.status !== LiveRoomStatus.SCHEDULED) {
      throw new ConflictException('Only scheduled rooms can be cancelled');
    }
    const result = await this.prisma.liveRoom.updateMany({
      where: { id: roomId, hostId, status: LiveRoomStatus.SCHEDULED },
      data: { status: LiveRoomStatus.CANCELLED, endedAt: new Date() },
    });
    if (result.count !== 1) throw new ConflictException('This scheduled room has already changed; refresh and try again');
    await this.prisma.liveGuestInvitation.updateMany({ where: { roomId, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'CANCELLED', respondedAt: new Date() } });
    return { id: roomId, status: LiveRoomStatus.CANCELLED };
  }

  async listMyLiveRooms(hostId: string) {
    return this.prisma.liveRoom.findMany({
      where: { OR: [{ hostId }, { coHosts: { some: { userId: hostId } } }] },
      orderBy: [{ startedAt: 'desc' }, { scheduledAt: 'asc' }],
      take: 30,
      select: {
        id: true, title: true, description: true, isAudioOnly: true, status: true, startedAt: true, scheduledAt: true,
        _count: { select: { stage: true, requests: true } },
      },
    });
  }

  async listLiveRooms() {
    return this.prisma.liveRoom.findMany({
      where: { status: { in: [LiveRoomStatus.LIVE, LiveRoomStatus.SCHEDULED] }, visibility: LiveRoomVisibility.PUBLIC },
      orderBy: [{ status: 'asc' }, { startedAt: 'desc' }, { scheduledAt: 'asc' }],
      take: 50,
      select: {
        id: true, title: true, description: true, isAudioOnly: true, status: true, startedAt: true, scheduledAt: true,
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
        recordingEgressId: null, recordingObjectKey: null, recordingTranscript: Prisma.DbNull, recordingStartedAt: null, recordingEndedAt: null,
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


  async ingestLiveTranscript(roomId: string, suppliedSecret: string | undefined, input: { segments?: Array<{ id: string; text: string; speaker: string; startSeconds: number; endSeconds: number }>; language?: string }) {
    const expectedSecret = this.config.get<string>('LIVEKIT_CAPTIONS_INGEST_SECRET');
    if (!expectedSecret) throw new ServiceUnavailableException('Live transcript ingestion is not configured');
    const supplied = Buffer.from(suppliedSecret || '');
    const expected = Buffer.from(expectedSecret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new UnauthorizedException('Live transcript ingestion authentication failed');
    }
    if (!Array.isArray(input?.segments) || input.segments.length < 1 || input.segments.length > 100) {
      throw new BadRequestException('Submit between 1 and 100 transcript segments');
    }
    const normalized = input.segments.map((segment) => ({
      id: String(segment?.id || '').slice(0, 128),
      text: String(segment?.text || '').trim().slice(0, 5000),
      speaker: String(segment?.speaker || 'Speaker').trim().slice(0, 120) || 'Speaker',
      startSeconds: Number(segment?.startSeconds),
      endSeconds: Number(segment?.endSeconds),
    }));
    if (normalized.some((segment) => !segment.id || !segment.text || !Number.isFinite(segment.startSeconds) ||
      !Number.isFinite(segment.endSeconds) || segment.startSeconds < 0 || segment.endSeconds < segment.startSeconds)) {
      throw new BadRequestException('Transcript segments contain invalid IDs, text, speakers, or timestamps');
    }
    const speakerUsers = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(normalized.map((segment) => segment.speaker))] } },
      select: { id: true, displayName: true },
    });
    const speakerNames = new Map(speakerUsers.map((user) => [user.id, user.displayName]));
    const attributed = normalized.map((segment) => ({
      ...segment,
      speakerId: segment.speaker,
      speaker: speakerNames.get(segment.speaker) || segment.speaker,
    }));
    const room = await this.prisma.liveRoom.findUnique({
      where: { id: roomId },
      select: { id: true, recordingStatus: true, recordingTranscript: true, recordingObjectKey: true },
    });
    if (!room) throw new NotFoundException('Live room not found');
    if (!['RECORDING', 'STOPPING', 'COMPLETED'].includes(room.recordingStatus)) {
      throw new ConflictException('Transcript capture is available only for an active or completed recording');
    }
    const current = room.recordingTranscript && typeof room.recordingTranscript === 'object'
      ? room.recordingTranscript as { language?: string; segments?: typeof attributed }
      : { language: 'en', segments: [] as typeof attributed };
    const byId = new Map((Array.isArray(current.segments) ? current.segments : []).map((segment) => [segment.id, segment]));
    for (const segment of attributed) byId.set(segment.id, segment);
    const segments = [...byId.values()].sort((a, b) => a.startSeconds - b.startSeconds).slice(-10000);
    const language = (input.language || current.language || 'en').slice(0, 12);
    await this.prisma.liveRoom.update({ where: { id: roomId }, data: { recordingTranscript: { language, segments } } });
    let replayTranscriptUpdated = false;
    if (room.recordingObjectKey) {
      const bucket = this.config.get<string>('S3_BUCKET', '');
      let objectKey = room.recordingObjectKey;
      if (objectKey.startsWith('s3://')) {
        const location = objectKey.slice(5);
        const slash = location.indexOf('/');
        if (slash > 0 && location.slice(0, slash) === bucket) objectKey = location.slice(slash + 1);
      }
      const asset = await this.prisma.mediaAsset.findUnique({ where: { objectKey }, select: { id: true, episodeId: true, episode: { select: { isLiveReplay: true } } } });
      if (asset?.episode.isLiveReplay) {
        const content = segments.map((segment) => {
          const minutes = Math.floor(segment.startSeconds / 60);
          const seconds = Math.floor(segment.startSeconds % 60).toString().padStart(2, '0');
          return `[${minutes}:${seconds}] ${segment.speaker}: ${segment.text}`;
        }).join('\n');
        await this.prisma.episodeTranscript.upsert({
          where: { episodeId: asset.episodeId },
          create: { episodeId: asset.episodeId, content, language, segments },
          update: { content, language, segments },
        });
        replayTranscriptUpdated = true;
      }
    }
    return { roomId, segmentCount: segments.length, replayTranscriptUpdated };
  }

  async createRecordingEpisodeDraft(hostId: string, roomId: string) {
    if (this.config.get<string>('LIVEKIT_RECORDING_ENABLED') !== 'true') {
      throw new ServiceUnavailableException('Live room recording is disabled by configuration');
    }
    const room = await this.prisma.liveRoom.findUnique({
      where: { id: roomId },
      select: { id: true, hostId: true, title: true, isAudioOnly: true, recordingStatus: true, recordingObjectKey: true, recordingTranscript: true },
    });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the room host can create a replay');
    if (room.recordingStatus !== 'COMPLETED' || !room.recordingObjectKey) {
      throw new ConflictException('A successfully completed recording is required before creating a replay');
    }

    const bucket = this.config.get<string>('S3_BUCKET', '');
    const recordingBucket = this.config.get<string>('LIVEKIT_RECORDING_S3_BUCKET') || bucket;
    if (!bucket || recordingBucket !== bucket) {
      throw new ServiceUnavailableException('Replay import requires LiveKit recordings and VOXA media processing to use the same S3 bucket');
    }
    const rawKey = room.recordingObjectKey;
    let objectKey = rawKey;
    if (rawKey.startsWith('s3://')) {
      const location = rawKey.slice(5);
      const slash = location.indexOf('/');
      if (slash < 1 || location.slice(0, slash) !== bucket) {
        throw new ConflictException('Recording storage location does not match the configured media bucket');
      }
      objectKey = location.slice(slash + 1);
    }
    if (!objectKey || objectKey.startsWith('/') || objectKey.includes('..')) {
      throw new ConflictException('Recording storage returned an invalid object key');
    }

    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const storage = new S3Client({
      region: this.config.get<string>('S3_REGION', 'auto'),
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: this.config.get<string>('S3_FORCE_PATH_STYLE', 'false') === 'true',
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
    let sizeBytes: number;
    try {
      const head = await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
      if (!head.ContentLength || head.ContentLength < 1) throw new Error('empty recording');
      sizeBytes = head.ContentLength;
    } catch {
      throw new ServiceUnavailableException('Completed recording is not yet accessible in configured media storage');
    } finally {
      storage.destroy();
    }

    const existing = await this.prisma.mediaAsset.findUnique({
      where: { objectKey },
      select: { id: true, episodeId: true, status: true },
    });
    if (existing) return { roomId, episodeId: existing.episodeId, mediaAssetId: existing.id, processingStatus: existing.status, alreadyCreated: true };

    const creator = await this.prisma.creator.findUnique({ where: { userId: hostId }, select: { id: true } });
    if (!creator) throw new ConflictException('Create a creator profile before publishing a live replay');
    const showTitle = 'VOXA LIVE Replays';
    let show = await this.prisma.show.findFirst({ where: { creatorId: creator.id, title: showTitle }, select: { id: true } });
    if (!show) {
      show = await this.prisma.show.create({
        data: { creatorId: creator.id, title: showTitle, description: 'Replays from your VOXA LIVE sessions', language: 'en', status: 'PUBLISHED', publishedAt: new Date() },
        select: { id: true },
      });
    }
    const contentType = room.isAudioOnly ? 'audio/mp4' : 'video/mp4';
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const episode = await tx.episode.create({
          data: {
            showId: show!.id,
            title: room.title.trim().slice(0, 180) || 'Live session replay',
            description: 'Replay from a VOXA LIVE session. Review this draft before publishing.',
            mediaKey: objectKey,
            isLiveReplay: true,
          },
          select: { id: true },
        });
        const asset = await tx.mediaAsset.create({
          data: { episodeId: episode.id, objectKey, contentType, sizeBytes: BigInt(sizeBytes), status: 'QUEUED' },
          select: { id: true, status: true },
        });
        const captured = room.recordingTranscript && typeof room.recordingTranscript === 'object'
          ? room.recordingTranscript as { language?: string; segments?: Array<{ id: string; text: string; speaker: string; startSeconds: number; endSeconds: number }> }
          : null;
        const segments = Array.isArray(captured?.segments) ? captured!.segments! : [];
        if (segments.length) {
          const content = segments.map((segment) => {
            const minutes = Math.floor(segment.startSeconds / 60);
            const seconds = Math.floor(segment.startSeconds % 60).toString().padStart(2, '0');
            return `[${minutes}:${seconds}] ${segment.speaker}: ${segment.text}`;
          }).join('\n');
          await tx.episodeTranscript.create({
            data: { episodeId: episode.id, content, language: captured?.language || 'en', segments },
          });
        }
        return { episodeId: episode.id, mediaAssetId: asset.id, processingStatus: asset.status, transcriptSegments: segments.length };
      });
      return { roomId, ...created, alreadyCreated: false };
    } catch (error) {
      const duplicate = await this.prisma.mediaAsset.findUnique({ where: { objectKey }, select: { id: true, episodeId: true, status: true } });
      if (duplicate) return { roomId, episodeId: duplicate.episodeId, mediaAssetId: duplicate.id, processingStatus: duplicate.status, alreadyCreated: true };
      throw error;
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
    const claimed = await this.prisma.liveRoom.updateMany({
      where: { id: roomId, recordingStatus: 'RECORDING', recordingEgressId: room.recordingEgressId },
      data: { recordingStatus: 'STOPPING' },
    });
    if (claimed.count !== 1) throw new ConflictException('Recording state changed; refresh and try again');
    try {
      await this.egressClient().stopEgress(room.recordingEgressId);
      return { roomId, recordingStatus: 'STOPPING' };
    } catch {
      // Do not leave the host stuck in STOPPING when LiveKit rejected the request.
      await this.prisma.liveRoom.updateMany({
        where: { id: roomId, recordingStatus: 'STOPPING', recordingEgressId: room.recordingEgressId },
        data: { recordingStatus: 'RECORDING' },
      });
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
        const fileLocation = event.egressInfo.fileResults?.[0]?.location?.trim() || null;
        // Egress status 3 is COMPLETE. ABORTED, FAILED, LIMIT_REACHED and unknown
        // terminal states must never be exposed as a playable replay.
        const completed = event.egressInfo.status === LIVEKIT_EGRESS_STATUS_COMPLETE && Boolean(fileLocation);
        const failure = event.egressInfo.status === LIVEKIT_EGRESS_STATUS_COMPLETE
          ? 'LiveKit completed the recording without returning a media file'
          : event.egressInfo.status === 4
            ? 'LiveKit Egress reported a recording failure'
            : 'LiveKit Egress did not complete the recording successfully';
        await tx.liveRoom.updateMany({
          where: { recordingEgressId: event.egressInfo.egressId },
          data: {
            recordingStatus: completed ? 'COMPLETED' : 'FAILED',
            recordingEndedAt: new Date(),
            recordingObjectKey: completed ? fileLocation : null,
            recordingFailure: completed ? null : failure,
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
        await tx.liveSpeakerTurn.updateMany({ where: { roomId, status: 'ACTIVE' }, data: { status: 'COMPLETED', endedAt } });
        await tx.liveAgendaItem.updateMany({ where: { roomId, status: 'ACTIVE' }, data: { status: 'COMPLETED', completedAt: endedAt } });
      } else if (roomId && participantIdentity &&
        (event.event === 'participant_left' || event.event === 'participant_connection_aborted')) {
        const leftAt = new Date();
        await tx.liveViewerSession.updateMany({
          where: { roomId, userId: participantIdentity, leftAt: null }, data: { leftAt },
        });
        await tx.liveStageMember.updateMany({
          where: { roomId, userId: participantIdentity, leftAt: null }, data: { leftAt },
        });
        await tx.liveSpeakerTurn.updateMany({
          where: { roomId, speakerId: participantIdentity, status: 'ACTIVE' }, data: { status: 'COMPLETED', endedAt: leftAt },
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
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, title: true, status: true, startedAt: true, endedAt: true, peakAudienceCount: true, recordingStatus: true, recordingObjectKey: true, recordingStartedAt: true, recordingEndedAt: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== hostId) throw new ForbiddenException('Only the room host can view room analytics');
    // Resolve a replay draft from the durable recording object key so the host
    // can recover its Creator Studio link after refreshing or reconnecting.
    let replayObjectKey = room.recordingObjectKey;
    if (replayObjectKey?.startsWith('s3://')) {
      const location = replayObjectKey.slice(5);
      const slash = location.indexOf('/');
      const bucket = this.config.get<string>('S3_BUCKET', '');
      replayObjectKey = slash > 0 && location.slice(0, slash) === bucket ? location.slice(slash + 1) : null;
    }
    const replayAsset = replayObjectKey
      ? await this.prisma.mediaAsset.findUnique({
          where: { objectKey: replayObjectKey },
          select: { id: true, episodeId: true, status: true, episode: { select: { status: true, isLiveReplay: true } } },
        })
      : null;
    const replayDraft = replayAsset?.episode?.isLiveReplay
      ? {
          episodeId: replayAsset.episodeId,
          mediaAssetId: replayAsset.id,
          processingStatus: replayAsset.status,
          episodeStatus: replayAsset.episode.status,
        }
      : null;
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
      replayDraft,
      stage: { totalSpeakerSessions: speakers.length, activeSpeakers: speakers.filter(speaker => speaker.currentlyOnStage).length, speakers },
      requests: { pending: requests.pending ?? 0, approved: requests.approved ?? 0, rejected: requests.rejected ?? 0 },
      audience: { concurrentViewers, peakConcurrentViewers: room.peakAudienceCount },
      chat: { totalMessages: chatMessageCount, removedMessages: deletedMessageCount, visibleMessages: chatMessageCount - deletedMessageCount },
      measurementNote: 'Concurrent and peak audience counts use authenticated viewer heartbeats. A viewer is present for 45 seconds after their latest heartbeat; brief network interruptions may affect the estimate.',
    };
  }


  async getAudienceInteractions(userId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, visibility: true } });
    if (!room) throw new NotFoundException('Live room not found');
    const isModerator = room.hostId === userId || await this.canModerateRoom(roomId, userId, room.hostId);
    if (room.visibility !== LiveRoomVisibility.PUBLIC && !(await this.canManageLiveSession(roomId, userId, room.hostId))) throw new ForbiddenException('This room is not publicly accessible');
    const [polls, questions] = await Promise.all([
      this.prisma.livePoll.findMany({
        where: { roomId }, orderBy: { createdAt: 'desc' }, take: 10,
        select: {
          id: true, question: true, status: true, createdAt: true, closedAt: true, createdBy: true,
          options: { select: { id: true, text: true, _count: { select: { votes: true } } } },
          votes: { where: { userId }, select: { optionId: true } },
        },
      }),
      this.prisma.liveQuestion.findMany({
        where: { roomId, ...(isModerator ? {} : { OR: [{ status: { in: ['APPROVED', 'ANSWERED'] } }, { userId }] }) },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], take: 100,
        select: { id: true, question: true, status: true, isPinned: true, answer: true, createdAt: true, userId: true, author: { select: { displayName: true } } },
      }),
    ]);
    return {
      isModerator,
      polls: polls.map(poll => ({ ...poll, myVote: poll.votes[0]?.optionId ?? null, votes: undefined, options: poll.options.map(option => ({ id: option.id, text: option.text, voteCount: option._count.votes })) })),
      questions,
    };
  }

  async createLivePoll(userId: string, roomId: string, question: string, options: string[]) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Polls can be created only while the room is live');
    if (!(await this.canModerateRoom(roomId, userId, room.hostId))) throw new ForbiddenException('Only the host or an assigned moderator can create polls');
    const cleanOptions = [...new Set((options || []).map(option => option.trim()).filter(Boolean))];
    const cleanQuestion = question?.trim();
    if (!cleanQuestion || cleanQuestion.length < 5 || cleanQuestion.length > 240) throw new BadRequestException('Poll question must be between 5 and 240 characters');
    if (cleanOptions.length < 2 || cleanOptions.length > 6 || cleanOptions.some(option => option.length > 80)) throw new BadRequestException('Add 2 to 6 unique poll options, each no longer than 80 characters');
    const activePoll = await this.prisma.livePoll.findFirst({
      where: { roomId, status: 'OPEN' },
      select: { id: true },
    });
    if (activePoll) throw new ConflictException('Close the current live poll before creating another one');
    try {
      return await this.prisma.livePoll.create({
        data: { roomId, createdBy: userId, question: cleanQuestion, options: { create: cleanOptions.map(text => ({ text })) } },
        select: { id: true, question: true, status: true, createdAt: true, options: { select: { id: true, text: true } } },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('Close the current live poll before creating another one');
      }
      throw error;
    }
  }

  async voteLivePoll(userId: string, roomId: string, pollId: string, optionId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true, visibility: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.visibility !== LiveRoomVisibility.PUBLIC && room.hostId !== userId) throw new ForbiddenException('This room is not publicly accessible');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Voting is available only while the room is live');
    const poll = await this.prisma.livePoll.findFirst({ where: { id: pollId, roomId }, select: { id: true, status: true } });
    if (!poll) throw new NotFoundException('Live poll not found');
    if (poll.status !== 'OPEN') throw new ConflictException('This poll is closed');
    const option = await this.prisma.livePollOption.findFirst({ where: { id: optionId, pollId }, select: { id: true } });
    if (!option) throw new BadRequestException('Choose an option from this poll');
    const existingVote = await this.prisma.livePollVote.findUnique({
      where: { pollId_userId: { pollId, userId } },
      select: { id: true },
    });
    if (existingVote) throw new ConflictException('You have already voted in this poll');
    try {
      await this.prisma.livePollVote.create({ data: { pollId, optionId, userId } });
    } catch (error) {
      // The unique index is the final guard against two simultaneous vote requests.
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('You have already voted in this poll');
      }
      throw error;
    }
    return { pollId, optionId, recorded: true };
  }

  async closeLivePoll(userId: string, roomId: string, pollId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (!(await this.canModerateRoom(roomId, userId, room.hostId))) throw new ForbiddenException('Only the host or an assigned moderator can close polls');
    const result = await this.prisma.livePoll.updateMany({ where: { id: pollId, roomId, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
    if (!result.count) throw new NotFoundException('Open live poll not found');
    return { pollId, status: 'CLOSED' };
  }

  async submitLiveQuestion(userId: string, roomId: string, question: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true, visibility: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Questions can be submitted only while the room is live');
    if (room.visibility !== LiveRoomVisibility.PUBLIC && room.hostId !== userId) throw new ForbiddenException('This room is not publicly accessible');
    if (room.hostId !== userId) {
      const blocked = await this.prisma.userBlock.findFirst({ where: { OR: [
        { blockerId: userId, blockedUserId: room.hostId }, { blockerId: room.hostId, blockedUserId: userId },
      ] }, select: { id: true } });
      if (blocked) throw new ForbiddenException('You cannot submit questions in this room');
    }
    const clean = question?.trim();
    if (!clean || clean.length < 5 || clean.length > 500) throw new BadRequestException('Question must be between 5 and 500 characters');
    return this.prisma.liveQuestion.create({
      data: { roomId, userId, question: clean },
      select: { id: true, question: true, status: true, createdAt: true },
    });
  }

  async moderateLiveQuestion(userId: string, roomId: string, questionId: string, input: { status?: string; pinned?: boolean; answer?: string }) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (!(await this.canModerateRoom(roomId, userId, room.hostId))) throw new ForbiddenException('Only the host or an assigned moderator can manage audience questions');
    const current = await this.prisma.liveQuestion.findFirst({ where: { id: questionId, roomId }, select: { id: true, status: true } });
    if (!current) throw new NotFoundException('Audience question not found');
    const answer = input.answer?.trim();
    if (input.answer !== undefined && (!answer || answer.length > 1000)) throw new BadRequestException('Answer must be between 1 and 1000 characters');
    const status = answer ? 'ANSWERED' : input.status ?? current.status;
    if (input.status && !['APPROVED', 'REJECTED', 'CLOSED'].includes(input.status)) throw new BadRequestException('Invalid question moderation status');
    if (status === 'REJECTED' && input.pinned) throw new BadRequestException('Rejected questions cannot be pinned');
    if (input.pinned === true && !['APPROVED', 'ANSWERED'].includes(status)) throw new ConflictException('Approve a question before pinning it');
    return this.prisma.liveQuestion.update({
      where: { id: questionId },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.pinned !== undefined ? { isPinned: input.pinned } : {}),
        ...(answer ? { answer, status: 'ANSWERED', answeredBy: userId } : {}),
        ...(status === 'REJECTED' || status === 'CLOSED' ? { isPinned: false } : {}),
      },
      select: { id: true, question: true, status: true, isPinned: true, answer: true, answeredBy: true },
    });
  }



  private async applySpeakerPublishPermissions(roomId: string, stageSpeakerIds: string[], activeSpeakerId: string | null, fallbackSpeakerId: string | null = null) {
    const client = this.roomServiceClient();
    const participants = await client.listParticipants(roomId);
    const connectedIds = stageSpeakerIds.filter(id => participants.some(participant => participant.identity === id));
    if (activeSpeakerId && !connectedIds.includes(activeSpeakerId)) throw new ConflictException('The selected speaker is no longer connected to VOXA LIVE');
    try {
      for (const speakerId of connectedIds) {
        await client.updateParticipant(roomId, speakerId, undefined, {
          canPublish: speakerId === activeSpeakerId,
          canSubscribe: true,
          canPublishData: true,
        });
      }
    } catch {
      for (const speakerId of connectedIds) {
        await client.updateParticipant(roomId, speakerId, undefined, { canPublish: speakerId === fallbackSpeakerId, canSubscribe: true, canPublishData: true }).catch(() => undefined);
      }
      throw new ServiceUnavailableException('LiveKit could not apply the speaker handoff permissions');
    }
  }

  async getSessionPlan(userId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true, visibility: true } });
    if (!room) throw new NotFoundException('Live room not found');
    const isHost = room.hostId === userId;
    const isCoHost = !isHost && await this.isRoomCoHost(roomId, userId);
    const isModerator = !isHost && !isCoHost && await this.canModerateRoom(roomId, userId, room.hostId);
    if (room.visibility !== LiveRoomVisibility.PUBLIC && !(await this.canManageLiveSession(roomId, userId, room.hostId))) throw new ForbiddenException('This room agenda is not publicly accessible');
    const [agenda, activeTurn, speakers] = await Promise.all([
      this.prisma.liveAgendaItem.findMany({ where: { roomId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true, title: true, description: true, durationSeconds: true, position: true, status: true, startedAt: true, completedAt: true } }),
      this.prisma.liveSpeakerTurn.findFirst({ where: { roomId, status: 'ACTIVE' }, orderBy: { startedAt: 'desc' }, select: { id: true, speakerId: true, agendaItemId: true, startedAt: true, speaker: { select: { displayName: true } } } }),
      this.prisma.liveStageMember.findMany({ where: { roomId, leftAt: null }, orderBy: { joinedAt: 'asc' }, select: { userId: true, role: true } }),
    ]);
    return { isHost, isCoHost, isModerator, roomStatus: room.status, agenda, activeTurn, speakers };
  }

  async createAgendaItem(userId: string, roomId: string, input: { title: string; description?: string; durationSeconds: number }) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (!(await this.canModerateRoom(roomId, userId, room.hostId))) throw new ForbiddenException('Only the host or an assigned moderator can manage the session agenda');
    const title = input.title?.trim();
    if (!title || title.length < 2 || title.length > 120) throw new BadRequestException('Agenda title must be between 2 and 120 characters');
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > 14400) throw new BadRequestException('Agenda duration must be between 1 second and 4 hours');
    const last = await this.prisma.liveAgendaItem.findFirst({ where: { roomId }, orderBy: { position: 'desc' }, select: { position: true } });
    return this.prisma.liveAgendaItem.create({
      data: { roomId, title, description: input.description?.trim() || null, durationSeconds: input.durationSeconds, position: (last?.position ?? -1) + 1 },
      select: { id: true, title: true, description: true, durationSeconds: true, position: true, status: true, startedAt: true, completedAt: true },
    });
  }

  async updateAgendaItem(userId: string, roomId: string, itemId: string, input: { title?: string; description?: string; durationSeconds?: number }) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (!(await this.canModerateRoom(roomId, userId, room.hostId))) throw new ForbiddenException('Only the host or an assigned moderator can manage the session agenda');
    const item = await this.prisma.liveAgendaItem.findFirst({ where: { id: itemId, roomId }, select: { id: true, status: true } });
    if (!item) throw new NotFoundException('Agenda item not found');
    if (item.status !== 'PENDING') throw new ConflictException('Only pending agenda items can be edited');
    if (input.title !== undefined && (input.title.trim().length < 2 || input.title.trim().length > 120)) throw new BadRequestException('Agenda title must be between 2 and 120 characters');
    if (input.durationSeconds !== undefined && (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > 14400)) throw new BadRequestException('Agenda duration must be between 1 second and 4 hours');
    return this.prisma.liveAgendaItem.update({
      where: { id: itemId },
      data: { ...(input.title !== undefined ? { title: input.title.trim() } : {}), ...(input.description !== undefined ? { description: input.description.trim() || null } : {}), ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}) },
      select: { id: true, title: true, description: true, durationSeconds: true, position: true, status: true },
    });
  }

  async deleteAgendaItem(userId: string, roomId: string, itemId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (!(await this.canModerateRoom(roomId, userId, room.hostId))) throw new ForbiddenException('Only the host or an assigned moderator can manage the session agenda');
    const item = await this.prisma.liveAgendaItem.findFirst({ where: { id: itemId, roomId }, select: { id: true, status: true } });
    if (!item) throw new NotFoundException('Agenda item not found');
    if (item.status !== 'PENDING') throw new ConflictException('Only pending agenda items can be deleted');
    await this.prisma.liveAgendaItem.delete({ where: { id: itemId } });
    return { deleted: true, itemId };
  }

  async startAgendaItem(userId: string, roomId: string, itemId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (!(await this.canModerateRoom(roomId, userId, room.hostId))) throw new ForbiddenException('Only the host or an assigned moderator can control the session agenda');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('The session agenda can only be started while the room is live');
    const item = await this.prisma.liveAgendaItem.findFirst({ where: { id: itemId, roomId }, select: { id: true, status: true } });
    if (!item) throw new NotFoundException('Agenda item not found');
    if (item.status !== 'PENDING') throw new ConflictException('Only pending agenda items can be started');
    return this.prisma.$transaction(async (tx) => {
      await tx.liveAgendaItem.updateMany({ where: { roomId, status: 'ACTIVE' }, data: { status: 'COMPLETED', completedAt: new Date() } });
      return tx.liveAgendaItem.update({ where: { id: itemId }, data: { status: 'ACTIVE', startedAt: new Date(), completedAt: null }, select: { id: true, title: true, durationSeconds: true, position: true, status: true, startedAt: true } });
    });
  }

  async completeAgendaItem(userId: string, roomId: string, itemId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (!(await this.canModerateRoom(roomId, userId, room.hostId))) throw new ForbiddenException('Only the host or an assigned moderator can control the session agenda');
    const result = await this.prisma.liveAgendaItem.updateMany({ where: { id: itemId, roomId, status: 'ACTIVE' }, data: { status: 'COMPLETED', completedAt: new Date() } });
    if (!result.count) throw new NotFoundException('Active agenda item not found');
    return { itemId, status: 'COMPLETED' };
  }

  async handoffSpeaker(hostId: string, roomId: string, speakerId: string, agendaItemId?: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (!(await this.canManageLiveSession(roomId, hostId, room.hostId))) throw new ForbiddenException('Only the host or an appointed co-host can hand off the speaking turn');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Speaker handoff is available only while the room is live');
    const speaker = await this.prisma.liveStageMember.findUnique({ where: { roomId_userId: { roomId, userId: speakerId } }, select: { userId: true, role: true, leftAt: true } });
    if (!speaker || speaker.leftAt) throw new ConflictException('The selected participant must already be an active stage speaker');
    if (speaker.role === 'GUEST') {
      const booking = await this.prisma.liveGuestInvitation.findFirst({ where: { roomId, inviteeId: speakerId, status: 'ACCEPTED', slotStartsAt: { lte: new Date() }, slotEndsAt: { gt: new Date() } }, select: { id: true } });
      if (!booking) throw new ConflictException('The guest can only receive the speaking turn during their accepted booking slot');
    }
    if (agendaItemId) {
      const agendaItem = await this.prisma.liveAgendaItem.findFirst({ where: { id: agendaItemId, roomId, status: 'ACTIVE' }, select: { id: true } });
      if (!agendaItem) throw new ConflictException('Select the active agenda segment for this speaker turn');
    }
    const active = await this.prisma.liveSpeakerTurn.findFirst({ where: { roomId, status: 'ACTIVE' }, select: { speakerId: true } });
    if (active?.speakerId === speakerId) throw new ConflictException('This speaker already has the active turn');
    const stageMembers = await this.prisma.liveStageMember.findMany({ where: { roomId, leftAt: null }, select: { userId: true } });
    await this.applySpeakerPublishPermissions(roomId, stageMembers.map(member => member.userId).filter(id => id !== room.hostId), speakerId, active?.speakerId ?? null);
    try {
      return await this.prisma.$transaction(async (tx) => {
      await tx.liveSpeakerTurn.updateMany({ where: { roomId, status: 'ACTIVE' }, data: { status: 'COMPLETED', endedAt: new Date() } });
      return tx.liveSpeakerTurn.create({
        data: { roomId, speakerId, agendaItemId: agendaItemId || null },
        select: { id: true, roomId: true, speakerId: true, agendaItemId: true, status: true, startedAt: true, speaker: { select: { displayName: true } } },
      });
      });
    } catch (error) {
      await this.applySpeakerPublishPermissions(roomId, stageMembers.map(member => member.userId).filter(id => id !== room.hostId), active?.speakerId ?? null).catch(() => undefined);
      throw error;
    }
  }

  async endSpeakerTurn(hostId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (!(await this.canManageLiveSession(roomId, hostId, room.hostId))) throw new ForbiddenException('Only the host or an appointed co-host can end the active speaker turn');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('The room is not live');
    const active = await this.prisma.liveSpeakerTurn.findFirst({ where: { roomId, status: 'ACTIVE' }, select: { speakerId: true } });
    if (!active) throw new NotFoundException('There is no active speaker turn');
    const stageMembers = await this.prisma.liveStageMember.findMany({ where: { roomId, leftAt: null }, select: { userId: true } });
    await this.applySpeakerPublishPermissions(roomId, stageMembers.map(member => member.userId).filter(id => id !== room.hostId), null, active.speakerId);
    const result = await this.prisma.liveSpeakerTurn.updateMany({ where: { roomId, status: 'ACTIVE' }, data: { status: 'COMPLETED', endedAt: new Date() } });
    if (!result.count) {
      await this.applySpeakerPublishPermissions(roomId, stageMembers.map(member => member.userId).filter(id => id !== room.hostId), active.speakerId).catch(() => undefined);
      throw new NotFoundException('There is no active speaker turn');
    }
    return { roomId, status: 'COMPLETED' };
  }

  async listGuestInvitations(userId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    const isLeader = room.hostId === userId || await this.isRoomCoHost(roomId, userId);
    return this.prisma.liveGuestInvitation.findMany({
      where: isLeader ? { roomId } : { roomId, inviteeId: userId },
      orderBy: [{ slotStartsAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, roomId: true, inviteeId: true, inviterId: true, status: true,
        slotStartsAt: true, slotEndsAt: true, message: true, respondedAt: true, createdAt: true,
        invitee: { select: { displayName: true } }, inviter: { select: { displayName: true } },
      },
    });
  }

  async inviteLiveGuest(inviterId: string, roomId: string, input: { userId: string; slotStartsAt: string; slotEndsAt: string; message?: string }) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== inviterId && !(await this.isRoomCoHost(roomId, inviterId))) {
      throw new ForbiddenException('Only the primary host or a co-host can invite scheduled guests');
    }
    if (![LiveRoomStatus.DRAFT, LiveRoomStatus.SCHEDULED, LiveRoomStatus.LIVE].includes(room.status)) {
      throw new ConflictException('Guests can only be booked for upcoming or live sessions');
    }
    const inviteeId = input.userId?.trim();
    if (!inviteeId || inviteeId === room.hostId || inviteeId === inviterId) throw new BadRequestException('Choose a different VOXA user as the guest');
    const invitee = await this.prisma.user.findUnique({ where: { id: inviteeId }, select: { id: true, displayName: true } });
    if (!invitee) throw new NotFoundException('VOXA guest account not found');
    if (await this.isRoomCoHost(roomId, inviteeId) || await this.prisma.liveRoomModerator.findUnique({ where: { roomId_userId: { roomId, userId: inviteeId } }, select: { id: true } })) {
      throw new ConflictException('Room leaders and moderators cannot also be booked as guest speakers');
    }
    const startsAt = new Date(input.slotStartsAt);
    const endsAt = new Date(input.slotEndsAt);
    const now = Date.now();
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) ||
        startsAt.getTime() < now + 60_000 || endsAt.getTime() <= startsAt.getTime() ||
        endsAt.getTime() - startsAt.getTime() > 4 * 60 * 60 * 1000) {
      throw new BadRequestException('Choose a future speaking slot lasting no more than four hours');
    }
    const existing = await this.prisma.liveGuestInvitation.findUnique({
      where: { roomId_inviteeId: { roomId, inviteeId } }, select: { id: true, status: true },
    });
    if (existing && existing.status !== 'CANCELLED' && existing.status !== 'DECLINED') {
      throw new ConflictException('This guest already has an active invitation for the room');
    }
    const conflict = await this.prisma.liveGuestInvitation.findFirst({
      where: { inviteeId, status: 'ACCEPTED', slotStartsAt: { lt: endsAt }, slotEndsAt: { gt: startsAt } },
      select: { id: true, roomId: true },
    });
    if (conflict) throw new ConflictException('This guest has already accepted an overlapping speaking slot');
    const invitation = await this.prisma.liveGuestInvitation.upsert({
      where: { roomId_inviteeId: { roomId, inviteeId } },
      create: { roomId, inviteeId, inviterId, slotStartsAt: startsAt, slotEndsAt: endsAt, message: input.message?.trim() || null },
      update: { inviterId, status: 'PENDING', slotStartsAt: startsAt, slotEndsAt: endsAt, message: input.message?.trim() || null, respondedAt: null },
      select: { id: true, roomId: true, inviteeId: true, status: true, slotStartsAt: true, slotEndsAt: true, message: true },
    });
    await createUserNotification(this.prisma, {
      recipientId: inviteeId, actorId: inviterId, type: 'LIVE_GUEST_INVITATION',
      title: 'You are invited to speak on VOXA LIVE',
      body: 'Your speaking slot is ' + startsAt.toISOString() + '. Accept or decline the invitation in the live room.',
      resourceType: 'live_room', resourceId: roomId, category: 'liveInvitations',
    });
    return invitation;
  }

  async respondToGuestInvitation(userId: string, roomId: string, invitationId: string, decision: string) {
    if (!['ACCEPTED', 'DECLINED'].includes(decision)) throw new BadRequestException('Choose accept or decline');
    const invitation = await this.prisma.liveGuestInvitation.findFirst({
      where: { id: invitationId, roomId, inviteeId: userId },
      select: { id: true, status: true, inviterId: true, slotStartsAt: true, slotEndsAt: true },
    });
    if (!invitation) throw new NotFoundException('Guest invitation not found');
    if (invitation.status !== 'PENDING') throw new ConflictException('This guest invitation has already been answered or cancelled');
    if (decision === 'ACCEPTED') {
      if (invitation.slotEndsAt.getTime() <= Date.now()) throw new ConflictException('This speaking slot has already ended');
      const conflict = await this.prisma.liveGuestInvitation.findFirst({
        where: { id: { not: invitationId }, inviteeId: userId, status: 'ACCEPTED', slotStartsAt: { lt: invitation.slotEndsAt }, slotEndsAt: { gt: invitation.slotStartsAt } },
        select: { id: true },
      });
      if (conflict) throw new ConflictException('You already have another accepted speaking slot at this time');
    }
    const updated = await this.prisma.liveGuestInvitation.update({
      where: { id: invitationId },
      data: { status: decision, respondedAt: new Date() },
      select: { id: true, roomId: true, status: true, slotStartsAt: true, slotEndsAt: true, respondedAt: true },
    });
    await createUserNotification(this.prisma, {
      recipientId: invitation.inviterId, actorId: userId, type: 'LIVE_GUEST_INVITATION_RESPONSE',
      title: decision === 'ACCEPTED' ? 'Your VOXA LIVE guest accepted' : 'Your VOXA LIVE guest declined',
      body: 'The invited speaker has ' + decision.toLowerCase() + ' the booked slot.',
      resourceType: 'live_room', resourceId: roomId, category: 'liveInvitations',
    });
    return updated;
  }

  async cancelGuestInvitation(actorId: string, roomId: string, invitationId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== actorId && !(await this.isRoomCoHost(roomId, actorId))) {
      throw new ForbiddenException('Only the primary host or a co-host can cancel guest bookings');
    }
    const result = await this.prisma.liveGuestInvitation.updateMany({
      where: { id: invitationId, roomId, status: { in: ['PENDING', 'ACCEPTED'] } },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Active guest invitation not found');
    const invitation = await this.prisma.liveGuestInvitation.findFirst({ where: { id: invitationId, roomId }, select: { inviteeId: true } });
    if (invitation) await createUserNotification(this.prisma, {
      recipientId: invitation.inviteeId, actorId, type: 'LIVE_GUEST_INVITATION_CANCELLED',
      title: 'Your VOXA LIVE speaking slot was cancelled',
      body: 'The host has cancelled your scheduled guest booking.',
      resourceType: 'live_room', resourceId: roomId, category: 'liveInvitations',
    });
    return { id: invitationId, status: 'CANCELLED' };
  }

  private async expireGuestSpeakerTurn(roomId: string, hostId: string) {
    const active = await this.prisma.liveSpeakerTurn.findFirst({
      where: { roomId, status: 'ACTIVE' }, select: { speakerId: true },
    });
    if (!active) return;
    const member = await this.prisma.liveStageMember.findUnique({
      where: { roomId_userId: { roomId, userId: active.speakerId } }, select: { role: true, leftAt: true },
    });
    if (!member || member.leftAt || member.role !== 'GUEST') return;
    const now = new Date();
    const validBooking = await this.prisma.liveGuestInvitation.findFirst({
      where: { roomId, inviteeId: active.speakerId, status: 'ACCEPTED', slotStartsAt: { lte: now }, slotEndsAt: { gt: now } },
      select: { id: true },
    });
    if (validBooking) return;
    const stageMembers = await this.prisma.liveStageMember.findMany({ where: { roomId, leftAt: null }, select: { userId: true } });
    try {
      await this.applySpeakerPublishPermissions(roomId, stageMembers.map(item => item.userId).filter(id => id !== hostId), null, active.speakerId);
    } catch {
      return;
    }
    await this.prisma.liveSpeakerTurn.updateMany({
      where: { roomId, speakerId: active.speakerId, status: 'ACTIVE' },
      data: { status: 'COMPLETED', endedAt: now },
    });
  }

  async getStageState(userId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true, scheduledAt: true } });
    if (!room) throw new NotFoundException('Live room not found');
    const isHost = room.hostId === userId;
    const isCoHost = !isHost && await this.isRoomCoHost(roomId, userId);
    const isModerator = !isHost && !isCoHost && await this.canModerateRoom(roomId, userId, room.hostId);
    if (room.status === LiveRoomStatus.LIVE) await this.expireGuestSpeakerTurn(roomId, room.hostId);
    const [requests, speakers, ownRequest, moderators, coHosts, hostTransfers, guestInvitations] = await Promise.all([
      isHost || isCoHost || isModerator ? this.prisma.stageRequest.findMany({
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
      this.prisma.liveRoomModerator.findMany({ where: { roomId }, orderBy: { assignedAt: 'asc' }, select: { userId: true, assignedAt: true } }),
      this.prisma.liveRoomCoHost.findMany({ where: { roomId }, orderBy: { assignedAt: 'asc' }, select: { userId: true, assignedAt: true, user: { select: { displayName: true } } } }),
      isHost || isCoHost ? this.prisma.liveRoomHostTransfer.findMany({ where: { roomId }, orderBy: { transferredAt: 'desc' }, take: 10, select: { previousHostId: true, newHostId: true, transferredAt: true, previousHost: { select: { displayName: true } }, newHost: { select: { displayName: true } } } }) : Promise.resolve([]),
      this.prisma.liveGuestInvitation.findMany({
        where: isHost || isCoHost ? { roomId } : { roomId, inviteeId: userId },
        orderBy: { slotStartsAt: 'asc' },
        select: { id: true, inviteeId: true, inviterId: true, status: true, slotStartsAt: true, slotEndsAt: true, message: true, invitee: { select: { displayName: true } }, inviter: { select: { displayName: true } } },
      }),
    ]);
    return { isHost, isCoHost, isModerator, hostId: room.hostId, requests: isHost || isCoHost || isModerator ? requests : [], speakers, moderators, coHosts, hostTransfers, guestInvitations, ownRequest, status: room.status, scheduledAt: room.scheduledAt };
  }

  async joinToken(userId: string, roomId: string) {
    const { url, apiKey, apiSecret } = this.liveKitConfig();
    const room = await this.prisma.liveRoom.findUnique({
      where: { id: roomId },
      include: { stage: { where: { leftAt: null }, select: { userId: true, role: true } } },
    });
    if (!room) throw new NotFoundException('Live room not found');
    const isHost = room.hostId === userId;
    const isCoHost = !isHost && await this.isRoomCoHost(roomId, userId);
    const stageMember = room.stage.find((member) => member.userId === userId);
    let isSpeaker = Boolean(stageMember);
    const guestBooking = !isHost && !isCoHost ? await this.prisma.liveGuestInvitation.findFirst({
      where: { roomId, inviteeId: userId, status: 'ACCEPTED', slotEndsAt: { gt: new Date() } },
      orderBy: { slotStartsAt: 'asc' },
      select: { id: true, slotStartsAt: true, slotEndsAt: true },
    }) : null;
    const bookingIsActive = Boolean(guestBooking && guestBooking.slotStartsAt.getTime() <= Date.now() && guestBooking.slotEndsAt.getTime() > Date.now());
    if (guestBooking && room.visibility !== LiveRoomVisibility.PUBLIC && !bookingIsActive) {
      throw new ConflictException('Your confirmed speaking slot is ' + guestBooking.slotStartsAt.toISOString());
    }
    if (bookingIsActive && room.status === LiveRoomStatus.LIVE && !isSpeaker) {
      await this.prisma.liveStageMember.upsert({
        where: { roomId_userId: { roomId, userId } },
        create: { roomId, userId, role: 'GUEST', leftAt: null },
        update: { role: 'GUEST', leftAt: null, joinedAt: new Date() },
      });
      isSpeaker = true;
    }
    let activeSpeakerTurn = isSpeaker ? await this.prisma.liveSpeakerTurn.findFirst({ where: { roomId, status: 'ACTIVE' }, select: { speakerId: true } }) : null;
    if (bookingIsActive && isSpeaker && !activeSpeakerTurn) {
      await this.prisma.liveSpeakerTurn.create({ data: { roomId, speakerId: userId, status: 'ACTIVE' } });
      activeSpeakerTurn = { speakerId: userId };
    }
    const canPublish = isHost || isCoHost || (isSpeaker && activeSpeakerTurn?.speakerId === userId && (stageMember?.role !== 'GUEST' || bookingIsActive));
    const isModerator = !isHost && !isCoHost && await this.canModerateRoom(roomId, userId, room.hostId);
    if (room.status === LiveRoomStatus.ENDED || room.status === LiveRoomStatus.CANCELLED) {
      throw new ConflictException('This live room has ended');
    }
    if (!isHost && !isCoHost && !bookingIsActive && room.visibility !== LiveRoomVisibility.PUBLIC) {
      throw new ForbiddenException('This room is not publicly accessible; membership and invite entitlements are not enabled yet');
    }
    if (!isHost && room.status !== LiveRoomStatus.LIVE) {
      throw new ConflictException(room.status === LiveRoomStatus.SCHEDULED
        ? 'This room is scheduled. Join when the host starts it.'
        : 'This live room has not started');
    }
    if (isHost && room.status === LiveRoomStatus.SCHEDULED &&
        room.scheduledAt && room.scheduledAt.getTime() > Date.now()) {
      throw new ConflictException('This room is scheduled for ' + room.scheduledAt.toISOString());
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      ttl: '10m',
      metadata: JSON.stringify({ voxaUserId: userId, roomId, role: isHost ? 'HOST' : isCoHost ? 'CO_HOST' : isModerator ? 'MODERATOR' : bookingIsActive ? 'GUEST' : isSpeaker ? 'SPEAKER' : 'AUDIENCE' }),
    });
    token.addGrant({
      roomJoin: true,
      room: room.id,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });

    if (isHost && [LiveRoomStatus.DRAFT, LiveRoomStatus.SCHEDULED].includes(room.status)) {
      await this.prisma.liveRoom.update({
        where: { id: roomId },
        data: { status: LiveRoomStatus.LIVE, startedAt: new Date() },
      });
      await this.dispatchCaptionsAgent(roomId);
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

    return { serverUrl: url, roomName: room.id, token: await token.toJwt(), canPublish, expiresInSeconds: 600 };
  }

  async removeSpeaker(hostId: string, roomId: string, speakerId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true } });
    if (!room) throw new NotFoundException('Live room not found');
    if (!(await this.canModerateRoom(roomId, hostId, room.hostId))) throw new ForbiddenException('Only the host or an assigned room moderator can remove speakers');
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
      await tx.liveSpeakerTurn.updateMany({
        where: { roomId, speakerId, status: 'ACTIVE' }, data: { status: 'COMPLETED', endedAt: leftAt },
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
    if (!(await this.canModerateRoom(roomId, hostId, room.hostId))) throw new ForbiddenException('Only the host or an assigned room moderator can manage stage requests');
    if (room.status !== LiveRoomStatus.LIVE) throw new ConflictException('Room is not live');
    const request = await this.prisma.stageRequest.findFirst({ where: { id: requestId, roomId, status: 'PENDING' } });
    if (!request) throw new NotFoundException('Pending stage request not found');
    const decision = await this.prisma.$transaction(async (tx) => {
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
    if (approve) {
      await createUserNotification(this.prisma, {
        recipientId: request.userId, actorId: hostId, type: 'LIVE_STAGE_INVITATION',
        title: 'You have been invited onto the live stage',
        body: 'The host approved your request to speak. Return to the live room to join the stage.',
        resourceType: 'live_room', resourceId: roomId, category: 'liveInvitations',
      });
    }
    return decision;
  }
}
