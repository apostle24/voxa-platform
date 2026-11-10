import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type TransferInput = {
  idempotencyKey: string;
  type: string;
  currency: string;
  amountMinor: number;
  debitAccountId: string;
  creditAccountId: string;
  reference?: string;
};

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async postTransfer(input: TransferInput) {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new BadRequestException('Ledger amount must be a positive integer in minor currency units');
    }
    if (input.debitAccountId === input.creditAccountId) {
      throw new BadRequestException('A ledger transfer requires two different accounts');
    }
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      throw new BadRequestException('Currency must be a three-letter uppercase code');
    }

    const existing = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { entries: true },
    });
    if (existing) return existing;

    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { id: { in: [input.debitAccountId, input.creditAccountId] } },
      select: { id: true, currency: true },
    });
    if (accounts.length !== 2 || accounts.some(account => account.currency !== input.currency)) {
      throw new NotFoundException('Both ledger accounts must exist and use the transaction currency');
    }

    try {
      return await this.prisma.$transaction(async tx => {
        const transaction = await tx.ledgerTransaction.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            type: input.type,
            currency: input.currency,
            amountMinor: input.amountMinor,
            reference: input.reference,
          },
        });
        await tx.ledgerEntry.createMany({
          data: [
            { transactionId: transaction.id, accountId: input.debitAccountId, direction: 'DEBIT', amountMinor: input.amountMinor },
            { transactionId: transaction.id, accountId: input.creditAccountId, direction: 'CREDIT', amountMinor: input.amountMinor },
          ],
        });
        return tx.ledgerTransaction.findUniqueOrThrow({
          where: { id: transaction.id },
          include: { entries: true },
        });
      });
    } catch (error) {
      const retry = await this.prisma.ledgerTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { entries: true },
      });
      if (retry) return retry;
      throw error;
    }
  }
}
