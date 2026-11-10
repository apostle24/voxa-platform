import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreatorDto } from './dto/create-creator.dto';

@Injectable()
export class CreatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async onboard(userId: string, input: CreateCreatorDto) {
    const handle = input.handle.trim().toLowerCase();
    const existing = await this.prisma.creator.findUnique({ where: { handle } });
    if (existing) throw new ConflictException('Creator handle is already taken');

    const current = await this.prisma.creator.findUnique({ where: { userId } });
    if (current) throw new ConflictException('This account already has a creator profile');

    return this.prisma.$transaction(async (tx) => {
      const creator = await tx.creator.create({
        data: { userId, handle, bio: input.bio?.trim() || null },
        select: {
          id: true,
          handle: true,
          bio: true,
          createdAt: true,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { role: 'CREATOR' },
      });
      return creator;
    });
  }

  async getByHandle(handle: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { handle: handle.toLowerCase() },
      select: {
        id: true,
        handle: true,
        bio: true,
        verifiedAt: true,
        createdAt: true,
        user: { select: { displayName: true } },
        _count: { select: { followers: true, shows: true } },
      },
    });
    if (!creator) throw new NotFoundException('Creator not found');
    return {
      ...creator,
      followerCount: creator._count.followers,
      showCount: creator._count.shows,
      _count: undefined,
    };
  }

  async follow(userId: string, handle: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { handle: handle.toLowerCase() },
      select: { id: true, userId: true },
    });
    if (!creator) throw new NotFoundException('Creator not found');
    if (creator.userId === userId) throw new ConflictException('You cannot follow your own creator profile');

    await this.prisma.follow.upsert({
      where: { followerId_creatorId: { followerId: userId, creatorId: creator.id } },
      create: { followerId: userId, creatorId: creator.id },
      update: {},
    });
    return { following: true, creatorHandle: handle.toLowerCase() };
  }

  async unfollow(userId: string, handle: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { handle: handle.toLowerCase() },
      select: { id: true },
    });
    if (!creator) throw new NotFoundException('Creator not found');
    await this.prisma.follow.deleteMany({
      where: { followerId: userId, creatorId: creator.id },
    });
    return { following: false, creatorHandle: handle.toLowerCase() };
  }
}
