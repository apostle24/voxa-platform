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
      stageRequest: { upsert: jest.fn() },
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
});
