import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorsService } from './creators.service';

describe('CreatorsService audience', () => {
  let service: CreatorsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      creator: { findUnique: jest.fn() },
      follow: { count: jest.fn(), findMany: jest.fn() },
    };
    service = new CreatorsService(prisma as unknown as PrismaService);
  });

  it('returns the signed-in creator followers without exposing private account data', async () => {
    prisma.creator.findUnique.mockResolvedValue({ id: 'creator-1', handle: 'voxa-host' });
    prisma.follow.count.mockResolvedValue(1);
    prisma.follow.findMany.mockResolvedValue([{
      createdAt: new Date('2026-10-01T00:00:00Z'),
      follower: { id: 'listener-1', displayName: 'Listener One', createdAt: new Date('2025-01-01T00:00:00Z') },
    }]);

    const result = await service.getMyAudience('creator-user');

    expect(result).toMatchObject({
      creator: { id: 'creator-1', handle: 'voxa-host' },
      total: 1, returned: 1, hasMore: false,
      followers: [{ id: 'listener-1', displayName: 'Listener One' }],
    });
    expect(prisma.follow.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { creatorId: 'creator-1' }, take: 100,
    }));
  });

  it('requires a creator profile before returning an audience', async () => {
    prisma.creator.findUnique.mockResolvedValue(null);
    await expect(service.getMyAudience('listener-user')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.follow.findMany).not.toHaveBeenCalled();
  });
});
