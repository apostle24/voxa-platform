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
import { Prisma, PaymentAttemptStatus, MembershipSubscriptionStatus, LedgerAccountType, PayoutRequestStatus } from '@prisma/client';
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
    // Resolve configuration before creating a payment attempt. A missing key must
    // never leave behind a misleading FAILED attempt.
    const paystackSecret = this.secretKey();
    const customer = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!customer) throw new NotFoundException('Account not found');

    const platformFeeBps = 1500;
    const platformFeeMinor = Math.floor((plan.priceMinor * platformFeeBps + 5000) / 10000);
    const creatorNetMinor = plan.priceMinor - platformFeeMinor;
    if (!Number.isSafeInteger(platformFeeMinor) || creatorNetMinor <= 0) {
      throw new BadRequestException('Membership amount is too small to allocate safely');
    }

    const reference = 'VOXA_' + randomUUID().replace(/-/g, '');
    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        userId, creatorId: plan.creatorId, planId: plan.id, provider: PROVIDER,
        reference, amountMinor: plan.priceMinor, currency: plan.currency,
        platformFeeBps, platformFeeMinor, creatorNetMinor,
      },
    });

    let response: Response;
    try {
      response = await fetch(PAYSTACK_API + '/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + paystackSecret,
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
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      // A timeout or connection reset is ambiguous: Paystack may have accepted
      // the request. Keep INITIALIZED so a later webhook/reconciliation can settle it.
      throw new ServiceUnavailableException(
        'Payment initialization could not be confirmed. Check payment history before retrying.',
      );
    }

    let result: {
      status?: boolean;
      message?: string;
      data?: { authorization_url?: string };
    };
    try {
      result = await response.json() as typeof result;
    } catch {
      // A malformed/truncated response is not proof that the provider rejected
      // the transaction. Preserve the attempt for safe reconciliation.
      throw new ServiceUnavailableException(
        'Paystack returned an unreadable response. Check payment history before retrying.',
      );
    }

    if (!response.ok || !result.status || !result.data?.authorization_url) {
      // We received a definitive provider response, so this attempt can be closed.
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: PaymentAttemptStatus.FAILED },
      });
      throw new ServiceUnavailableException(result.message || 'Paystack rejected payment initialization');
    }

    return this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { checkoutUrl: result.data.authorization_url },
      select: { id: true, reference: true, amountMinor: true, currency: true, status: true, checkoutUrl: true },
    });
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
      data?: { status?: string; reference?: string; amount?: number; currency?: string; fees?: number };
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

    const providerFeeMinor = typeof verified.fees === 'number' &&
      Number.isSafeInteger(verified.fees) && verified.fees >= 0 && verified.fees <= attempt.amountMinor
      ? verified.fees
      : null;

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
        const revenueKey = 'platform:revenue:' + attempt.currency;
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
        const revenueAccount = await tx.ledgerAccount.upsert({
          where: { accountKey: revenueKey },
          create: { accountKey: revenueKey, ownerId: null, type: LedgerAccountType.PLATFORM_REVENUE, currency: attempt.currency },
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
                { accountId: creatorAccount.id, direction: 'CREDIT', amountMinor: attempt.creatorNetMinor },
                { accountId: revenueAccount.id, direction: 'CREDIT', amountMinor: attempt.platformFeeMinor },
              ],
            },
          },
        });

        if (providerFeeMinor !== null && providerFeeMinor > 0) {
          const expenseKey = 'platform:provider-fee-expense:' + attempt.currency;
          const expenseAccount = await tx.ledgerAccount.upsert({
            where: { accountKey: expenseKey },
            create: {
              accountKey: expenseKey, ownerId: null,
              type: LedgerAccountType.PROVIDER_FEE_EXPENSE, currency: attempt.currency,
            },
            update: {},
          });
          await tx.ledgerTransaction.create({
            data: {
              idempotencyKey: 'paystack:provider-fee:' + reference,
              type: 'PROVIDER_PROCESSING_FEE',
              currency: attempt.currency,
              amountMinor: providerFeeMinor,
              reference,
              entries: {
                create: [
                  { accountId: expenseAccount.id, direction: 'DEBIT', amountMinor: providerFeeMinor },
                  { accountId: platformAccount.id, direction: 'CREDIT', amountMinor: providerFeeMinor },
                ],
              },
            },
          });
        }

        await tx.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: PaymentAttemptStatus.PAID,
            paidAt: now,
            providerFeeMinor,
            providerFeeRecordedAt: providerFeeMinor !== null ? now : null,
          },
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

  async listPayoutDestinations(userId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId }, select: { id: true } });
    if (!creator) throw new ForbiddenException('Creator profile required');
    return this.prisma.creatorPayoutDestination.findMany({
      where: { creatorId: creator.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, provider: true, currency: true, country: true, channel: true,
        accountName: true, maskedAccountNumber: true, isVerified: true, isDefault: true,
        createdAt: true,
      },
    });
  }

  async setDefaultPayoutDestination(userId: string, destinationId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId }, select: { id: true },
    });
    if (!creator) throw new ForbiddenException('Creator profile required');
    const destination = await this.prisma.creatorPayoutDestination.findFirst({
      where: { id: destinationId, creatorId: creator.id },
      select: { id: true },
    });
    if (!destination) throw new NotFoundException('Payout destination not found');

    return this.prisma.$transaction(async tx => {
      await tx.creatorPayoutDestination.updateMany({
        where: { creatorId: creator.id }, data: { isDefault: false },
      });
      return tx.creatorPayoutDestination.update({
        where: { id: destination.id },
        data: { isDefault: true },
        select: {
          id: true, provider: true, currency: true, country: true, channel: true,
          accountName: true, maskedAccountNumber: true, isVerified: true, isDefault: true,
          createdAt: true,
        },
      });
    });
  }

  async createPayoutDestination(userId: string, input: {
    name: string; type: 'ghipss' | 'mobile_money'; bankCode: string; accountNumber: string;
  }) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId }, select: { id: true },
    });
    if (!creator) throw new ForbiddenException('Creator profile required');
    if (process.env.PAYSTACK_TRANSFERS_ENABLED !== 'true') {
      throw new ServiceUnavailableException(
        'Creator payout onboarding is not enabled yet. VOXA must first complete Paystack Transfers approval and staging checks.',
      );
    }

    const secret = this.secretKey();
    let response: Response;
    try {
      response = await fetch(PAYSTACK_API + '/transferrecipient', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: input.type,
          name: input.name.trim(),
          account_number: input.accountNumber,
          bank_code: input.bankCode,
          currency: 'GHS',
          metadata: { platform: 'VOXA', creatorId: creator.id },
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Paystack recipient creation could not be confirmed. Retry after checking your payout destinations.',
      );
    }

    const result = await response.json().catch(() => null) as {
      status?: boolean;
      message?: string;
      data?: {
        active?: boolean;
        currency?: string;
        name?: string;
        recipient_code?: string;
        type?: string;
        details?: { account_number?: string; account_name?: string };
      };
    } | null;
    const recipient = result?.data;
    if (!response.ok || !result?.status || !recipient?.recipient_code || recipient.currency !== 'GHS') {
      throw new ServiceUnavailableException(result?.message || 'Paystack could not register this payout destination');
    }

    const existing = await this.prisma.creatorPayoutDestination.findUnique({
      where: { providerRecipientCode: recipient.recipient_code },
    });
    if (existing && existing.creatorId !== creator.id) {
      throw new ConflictException('This payout destination is already linked to another VOXA creator');
    }
    if (existing) {
      return this.prisma.creatorPayoutDestination.findUniqueOrThrow({
        where: { id: existing.id },
        select: {
          id: true, provider: true, currency: true, country: true, channel: true,
          accountName: true, maskedAccountNumber: true, isVerified: true, isDefault: true,
          createdAt: true,
        },
      });
    }

    const masked = (recipient.details?.account_number || input.accountNumber).slice(-4);
    return this.prisma.$transaction(async tx => {
      const destinationCount = await tx.creatorPayoutDestination.count({ where: { creatorId: creator.id } });
      if (destinationCount === 0) {
        await tx.creatorPayoutDestination.updateMany({
          where: { creatorId: creator.id }, data: { isDefault: false },
        });
      }
      return tx.creatorPayoutDestination.create({
        data: {
          creatorId: creator.id,
          provider: PROVIDER,
          providerRecipientCode: recipient.recipient_code!,
          currency: 'GHS',
          country: 'GH',
          channel: input.type,
          accountName: recipient.details?.account_name || recipient.name || input.name.trim(),
          maskedAccountNumber: '••••' + masked,
          // Paystack's "active" recipient flag means the recipient record is active;
          // it is not proof of creator identity or account ownership.
          isVerified: false,
          isDefault: destinationCount === 0,
        },
        select: {
          id: true, provider: true, currency: true, country: true, channel: true,
          accountName: true, maskedAccountNumber: true, isVerified: true, isDefault: true,
          createdAt: true,
        },
      });
    });
  }


  /**
   * Release creator revenue only after the seven-day settlement hold.
   * Each payment is moved once using a stable ledger idempotency key.
   */
  async releaseMaturedCreatorEarnings(userId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId }, select: { id: true, userId: true } });
    if (!creator) throw new ForbiddenException('Creator profile required');
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const matured = await this.prisma.paymentAttempt.findMany({
      where: {
        creatorId: creator.id, provider: PROVIDER, status: PaymentAttemptStatus.PAID,
        paidAt: { lte: cutoff },
      },
      select: { id: true, reference: true, creatorNetMinor: true, currency: true },
      orderBy: { paidAt: 'asc' },
      take: 500,
    });

    for (const payment of matured) {
      try {
        await this.prisma.$transaction(async tx => {
          const pending = await tx.ledgerAccount.upsert({
            where: { accountKey: 'user:' + creator.userId + ':creator-pending:' + payment.currency },
            create: {
              accountKey: 'user:' + creator.userId + ':creator-pending:' + payment.currency,
              ownerId: creator.userId, type: LedgerAccountType.CREATOR_PENDING, currency: payment.currency,
            },
            update: {},
          });
          const available = await tx.ledgerAccount.upsert({
            where: { accountKey: 'user:' + creator.userId + ':creator-available:' + payment.currency },
            create: {
              accountKey: 'user:' + creator.userId + ':creator-available:' + payment.currency,
              ownerId: creator.userId, type: LedgerAccountType.CREATOR_AVAILABLE, currency: payment.currency,
            },
            update: {},
          });
          await tx.ledgerTransaction.create({
            data: {
              idempotencyKey: 'settlement-release:' + payment.reference,
              type: 'SETTLEMENT_RELEASE', currency: payment.currency,
              amountMinor: payment.creatorNetMinor, reference: payment.reference,
              entries: { create: [
                { accountId: pending.id, direction: 'DEBIT', amountMinor: payment.creatorNetMinor },
                { accountId: available.id, direction: 'CREDIT', amountMinor: payment.creatorNetMinor },
              ] },
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) throw error;
      }
    }
    return { releasedPaymentsChecked: matured.length, settlementHoldDays: 7 };
  }

  async createPayoutRequest(userId: string, destinationId: string, amountMinor: number, idempotencyKey: string | undefined) {
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey)) {
      throw new BadRequestException('A valid Idempotency-Key header (12–128 characters) is required');
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Payout amount must be a positive whole number of minor currency units');
    }
    const creator = await this.prisma.creator.findUnique({ where: { userId }, select: { id: true } });
    if (!creator) throw new ForbiddenException('Creator profile required');

    const prior = await this.prisma.payoutRequest.findUnique({ where: { idempotencyKey } });
    if (prior) {
      if (prior.creatorId !== creator.id || prior.destinationId !== destinationId || prior.amountMinor !== amountMinor) {
        throw new ConflictException('Idempotency key was already used for a different payout request');
      }
      return prior;
    }

    await this.releaseMaturedCreatorEarnings(userId);
    const destination = await this.prisma.creatorPayoutDestination.findFirst({
      where: { id: destinationId, creatorId: creator.id, isVerified: true },
    });
    if (!destination) {
      throw new ForbiddenException('A verified payout destination belonging to this creator is required');
    }
    if (destination.currency !== 'GHS' || destination.country !== 'GH') {
      throw new BadRequestException('This payout flow currently supports verified Ghana GHS destinations only');
    }

    const reference = 'VOXA_PAYOUT_' + randomUUID().replace(/-/g, '');
    try {
      return await this.prisma.$transaction(async tx => {
        const available = await tx.ledgerAccount.findUnique({
          where: { accountKey: 'user:' + userId + ':creator-available:' + destination.currency },
        });
        if (!available) throw new BadRequestException('There are no settled creator earnings available for payout');
        const totals = await tx.ledgerEntry.groupBy({
          by: ['direction'],
          where: { accountId: available.id },
          _sum: { amountMinor: true },
        });
        const credits = totals.find(row => row.direction === 'CREDIT')?._sum.amountMinor || 0;
        const debits = totals.find(row => row.direction === 'DEBIT')?._sum.amountMinor || 0;
        const balance = credits - debits;
        if (amountMinor > balance) {
          throw new BadRequestException('Requested payout exceeds your settled available balance');
        }

        const hold = await tx.ledgerAccount.upsert({
          where: { accountKey: 'user:' + userId + ':creator-payout-hold:' + destination.currency },
          create: {
            accountKey: 'user:' + userId + ':creator-payout-hold:' + destination.currency,
            ownerId: userId, type: LedgerAccountType.CREATOR_PAYOUT_HOLD, currency: destination.currency,
          },
          update: {},
        });
        const request = await tx.payoutRequest.create({
          data: {
            creatorId: creator.id, destinationId, provider: destination.provider,
            reference, idempotencyKey, amountMinor, currency: destination.currency,
            status: PayoutRequestStatus.REQUESTED,
          },
          select: {
            id: true, reference: true, amountMinor: true, currency: true, status: true,
            requestedAt: true, destination: { select: { accountName: true, maskedAccountNumber: true, channel: true } },
          },
        });
        await tx.ledgerTransaction.create({
          data: {
            idempotencyKey: 'payout-reserve:' + reference,
            type: 'CREATOR_PAYOUT_RESERVE', currency: destination.currency,
            amountMinor, reference,
            entries: { create: [
              { accountId: available.id, direction: 'DEBIT', amountMinor },
              { accountId: hold.id, direction: 'CREDIT', amountMinor },
            ] },
          },
        });
        return request;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        const duplicate = await this.prisma.payoutRequest.findUnique({ where: { idempotencyKey } });
        if (duplicate && duplicate.creatorId === creator.id && duplicate.destinationId === destinationId && duplicate.amountMinor === amountMinor) return duplicate;
      }
      throw error;
    }
  }

  async getCreatorPayoutRequests(userId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId }, select: { id: true } });
    if (!creator) throw new ForbiddenException('Creator profile required');
    return this.prisma.payoutRequest.findMany({
      where: { creatorId: creator.id },
      orderBy: { requestedAt: 'desc' },
      take: 50,
      select: {
        id: true, reference: true, amountMinor: true, currency: true, status: true,
        failureReason: true, requestedAt: true, reviewedAt: true, paidAt: true,
        destination: { select: { accountName: true, maskedAccountNumber: true, channel: true } },
      },
    });
  }

  async getCreatorEarnings(userId: string) {
    await this.releaseMaturedCreatorEarnings(userId);
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
    return {
      balances,
      transactions: transactions.map(transaction => ({
        ...transaction,
        creatorAmountMinor: transaction.entries.reduce(
          (net, entry) => net + (entry.direction === 'CREDIT' ? entry.amountMinor : -entry.amountMinor),
          0,
        ),
      })),
    };
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
