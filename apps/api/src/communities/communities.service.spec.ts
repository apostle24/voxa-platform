import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommunitiesService } from './communities.service';

describe('CommunitiesService owner audience management', () => {
  let service: CommunitiesService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      community: { findFirst: jest.fn(), findMany: jest.fn() },
      communityMember: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), deleteMany: jest.fn() },
    };
    service = new CommunitiesService(prisma as unknown as PrismaService);
  });

  it('lists members only when the requesting user owns the community', async () => {
    prisma.community.findFirst.mockResolvedValue({ id: 'community-1', name: 'VOXA Creators' });
    prisma.communityMember.count.mockResolvedValue(1);
    prisma.communityMember.findMany.mockResolvedValue([{
      role: 'MEMBER', joinedAt: new Date('2026-01-01T00:00:00Z'),
      user: { id: 'member-1', displayName: 'Listener One', createdAt: new Date('2025-01-01T00:00:00Z') },
    }]);

    const result = await service.listMembers('owner-1', 'community-1');

    expect(prisma.community.findFirst).toHaveBeenCalledWith({
      where: { id: 'community-1', ownerId: 'owner-1' }, select: { id: true, name: true },
    });
    expect(result).toMatchObject({ total: 1, members: [{ id: 'member-1', displayName: 'Listener One', role: 'MEMBER' }] });
  });

  it('does not disclose members to a non-owner', async () => {
    prisma.community.findFirst.mockResolvedValue(null);
    await expect(service.listMembers('intruder', 'community-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.communityMember.findMany).not.toHaveBeenCalled();
  });

  it('allows an owner to remove an ordinary community member', async () => {
    prisma.community.findFirst.mockResolvedValue({ id: 'community-1' });
    prisma.communityMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.communityMember.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.removeMember('owner-1', 'community-1', 'member-1')).resolves.toEqual({
      removed: true, communityId: 'community-1', memberId: 'member-1',
    });
    expect(prisma.communityMember.deleteMany).toHaveBeenCalledWith({
      where: { communityId: 'community-1', userId: 'member-1', role: { not: 'OWNER' } },
    });
  });

  it('prevents removal of the community owner', async () => {
    prisma.community.findFirst.mockResolvedValue({ id: 'community-1' });
    prisma.communityMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    await expect(service.removeMember('owner-1', 'community-1', 'owner-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.communityMember.deleteMany).not.toHaveBeenCalled();
  });

  it('does not let non-owners remove community members', async () => {
    prisma.community.findFirst.mockResolvedValue(null);
    await expect(service.removeMember('intruder', 'community-1', 'member-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.communityMember.deleteMany).not.toHaveBeenCalled();
  });
});
