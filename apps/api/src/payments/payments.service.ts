import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, PaymentAttemptStatus, MembershipSubscriptionStatus, LedgerAccountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PROVIDER = 'paystack';
const PAYSTACK_API = 'https://api.paystack.co';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private secretKey() {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new ServiceUnavailableException('Paystack is not configured');
    return secret;
  }

  async createMembershipCheckout(userId: string, planId: string) {
    const plan = await this.prisma.membershipPlan.findFirst({
      where: { id: planId, isActive: true },
      include: { creator: { include: { user: { select: { id: true } } } } },
    });
    if (!plan) throw new NotFoundException('Active membership plan not found');
    if (plan.creator.user.id === userId) {
      throw new ForbiddenException('You cannot purchase your own membership');
    }
    // This first integration is GHS-only and grants one paid month. It does not auto-renew.
    if (plan.currency !== 'GHS') {
      throw new BadRequestException('Paystack checkout currently supports GHS membership plans only');
    }
    if (!Number.isSafeInteger(plan.priceMinor) || plan.priceMinor <= 0) {
      throw new BadRequestException('Membership plan price is invalid');
    }
    const customer = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!customer) throw new NotFoundException('Account not found');

    const reference = 'VOXA_' + randomUUID().replace(/-/g, '');
    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        userId, creatorId: plan.creatorId, planId: plan.id, provider: PROVIDER,
        reference, amountMinor: plan.priceMinor, currency: plan.currency,
      },
    });

    try {
      const response = await fetch(PAYSTACK_API + '/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.secretKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: customer.email,
          amount: attempt.amountMinor,
          currency: attempt.currency,
          reference,
          callback_url: process.env.PAYSTACK_CALLBACK_URL || undefined,
          metadata: { platform: 'VOXA', purpose: 'CREATOR_MEMBERSHIP', paymentAttemptId: attempt.id, planId: plan.id },
        }),
      });
      const result = await response.json() as {
        status?: boolean;
        message?: string;
        data?: { authorization_url?: string };
      };
      if (!response.ok || !result.status || !result.data?.authorization_url) {
        throw new Error(result.message || 'Paystack did not return a checkout URL');
      }
      return this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { checkoutUrl: result.data.authorization_url },
        select: { id: true, reference: true, amountMinor: true, currency: true, status: true, checkoutUrl: true },
      });
    } catch {
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: PaymentAttemptStatus.FAILED },
      });
      throw new ServiceUnavailableException('Unable to initialize payment with Paystack');
    }
  }

  private verifySignature(rawBody: Buffer | undefined, signature: string | string[] | undefined) {
    if (!rawBody || !signature || Array.isArray(signature)) {
      throw new UnauthorizedException('A signed Paystack webhook is required');
    }
    const expected = createHmac('sha512', this.secretKey()).update(rawBody).digest('hex');
    const actualBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
      throw new UnauthorizedException('Invalid Paystack webhook signature');
    }
  }

  private async verifyWithProvider(reference: string) {
    const response = await fetch(PAYSTACK_API + '/transaction/verify/' + encodeURIComponent(reference), {
      headers: { Authorization: 'Bearer ' + this.secretKey() },
    });
    const result = await response.json() as {
      status?: boolean;
      data?: { status?: string; reference?: string; amount?: number; currency?: string };
    };
    if (!response.ok || !result.status || !result.data) {
      throw new ServiceUnavailableException('Could not verify the payment with Paystack');
    }
    return result.data;
  }

  async handlePaystackWebhook(
    body: { event?: string; data?: { reference?: string } },
    rawBody: Buffer | undefined,
    signature: string | string[] | undefined,
  ) {
    this.verifySignature(rawBody, signature);
    const eventType = body?.event;
    const reference = body?.data?.reference;
    if (eventType !== 'charge.success' || !reference) return { received: true, ignored: true };

    const verified = await this.verifyWithProvider(reference);
    if (
      verified.status !== 'success' ||
      verified.reference !== reference ||
      (typeof verified.amount !== 'number' || !Number.isSafeInteger(verified.amount)) ||
      !verified.currency
    ) {
      throw new BadRequestException('Payment verification did not return a successful transaction');
    }
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { reference } });
    if (!attempt || attempt.provider !== PROVIDER) throw new NotFoundException('Payment attempt not found');
    if (attempt.amountMinor !== verified.amount || attempt.currency !== verified.currency) {
      throw new BadRequestException('Verified payment amount or currency does not match the checkout');
    }

    const eventKey = 'charge.success:' + reference;
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.paymentWebhookEvent.create({
          data: {
            provider: PROVIDER, eventKey, eventType, reference,
            payload: JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue,
          },
        });

        const currentAttempt = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
        if (currentAttempt.status === PaymentAttemptStatus.PAID) {
          await tx.paymentWebhookEvent.update({
            where: { provider_eventKey: { provider: PROVIDER, eventKey } },
            data: { processedAt: new Date() },
          });
          return { received: true, alreadyPaid: true };
        }
        if (currentAttempt.status !== PaymentAttemptStatus.INITIALIZED) {
          throw new ConflictException('This payment attempt is no longer payable');
        }

        const now = new Date();
        const existing = await tx.membershipSubscription.findUnique({
          where: { subscriberId_creatorId: { subscriberId: attempt.userId, creatorId: attempt.creatorId } },
        });
        const periodStart = existing?.currentPeriodEnd && existing.currentPeriodEnd > now
          ? existing.currentPeriodEnd
          : now;
        const periodEnd = new Date(periodStart);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await tx.membershipSubscription.upsert({
          where: { subscriberId_creatorId: { subscriberId: attempt.userId, creatorId: attempt.creatorId } },
          create: {
            subscriberId: attempt.userId, creatorId: attempt.creatorId, planId: attempt.planId,
            priceMinor: attempt.amountMinor, currency: attempt.currency,
            status: MembershipSubscriptionStatus.ACTIVE, provider: PROVIDER,
            currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
          },
          update: {
            planId: attempt.planId, priceMinor: attempt.amountMinor, currency: attempt.currency,
            status: MembershipSubscriptionStatus.ACTIVE, provider: PROVIDER,
            currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false,
          },
        });

        const creator = await tx.creator.findUniqueOrThrow({
          where: { id: attempt.creatorId }, select: { userId: true },
        });
        const platformKey = 'platform:clearing:' + attempt.currency;
        const creatorKey = 'user:' + creator.userId + ':creator-pending:' + attempt.currency;
        const platformAccount = await tx.ledgerAccount.upsert({
          where: { accountKey: platformKey },
          create: { accountKey: platformKey, ownerId: null, type: LedgerAccountType.PLATFORM_CLEARING, currency: attempt.currency },
          update: {},
        });
        const creatorAccount = await tx.ledgerAccount.upsert({
          where: { accountKey: creatorKey },
          create: { accountKey: creatorKey, ownerId: creator.userId, type: LedgerAccountType.CREATOR_PENDING, currency: attempt.currency },
          update: {},
        });
        const transaction = await tx.ledgerTransaction.create({
          data: {
            idempotencyKey: 'paystack:membership:' + reference,
            type: 'MEMBERSHIP_PAYMENT', currency: attempt.currency,
            amountMinor: attempt.amountMinor, reference,
            entries: {
              create: [
                { accountId: platformAccount.id, direction: 'DEBIT', amountMinor: attempt.amountMinor },
                { accountId: creatorAccount.id, direction: 'CREDIT', amountMinor: attempt.amountMinor },
              ],
            },
          },
        });

        await tx.paymentAttempt.update({
          where: { id: attempt.id }, data: { status: PaymentAttemptStatus.PAID, paidAt: now },
        });
        await tx.paymentWebhookEvent.update({
          where: { provider_eventKey: { provider: PROVIDER, eventKey } },
          data: { processedAt: now },
        });
        return { received: true, membershipActivated: true, transactionId: transaction.id };
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw error;
    }
  }

  async getCreatorEarnings(userId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId }, select: { id: true } });
    if (!creator) throw new ForbiddenException('Creator profile required');
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { ownerId: userId, type: { in: [LedgerAccountType.CREATOR_PENDING, LedgerAccountType.CREATOR_AVAILABLE] } },
      select: { id: true, type: true, currency: true },
    });
    const accountIds = accounts.map(account => account.id);
    if (!accountIds.length) return { balances: [], transactions: [] };
    const totals = await this.prisma.ledgerEntry.groupBy({
      by: ['accountId', 'direction'],
      where: { accountId: { in: accountIds } },
      _sum: { amountMinor: true },
    });
    const balances = accounts.map(account => {
      const credit = totals.find(row => row.accountId === account.id && row.direction === 'CREDIT')?._sum.amountMinor || 0;
      const debit = totals.find(row => row.accountId === account.id && row.direction === 'DEBIT')?._sum.amountMinor || 0;
      return {
        type: account.type,
        currency: account.currency,
        balanceMinor: credit - debit,
      };
    });
    const transactions = await this.prisma.ledgerTransaction.findMany({
      where: { entries: { some: { accountId: { in: accountIds } } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, type: true, currency: true, amountMinor: true, reference: true, createdAt: true,
        entries: { where: { accountId: { in: accountIds } }, select: { direction: true, amountMinor: true } },
      },
    });
    return { balances, transactions };
  }

  async getMyPaymentAttempt(userId: string, reference: string) {
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { userId, reference },
      select: {
        reference: true, amountMinor: true, currency: true, status: true, paidAt: true,
        creator: { select: { handle: true } },
        plan: { select: { name: true } },
      },
    });
    if (!attempt) throw new NotFoundException('Payment attempt not found');
    return attempt;
  }

  async getMyPaymentHistory(userId: string) {
    return this.prisma.paymentAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, reference: true, amountMinor: true, currency: true, status: true,
        checkoutUrl: true, paidAt: true, createdAt: true,
        creator: { select: { handle: true } },
        plan: { select: { name: true } },
      },
    });
  }

}
