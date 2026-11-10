import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  let service: LedgerService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      ledgerTransaction: { findUnique: jest.fn() },
      ledgerAccount: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new LedgerService(prisma as unknown as PrismaService);
  });

  const input = {
    idempotencyKey: 'test-ledger-transfer-001',
    type: 'TEST_TRANSFER',
    currency: 'GHS',
    amountMinor: 1000,
    debitAccountId: 'debit-account',
    creditAccountId: 'credit-account',
  };

  it('rejects zero, negative, fractional, and unsafe amounts', async () => {
    for (const amountMinor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(service.postTransfer({ ...input, amountMinor })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.ledgerTransaction.findUnique).not.toHaveBeenCalled();
  });

  it('rejects transfers that debit and credit the same account', async () => {
    await expect(service.postTransfer({ ...input, creditAccountId: input.debitAccountId }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ledgerTransaction.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed currency codes', async () => {
    await expect(service.postTransfer({ ...input, currency: 'ghs' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ledgerTransaction.findUnique).not.toHaveBeenCalled();
  });

  it('rejects reusing an idempotency key for a different transfer', async () => {
    prisma.ledgerTransaction.findUnique.mockResolvedValue({
      type: 'DIFFERENT_TRANSFER',
      currency: 'GHS',
      amountMinor: 1000,
      entries: [
        { direction: 'DEBIT', accountId: input.debitAccountId },
        { direction: 'CREDIT', accountId: input.creditAccountId },
      ],
    });
    await expect(service.postTransfer(input)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires both accounts to exist in the requested currency', async () => {
    prisma.ledgerTransaction.findUnique.mockResolvedValue(null);
    prisma.ledgerAccount.findMany.mockResolvedValue([
      { id: input.debitAccountId, currency: 'GHS' },
      { id: input.creditAccountId, currency: 'USD' },
    ]);
    await expect(service.postTransfer(input)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
