import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipsService } from './memberships.service';

describe('MembershipsService currency boundary', () => {
  let service: MembershipsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      creator: { findUnique: jest.fn().mockResolvedValue({ id: 'creator-1' }) },
      membershipPlan: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    };
    service = new MembershipsService(prisma as unknown as PrismaService);
  });

  it('rejects non-GHS membership plan creation before writing to the database', async () => {
    await expect(service.createPlan('user-1', {
      name: 'Supporter',
      priceMinor: 1000,
      currency: 'USD',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.membershipPlan.create).not.toHaveBeenCalled();
  });

  it('rejects changing an existing plan to a currency the checkout provider does not support', async () => {
    await expect(service.updatePlan('user-1', 'plan-1', { currency: 'USD' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.membershipPlan.findFirst).not.toHaveBeenCalled();
    expect(prisma.membershipPlan.update).not.toHaveBeenCalled();
  });
});
