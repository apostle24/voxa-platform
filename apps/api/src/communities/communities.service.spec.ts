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


describe('CommunitiesService discussion replies', () => {
  let service: CommunitiesService;
  let prisma: any;
  beforeEach(() => {
    prisma = {
      communityMember: { findUnique: jest.fn() },
      communityPost: { findMany: jest.fn(), findFirst: jest.fn() },
      communityPostComment: { create: jest.fn() },
      userBlock: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
      notification: { create: jest.fn().mockResolvedValue({ id: 'notice-1', recipientId: 'owner-1', type: 'COMMUNITY_REPLY', title: 'New reply', body: null, resourceType: 'community', resourceId: 'community-1' }) },
      notificationDevice: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    };
    service = new CommunitiesService(prisma as unknown as PrismaService);
  });

  it('requires community membership before listing discussions', async () => {
    prisma.communityMember.findUnique.mockResolvedValue(null);
    await expect(service.listPosts('visitor', 'community-1')).rejects.toThrow('Join this community');
    expect(prisma.communityPost.findMany).not.toHaveBeenCalled();
  });

  it('returns discussion posts with their replies for members', async () => {
    prisma.communityMember.findUnique.mockResolvedValue({ id: 'membership-1' });
    prisma.communityPost.findMany.mockResolvedValue([{ id: 'post-1', comments: [{ id: 'reply-1', content: 'Welcome' }] }]);
    await expect(service.listPosts('member-1', 'community-1')).resolves.toEqual([
      { id: 'post-1', comments: [{ id: 'reply-1', content: 'Welcome' }] },
    ]);
  });

  it('filters posts and replies from accounts blocked in either direction', async () => {
    prisma.communityMember.findUnique.mockResolvedValue({ communityId: 'community-1' });
    prisma.userBlock.findMany.mockResolvedValue([{ blockerId: 'member-1', blockedUserId: 'blocked-1' }]);
    prisma.communityPost.findMany.mockResolvedValue([]);
    await service.listPosts('member-1', 'community-1');
    expect(prisma.communityPost.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { communityId: 'community-1', deletedAt: null, authorId: { notIn: ['blocked-1'] } },
      select: expect.objectContaining({
        comments: expect.objectContaining({ where: { authorId: { notIn: ['blocked-1'] } } }),
      }),
    }));
  });

  it('creates replies only on posts in the selected community', async () => {
    prisma.communityMember.findUnique.mockResolvedValue({ id: 'membership-1' });
    prisma.communityPost.findFirst.mockResolvedValue({ id: 'post-1', authorId: 'member-1' });
    prisma.communityPostComment.create.mockResolvedValue({ id: 'reply-1', content: 'Helpful!' });
    await expect(service.createPostComment('member-1', 'community-1', 'post-1', 'Helpful!'))
      .resolves.toMatchObject({ id: 'reply-1', content: 'Helpful!' });
    expect(prisma.communityPostComment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { postId: 'post-1', authorId: 'member-1', content: 'Helpful!' },
    }));
  });

  it('notifies the original author when another member replies', async () => {
    prisma.communityMember.findUnique.mockResolvedValue({ communityId: 'community-1' });
    prisma.communityPost.findFirst.mockResolvedValue({ id: 'post-1', authorId: 'post-author' });
    prisma.communityPostComment.create.mockResolvedValue({ id: 'reply-2', content: 'A reply' });
    await service.createPostComment('reply-author', 'community-1', 'post-1', 'A reply');
    expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        recipientId: 'post-author', actorId: 'reply-author', type: 'COMMUNITY_REPLY',
        resourceType: 'community', resourceId: 'community-1',
      }),
    }));
  });

  it('rejects replies to posts outside the community', async () => {
    prisma.communityMember.findUnique.mockResolvedValue({ id: 'membership-1' });
    prisma.communityPost.findFirst.mockResolvedValue(null);
    await expect(service.createPostComment('member-1', 'community-1', 'other-post', 'Reply'))
      .rejects.toThrow('Community post not found');
    expect(prisma.communityPostComment.create).not.toHaveBeenCalled();
  });
});
