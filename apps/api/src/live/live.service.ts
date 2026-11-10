import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
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

  async endRoom(userId: string, roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Live room not found');
    if (room.hostId !== userId) throw new ForbiddenException('Only the host can end this room');
    if (room.status === LiveRoomStatus.ENDED || room.status === LiveRoomStatus.CANCELLED) {
      return { id: room.id, status: room.status, endedAt: room.endedAt };
    }

    // DeleteRoom forcibly disconnects all participants and prevents further joins.
    await this.roomServiceClient().deleteRoom(room.id);
    const ended = await this.prisma.liveRoom.update({
      where: { id: roomId },
      data: { status: LiveRoomStatus.ENDED, endedAt: new Date() },
      select: { id: true, status: true, endedAt: true },
    });
    await this.prisma.liveStageMember.updateMany({
      where: { roomId, leftAt: null },
      data: { leftAt: ended.endedAt ?? new Date() },
    });
    return ended;
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
    }

    return { serverUrl: url, roomName: room.id, token: await token.toJwt(), canPublish: isHost || isSpeaker, expiresInSeconds: 600 };
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
