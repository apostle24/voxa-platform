import { createUserNotification } from '../notifications/notification-writer';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommunityDto } from './dto/create-community.dto';

@Injectable()
export class CommunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async listOwned(userId: string) {
    return this.prisma.community.findMany({
      where: { ownerId: userId }, orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, slug: true, description: true, category: true, artworkUrl: true, createdAt: true,
        _count: { select: { members: true, posts: true } } },
    });
  }

  async listMembers(userId: string, communityId: string, query?: string) {
    const community = await this.prisma.community.findFirst({ where: { id: communityId, ownerId: userId }, select: { id: true, name: true } });
    if (!community) throw new NotFoundException('Community not found');
    const search = query?.trim();
    const where = { communityId, ...(search ? { user: { displayName: { contains: search, mode: 'insensitive' as const } } } : {}) };
    const [total, members] = await Promise.all([
      this.prisma.communityMember.count({ where }),
      this.prisma.communityMember.findMany({ where, orderBy: { joinedAt: 'desc' }, take: 100,
        select: { role: true, joinedAt: true, user: { select: { id: true, displayName: true, createdAt: true } } } }),
    ]);
    return { community, total, returned: members.length, hasMore: total > members.length, members: members.map(({ user, role, joinedAt }) => ({ ...user, role, joinedAt })) };
  }

  async removeMember(userId: string, communityId: string, memberId: string) {
    const community = await this.prisma.community.findFirst({ where: { id: communityId, ownerId: userId }, select: { id: true } });
    if (!community) throw new NotFoundException('Community not found');
    const member = await this.prisma.communityMember.findUnique({ where: { communityId_userId: { communityId, userId: memberId } }, select: { role: true } });
    if (!member) throw new NotFoundException('Community member not found');
    if (member.role === 'OWNER') throw new ConflictException('Community ownership cannot be removed from the member list');
    const removed = await this.prisma.communityMember.deleteMany({ where: { communityId, userId: memberId, role: { not: 'OWNER' } } });
    return { removed: removed.count === 1, communityId, memberId };
  }
  async discover(q?: string, category?: string) {
    const search = q?.trim();
    return this.prisma.community.findMany({
      where: {
        ...(category?.trim() ? { category: { equals: category.trim(), mode: 'insensitive' as const } } : {}),
        ...(search ? { OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ] } : {}),
      },
      orderBy: [{ members: { _count: 'desc' } }, { createdAt: 'desc' }],
      take: 40,
      select: {
        id: true, name: true, slug: true, description: true, category: true, artworkUrl: true, createdAt: true,
        owner: { select: { displayName: true } },
        _count: { select: { members: true, posts: true } },
      },
    });
  }

  async create(userId: string, input: CreateCommunityDto) {
    const name = input.name.trim();
    const base = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'community';
    const slug = `${base}-${Math.random().toString(36).slice(2, 8)}`;
    return this.prisma.$transaction(async (tx) => {
      const community = await tx.community.create({
        data: { ownerId: userId, name, slug, description: input.description?.trim() || null, category: input.category?.trim() || null, artworkUrl: input.artworkUrl?.trim() || null },
        select: { id: true, name: true, slug: true, description: true, category: true, artworkUrl: true, createdAt: true },
      });
      await tx.communityMember.create({ data: { communityId: community.id, userId, role: 'OWNER' } });
      return community;
    });
  }

  async get(slug: string, userId?: string) {
    const community = await this.prisma.community.findUnique({
      where: { slug },
      select: {
        id: true, name: true, slug: true, description: true, category: true, artworkUrl: true, createdAt: true,
        owner: { select: { id: true, displayName: true } },
        members: { where: userId ? { userId } : { userId: '__anonymous__' }, select: { role: true } },
        _count: { select: { members: true, posts: true } },
        posts: { orderBy: { createdAt: 'desc' }, take: 50, select: {
          id: true, content: true, createdAt: true,
          author: { select: { id: true, displayName: true } },
        } },
      },
    });
    if (!community) throw new NotFoundException('Community not found');
    return { ...community, membership: community.members[0] ?? null, members: undefined };
  }

  async membership(userId: string, communityId: string) {
    const membership = await this.prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId, userId } },
      select: { role: true, joinedAt: true },
    });
    return { joined: Boolean(membership), role: membership?.role ?? null, joinedAt: membership?.joinedAt ?? null };
  }

  async join(userId: string, communityId: string) {
    const community = await this.prisma.community.findUnique({ where: { id: communityId }, select: { id: true } });
    if (!community) throw new NotFoundException('Community not found');
    await this.prisma.communityMember.upsert({
      where: { communityId_userId: { communityId, userId } },
      create: { communityId, userId },
      update: {},
    });
    return { joined: true, communityId };
  }

  async leave(userId: string, communityId: string) {
    const membership = await this.prisma.communityMember.findUnique({ where: { communityId_userId: { communityId, userId } } });
    if (!membership) return { joined: false, communityId };
    if (membership.role === 'OWNER') throw new ConflictException('Community owners cannot leave before transferring ownership');
    await this.prisma.communityMember.delete({ where: { communityId_userId: { communityId, userId } } });
    return { joined: false, communityId };
  }

  async createPost(userId: string, communityId: string, content: string) {
    const membership = await this.prisma.communityMember.findUnique({ where: { communityId_userId: { communityId, userId } } });
    if (!membership) throw new ForbiddenException('Join this community before posting');
    const value = content.trim();
    if (!value) throw new ConflictException('Post content cannot be empty');
    const post = await this.prisma.communityPost.create({
      data: { communityId, authorId: userId, content: value },
      select: { id: true, content: true, createdAt: true, author: { select: { id: true, displayName: true } } },
    });
    const [community, members] = await Promise.all([
      this.prisma.community.findUnique({ where: { id: communityId }, select: { name: true } }),
      this.prisma.communityMember.findMany({ where: { communityId, userId: { not: userId } }, select: { userId: true }, take: 500 }),
    ]);
    await Promise.all(members.map(member => createUserNotification(this.prisma, {
      recipientId: member.userId, actorId: userId, type: 'COMMUNITY_POST',
      title: 'New community discussion', body: `A new post was shared in ${community?.name ?? 'your community'}.`,
      resourceType: 'community', resourceId: communityId, category: 'community',
    })));
    return post;
  }
}