import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(PaymentsService.name);
  private settlementTimer?: ReturnType<typeof setInterval>;
  private settlementRunInProgress = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.SETTLEMENT_WORKER_ENABLED !== 'true') {
      this.logger.log('Scheduled settlement worker is disabled');
      return;
    }
    const intervalMs = Math.max(15_000, Number(process.env.SETTLEMENT_WORKER_INTERVAL_MS || 60_000));
    this.logger.log('Scheduled settlement worker enabled; interval ' + intervalMs + 'ms');
    this.settlementRunInProgress = true;
    void this.runScheduledSettlementBatch()
      .catch(error => this.logger.error('Initial settlement batch failed', error instanceof Error ? error.stack : String(error)))
      .finally(() => { this.settlementRunInProgress = false; });
    this.settlementTimer = setInterval(() => {
      if (this.settlementRunInProgress) return;
      this.settlementRunInProgress = true;
      void this.runScheduledSettlementBatch()
        .catch(error => this.logger.error('Scheduled settlement batch failed', error instanceof Error ? error.stack : String(error)))
        .finally(() => { this.settlementRunInProgress = false; });
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.settlementTimer) clearInterval(this.settlementTimer);
  }

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
    body: { event?: string; data?: Record<string, unknown> & { reference?: string } },
    rawBody: Buffer | undefined,
    signature: string | string[] | undefined,
  ) {
    this.verifySignature(rawBody, signature);
    const eventType = body?.event;
    const reference = body?.data?.reference;
    if (typeof reference !== 'string' || !reference) return { received: true, ignored: true };
    if (eventType === 'transfer.success' || eventType === 'transfer.failed' || eventType === 'transfer.reversed') {
      return this.handlePaystackTransferWebhook(eventType, reference, body.data || {}, body);
    }
    if (eventType !== 'charge.success') return { received: true, ignored: true };

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
          // Share the worker's transaction-scoped lock so on-demand earnings
          // reads cannot race a scheduled batch on the same ledger entries.
          const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(731904221, 7) AS locked`;
          if (!lock[0]?.locked) return;
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

  /**
   * Global scheduled settlement worker. A transaction-scoped PostgreSQL advisory
   * lock prevents two API replicas from releasing the same batch concurrently.
   * Each payment still has a stable ledger idempotency key as a second safeguard.
   */
  async runScheduledSettlementBatch() {
    return this.prisma.$transaction(async tx => {
      const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(731904221, 7) AS locked`;
      if (!lock[0]?.locked) return { skipped: true, reason: 'another settlement worker holds the lock', checked: 0, released: 0 };

      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const matured = await tx.paymentAttempt.findMany({
        where: { provider: PROVIDER, status: PaymentAttemptStatus.PAID, paidAt: { lte: cutoff } },
        select: { reference: true, creatorNetMinor: true, currency: true, creator: { select: { userId: true } } },
        orderBy: { paidAt: 'asc' },
        take: 100,
      });
      let released = 0;
      for (const payment of matured) {
        const idempotencyKey = 'settlement-release:' + payment.reference;
        const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey }, select: { id: true } });
        if (existing) continue;

        const userId = payment.creator.userId;
        const pending = await tx.ledgerAccount.upsert({
          where: { accountKey: 'user:' + userId + ':creator-pending:' + payment.currency },
          create: { accountKey: 'user:' + userId + ':creator-pending:' + payment.currency, ownerId: userId, type: LedgerAccountType.CREATOR_PENDING, currency: payment.currency },
          update: {},
        });
        const available = await tx.ledgerAccount.upsert({
          where: { accountKey: 'user:' + userId + ':creator-available:' + payment.currency },
          create: { accountKey: 'user:' + userId + ':creator-available:' + payment.currency, ownerId: userId, type: LedgerAccountType.CREATOR_AVAILABLE, currency: payment.currency },
          update: {},
        });
        await tx.ledgerTransaction.create({
          data: {
            idempotencyKey, type: 'SETTLEMENT_RELEASE', currency: payment.currency,
            amountMinor: payment.creatorNetMinor, reference: payment.reference,
            entries: { create: [
              { accountId: pending.id, direction: 'DEBIT', amountMinor: payment.creatorNetMinor },
              { accountId: available.id, direction: 'CREDIT', amountMinor: payment.creatorNetMinor },
            ] },
          },
        });
        released += 1;
      }
      return { skipped: false, checked: matured.length, released, settlementHoldDays: 7, batchLimit: 100, cutoff: cutoff.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
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


  async getAdminFinanceOverview() {
    const accounts = await this.prisma.ledgerAccount.findMany({ select: { id: true, type: true, currency: true } });
    const accountIds = accounts.map(account => account.id);
    const entries = accountIds.length ? await this.prisma.ledgerEntry.groupBy({
      by: ['accountId', 'direction'], where: { accountId: { in: accountIds } }, _sum: { amountMinor: true },
    }) : [];
    const balance = (accountId: string, normal: 'CREDIT' | 'DEBIT') => {
      const credit = entries.find(row => row.accountId === accountId && row.direction === 'CREDIT')?._sum.amountMinor || 0;
      const debit = entries.find(row => row.accountId === accountId && row.direction === 'DEBIT')?._sum.amountMinor || 0;
      return normal === 'CREDIT' ? credit - debit : debit - credit;
    };
    const currencies = Array.from(new Set(accounts.map(account => account.currency)));
    const payments = await this.prisma.paymentAttempt.groupBy({
      by: ['currency'], where: { status: PaymentAttemptStatus.PAID },
      _sum: { amountMinor: true, platformFeeMinor: true, creatorNetMinor: true, providerFeeMinor: true },
      _count: { _all: true },
    });
    const payouts = await this.prisma.payoutRequest.groupBy({
      by: ['currency', 'status'], _sum: { amountMinor: true }, _count: { _all: true },
    });
    const balances = currencies.map(currency => {
      const matching = accounts.filter(account => account.currency === currency);
      const sumType = (type: LedgerAccountType, normal: 'CREDIT' | 'DEBIT') =>
        matching.filter(account => account.type === type).reduce((total, account) => total + balance(account.id, normal), 0);
      const payment = payments.find(row => row.currency === currency);
      const payoutRows = payouts.filter(row => row.currency === currency);
      const creatorPending = sumType(LedgerAccountType.CREATOR_PENDING, 'CREDIT');
      const creatorAvailable = sumType(LedgerAccountType.CREATOR_AVAILABLE, 'CREDIT');
      const payoutHolds = sumType(LedgerAccountType.CREATOR_PAYOUT_HOLD, 'CREDIT');
      return {
        currency, collectionsGrossMinor: payment?._sum.amountMinor || 0,
        platformCommissionMinor: sumType(LedgerAccountType.PLATFORM_REVENUE, 'CREDIT'),
        creatorPendingMinor: creatorPending, creatorAvailableMinor: creatorAvailable,
        payoutHoldsMinor: payoutHolds, creatorLiabilitiesMinor: creatorPending + creatorAvailable + payoutHolds,
        providerFeeExpenseMinor: sumType(LedgerAccountType.PROVIDER_FEE_EXPENSE, 'DEBIT'),
        platformClearingBalanceMinor: sumType(LedgerAccountType.PLATFORM_CLEARING, 'DEBIT'),
        paidMembershipCount: payment?._count._all || 0,
        payouts: payoutRows.map(row => ({ status: row.status, amountMinor: row._sum.amountMinor || 0, count: row._count._all })),
      };
    });
    const [recentLedgerTransactions, recentAuditEvents] = await Promise.all([
      this.prisma.ledgerTransaction.findMany({
        orderBy: { createdAt: 'desc' }, take: 20,
        select: { id: true, type: true, currency: true, amountMinor: true, reference: true, createdAt: true,
          entries: { select: { direction: true, amountMinor: true, account: { select: { type: true } } } } },
      }),
      this.prisma.financialAuditLog.findMany({
        orderBy: { createdAt: 'desc' }, take: 20,
        select: { id: true, actorUserId: true, action: true, entityType: true, entityId: true, createdAt: true },
      }),
    ]);
    return { generatedAt: new Date().toISOString(), balances, recentLedgerTransactions, recentAuditEvents };
  }

  async listAdminPayoutDestinations() {
    return this.prisma.creatorPayoutDestination.findMany({
      where: { isVerified: false },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true, provider: true, currency: true, country: true, channel: true,
        accountName: true, maskedAccountNumber: true, createdAt: true,
        creator: { select: { handle: true, user: { select: { id: true, email: true, displayName: true } } } },
      },
    });
  }

  async verifyPayoutDestination(adminUserId: string, destinationId: string, evidence: { verificationMethod: string; verificationReference: string; notes?: string }) {
    return this.prisma.$transaction(async tx => {
      const destination = await tx.creatorPayoutDestination.findUnique({ where: { id: destinationId } });
      if (!destination) throw new NotFoundException('Payout destination not found');
      if (destination.isVerified) throw new ConflictException('Payout destination is already verified');
      await tx.creatorPayoutDestination.update({
        where: { id: destinationId }, data: { isVerified: true },
      });
      await tx.financialAuditLog.create({
        data: {
          actorUserId: adminUserId, action: 'PAYOUT_DESTINATION_VERIFIED',
          entityType: 'CreatorPayoutDestination', entityId: destinationId,
          metadata: { creatorId: destination.creatorId, provider: destination.provider, country: destination.country, currency: destination.currency, verificationMethod: evidence.verificationMethod, verificationReference: evidence.verificationReference, notes: evidence.notes || null },
        },
      });
      return { id: destinationId, isVerified: true };
    });
  }

  async listAdminPayoutRequests() {
    return this.prisma.payoutRequest.findMany({
      where: { status: { in: [PayoutRequestStatus.REQUESTED, PayoutRequestStatus.UNDER_REVIEW, PayoutRequestStatus.APPROVED, PayoutRequestStatus.SUBMITTED, PayoutRequestStatus.PROCESSING] } },
      orderBy: { requestedAt: 'asc' },
      take: 100,
      select: {
        id: true, reference: true, amountMinor: true, currency: true, status: true, requestedAt: true,
        creator: { select: { handle: true, user: { select: { id: true, email: true, displayName: true } } } },
        destination: { select: { id: true, provider: true, channel: true, accountName: true, maskedAccountNumber: true, isVerified: true } },
      },
    });
  }

  async markPayoutRequestUnderReview(adminUserId: string, payoutRequestId: string) {
    return this.prisma.$transaction(async tx => {
      const request = await tx.payoutRequest.findUnique({ where: { id: payoutRequestId } });
      if (!request) throw new NotFoundException('Payout request not found');
      if (request.status !== PayoutRequestStatus.REQUESTED) {
        throw new ConflictException('Only newly requested payouts can be moved into review');
      }
      if (request.currency !== 'GHS' || request.provider !== PROVIDER) {
        throw new BadRequestException('This admin review queue currently supports Paystack GHS payouts only');
      }
      const destination = await tx.creatorPayoutDestination.findUnique({ where: { id: request.destinationId } });
      if (!destination?.isVerified) {
        throw new ConflictException('The payout destination must be verified before review');
      }
      const updated = await tx.payoutRequest.update({
        where: { id: payoutRequestId },
        data: { status: PayoutRequestStatus.UNDER_REVIEW, reviewedAt: new Date() },
        select: { id: true, reference: true, amountMinor: true, currency: true, status: true, reviewedAt: true },
      });
      await tx.financialAuditLog.create({
        data: {
          actorUserId: adminUserId, action: 'PAYOUT_REQUEST_MARKED_UNDER_REVIEW',
          entityType: 'PayoutRequest', entityId: payoutRequestId,
          metadata: { reference: request.reference, amountMinor: request.amountMinor, currency: request.currency },
        },
      });
      return updated;
    });
  }


  async approvePayoutRequest(adminUserId: string, payoutRequestId: string, reason: string) {
    return this.prisma.$transaction(async tx => {
      const request = await tx.payoutRequest.findUnique({ where: { id: payoutRequestId } });
      if (!request) throw new NotFoundException('Payout request not found');
      if (request.status !== PayoutRequestStatus.UNDER_REVIEW) {
        throw new ConflictException('Only payout requests under review can be approved');
      }
      const destination = await tx.creatorPayoutDestination.findUnique({ where: { id: request.destinationId } });
      if (!destination?.isVerified || destination.creatorId !== request.creatorId ||
          destination.provider !== PROVIDER || request.provider !== PROVIDER ||
          request.currency !== 'GHS' || destination.currency !== 'GHS' || destination.country !== 'GH') {
        throw new ConflictException('A verified Ghana GHS Paystack destination is required');
      }
      const updated = await tx.payoutRequest.update({
        where: { id: payoutRequestId },
        data: { status: PayoutRequestStatus.APPROVED },
        select: { id: true, reference: true, amountMinor: true, currency: true, status: true },
      });
      await tx.financialAuditLog.create({
        data: {
          actorUserId: adminUserId, action: 'PAYOUT_REQUEST_APPROVED',
          entityType: 'PayoutRequest', entityId: payoutRequestId,
          metadata: { reference: request.reference, amountMinor: request.amountMinor, currency: request.currency, reason },
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async submitApprovedPayout(adminUserId: string, payoutRequestId: string) {
    if (process.env.PAYSTACK_TRANSFERS_ENABLED !== 'true' ||
        process.env.PAYSTACK_PAYOUT_EXECUTION_ENABLED !== 'true') {
      throw new ServiceUnavailableException('Paystack payout execution is disabled. Complete provider approval and staging tests before enabling it.');
    }
    const request = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutRequestId },
      include: { destination: true, creator: { select: { userId: true } } },
    });
    if (!request) throw new NotFoundException('Payout request not found');
    if (request.status !== PayoutRequestStatus.APPROVED) {
      throw new ConflictException('Only approved payout requests can be submitted');
    }
    if (request.provider !== PROVIDER || request.currency !== 'GHS' ||
        request.destination.provider !== PROVIDER || !request.destination.isVerified) {
      throw new BadRequestException('Only verified Paystack GHS payouts can be submitted');
    }

    // Persist SUBMITTED before the network call. If the connection times out,
    // the same reference can be verified; the request must never be blindly resent.
    const claimed = await this.prisma.payoutRequest.updateMany({
      where: { id: payoutRequestId, status: PayoutRequestStatus.APPROVED },
      data: { status: PayoutRequestStatus.SUBMITTED },
    });
    if (claimed.count !== 1) throw new ConflictException('Payout submission is already in progress');
    await this.prisma.financialAuditLog.create({
      data: {
        actorUserId: adminUserId, action: 'PAYOUT_TRANSFER_SUBMISSION_STARTED',
        entityType: 'PayoutRequest', entityId: payoutRequestId,
        metadata: { reference: request.reference, amountMinor: request.amountMinor, currency: request.currency },
      },
    });

    let response: Response;
    try {
      response = await fetch(PAYSTACK_API + '/transfer', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + this.secretKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'balance',
          amount: request.amountMinor,
          recipient: request.destination.providerRecipientCode,
          reference: request.reference.toLowerCase(),
          currency: request.currency,
          reason: 'VOXA creator earnings payout',
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ServiceUnavailableException('Paystack submission outcome is unknown. Verify this payout by its reference; do not submit it again.');
    }

    const result = await response.json().catch(() => null) as {
      status?: boolean; message?: string;
      data?: { status?: string; reference?: string; transfer_code?: string; amount?: number; currency?: string };
    } | null;
    if (!response.ok || !result?.status || !result.data?.reference ||
        result.data.reference.toLowerCase() !== request.reference.toLowerCase() ||
        result.data.amount !== request.amountMinor || result.data.currency !== request.currency) {
      // A provider rejection is definitive only when a valid response body
      // explicitly says status=false; unreadable/mismatched responses remain held.
      if (result && result.status === false) {
        await this.failPayoutAndReleaseHold(request.id, 'PROVIDER_REJECTED', result.message || 'Paystack rejected transfer submission');
      }
      throw new ServiceUnavailableException(result?.message || 'Paystack response could not be safely matched; payout remains held for reconciliation');
    }

    const nextStatus = result.data.status === 'pending'
      ? PayoutRequestStatus.PROCESSING
      : PayoutRequestStatus.SUBMITTED;
    await this.prisma.payoutRequest.updateMany({
      where: { id: payoutRequestId, status: PayoutRequestStatus.SUBMITTED },
      data: { status: nextStatus, providerTransferCode: result.data.transfer_code || undefined },
    });
    await this.prisma.financialAuditLog.create({
      data: {
        actorUserId: adminUserId, action: 'PAYOUT_TRANSFER_ACCEPTED_BY_PROVIDER',
        entityType: 'PayoutRequest', entityId: payoutRequestId,
        metadata: { reference: request.reference, providerTransferCode: result.data.transfer_code || null, providerStatus: result.data.status || 'unknown' },
      },
    });
    return { id: request.id, reference: request.reference, status: nextStatus, providerTransferCode: result.data.transfer_code || null };
  }

  private async failPayoutAndReleaseHold(payoutRequestId: string, eventType: string, reason: string) {
    return this.prisma.$transaction(async tx => {
      const request = await tx.payoutRequest.findUnique({
        where: { id: payoutRequestId },
        include: { creator: { select: { userId: true } } },
      });
      if (!request) throw new NotFoundException('Payout request not found');
      if (request.status === PayoutRequestStatus.FAILED) return { duplicate: true };
      if (request.status === PayoutRequestStatus.PAID) {
        throw new ConflictException('A paid payout requires a provider reversal event, not a failure transition');
      }
      if (request.status === PayoutRequestStatus.CANCELLED) return { duplicate: true };
      const holdKey = 'user:' + request.creator.userId + ':creator-payout-hold:' + request.currency;
      const availableKey = 'user:' + request.creator.userId + ':creator-available:' + request.currency;
      const hold = await tx.ledgerAccount.findUnique({ where: { accountKey: holdKey } });
      const available = await tx.ledgerAccount.upsert({
        where: { accountKey: availableKey },
        create: { accountKey: availableKey, ownerId: request.creator.userId, type: LedgerAccountType.CREATOR_AVAILABLE, currency: request.currency },
        update: {},
      });
      if (!hold) throw new ConflictException('Payout hold ledger account is missing; manual reconciliation is required');
      await tx.ledgerTransaction.create({
        data: {
          idempotencyKey: 'payout-release-failed:' + request.reference,
          type: 'CREATOR_PAYOUT_RELEASE_FAILED', currency: request.currency,
          amountMinor: request.amountMinor, reference: request.reference,
          entries: { create: [
            { accountId: hold.id, direction: 'DEBIT', amountMinor: request.amountMinor },
            { accountId: available.id, direction: 'CREDIT', amountMinor: request.amountMinor },
          ] },
        },
      });
      await tx.payoutRequest.update({
        where: { id: request.id },
        data: { status: PayoutRequestStatus.FAILED, failureReason: reason.slice(0, 500) },
      });
      await tx.financialAuditLog.create({
        data: {
          actorUserId: 'system:paystack-webhook', action: eventType,
          entityType: 'PayoutRequest', entityId: request.id,
          metadata: { reference: request.reference, reason },
        },
      });
      return { failed: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async handlePaystackTransferWebhook(
    eventType: string, reference: string, eventData: Record<string, unknown>, body: unknown,
  ) {
    const response = await fetch(PAYSTACK_API + '/transfer/verify/' + encodeURIComponent(reference), {
      headers: { Authorization: 'Bearer ' + this.secretKey() },
      signal: AbortSignal.timeout(15000),
    });
    const verifiedResponse = await response.json().catch(() => null) as {
      status?: boolean;
      data?: { status?: string; reference?: string; amount?: number; currency?: string; transfer_code?: string; fees?: number };
    } | null;
    if (!response.ok || !verifiedResponse?.status || !verifiedResponse.data) {
      throw new ServiceUnavailableException('Could not independently verify the Paystack transfer');
    }
    const verified = verifiedResponse.data;
    const expectedStatus = eventType === 'transfer.success' ? 'success'
      : eventType === 'transfer.failed' ? 'failed' : 'reversed';
    if (verified.reference?.toLowerCase() !== reference.toLowerCase() || verified.status !== expectedStatus) {
      throw new BadRequestException('Transfer webhook does not match the independently verified provider status');
    }
    const request = await this.prisma.payoutRequest.findFirst({
      where: { reference: { equals: reference, mode: 'insensitive' }, provider: PROVIDER },
    });
    if (!request) throw new NotFoundException('Payout request for transfer reference not found');
    if (verified.amount !== request.amountMinor || verified.currency !== request.currency) {
      throw new BadRequestException('Verified transfer amount or currency does not match the payout request');
    }

    const eventKey = eventType + ':' + request.reference;
    try {
      await this.prisma.$transaction(async tx => {
        await tx.paymentWebhookEvent.create({
          data: {
            provider: PROVIDER, eventKey, eventType, reference: request.reference,
            payload: JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue,
          },
        });
        const current = await tx.payoutRequest.findUniqueOrThrow({
          where: { id: request.id }, include: { creator: { select: { userId: true } } },
        });
        if (eventType === 'transfer.success') {
          if (current.status === PayoutRequestStatus.PAID) return;
          if (current.status !== PayoutRequestStatus.SUBMITTED && current.status !== PayoutRequestStatus.PROCESSING) {
            throw new ConflictException('Payout is not in a provider-submitted state');
          }
          const hold = await tx.ledgerAccount.findUnique({ where: { accountKey: 'user:' + current.creator.userId + ':creator-payout-hold:' + current.currency } });
          const clearing = await tx.ledgerAccount.findUnique({ where: { accountKey: 'platform:clearing:' + current.currency } });
          if (!hold || !clearing) throw new ConflictException('Payout ledger accounts are missing; reconciliation is required');
          await tx.ledgerTransaction.create({
            data: {
              idempotencyKey: 'payout-paid:' + current.reference, type: 'CREATOR_PAYOUT_PAID',
              currency: current.currency, amountMinor: current.amountMinor, reference: current.reference,
              entries: { create: [
                { accountId: hold.id, direction: 'DEBIT', amountMinor: current.amountMinor },
                { accountId: clearing.id, direction: 'CREDIT', amountMinor: current.amountMinor },
              ] },
            },
          });

          if (typeof verified.fees === 'number' && Number.isSafeInteger(verified.fees) && verified.fees > 0) {
            const expense = await tx.ledgerAccount.upsert({
              where: { accountKey: 'platform:provider-fee-expense:' + current.currency },
              create: { accountKey: 'platform:provider-fee-expense:' + current.currency, ownerId: null, type: LedgerAccountType.PROVIDER_FEE_EXPENSE, currency: current.currency },
              update: {},
            });
            await tx.ledgerTransaction.create({
              data: {
                idempotencyKey: 'paystack:payout-provider-fee:' + current.reference,
                type: 'PAYOUT_PROVIDER_PROCESSING_FEE', currency: current.currency,
                amountMinor: verified.fees, reference: current.reference,
                entries: { create: [
                  { accountId: expense.id, direction: 'DEBIT', amountMinor: verified.fees },
                  { accountId: clearing.id, direction: 'CREDIT', amountMinor: verified.fees },
                ] },
              },
            });
          }
          await tx.payoutRequest.update({ where: { id: current.id }, data: { status: PayoutRequestStatus.PAID, paidAt: new Date(), providerTransferCode: verified.transfer_code || current.providerTransferCode } });
        } else if (eventType === 'transfer.failed') {
          if (current.status !== PayoutRequestStatus.FAILED) {
            const hold = await tx.ledgerAccount.findUnique({ where: { accountKey: 'user:' + current.creator.userId + ':creator-payout-hold:' + current.currency } });
            const available = await tx.ledgerAccount.upsert({
              where: { accountKey: 'user:' + current.creator.userId + ':creator-available:' + current.currency },
              create: { accountKey: 'user:' + current.creator.userId + ':creator-available:' + current.currency, ownerId: current.creator.userId, type: LedgerAccountType.CREATOR_AVAILABLE, currency: current.currency },
              update: {},
            });
            if (!hold) throw new ConflictException('Payout hold ledger account is missing');
            await tx.ledgerTransaction.create({
              data: {
                idempotencyKey: 'payout-release-failed:' + current.reference, type: 'CREATOR_PAYOUT_RELEASE_FAILED',
                currency: current.currency, amountMinor: current.amountMinor, reference: current.reference,
                entries: { create: [
                  { accountId: hold.id, direction: 'DEBIT', amountMinor: current.amountMinor },
                  { accountId: available.id, direction: 'CREDIT', amountMinor: current.amountMinor },
                ] },
              },
            });
            await tx.payoutRequest.update({ where: { id: current.id }, data: { status: PayoutRequestStatus.FAILED, failureReason: String(eventData['failures'] || 'Paystack reported transfer failure').slice(0, 500) } });
          }
        } else {
          // A reversal is distinct from an initial failure: Paystack previously
          // debited the merchant balance, then returned the funds.
          if (current.status === PayoutRequestStatus.PAID) {
            const clearing = await tx.ledgerAccount.findUnique({ where: { accountKey: 'platform:clearing:' + current.currency } });
            const available = await tx.ledgerAccount.upsert({
              where: { accountKey: 'user:' + current.creator.userId + ':creator-available:' + current.currency },
              create: { accountKey: 'user:' + current.creator.userId + ':creator-available:' + current.currency, ownerId: current.creator.userId, type: LedgerAccountType.CREATOR_AVAILABLE, currency: current.currency },
              update: {},
            });
            if (!clearing) throw new ConflictException('Platform clearing account is missing');
            await tx.ledgerTransaction.create({
              data: {
                idempotencyKey: 'payout-reversal:' + current.reference, type: 'CREATOR_PAYOUT_REVERSED',
                currency: current.currency, amountMinor: current.amountMinor, reference: current.reference,
                entries: { create: [
                  { accountId: clearing.id, direction: 'DEBIT', amountMinor: current.amountMinor },
                  { accountId: available.id, direction: 'CREDIT', amountMinor: current.amountMinor },
                ] },
              },
            });
          } else if (current.status !== PayoutRequestStatus.FAILED) {
            const hold = await tx.ledgerAccount.findUnique({ where: { accountKey: 'user:' + current.creator.userId + ':creator-payout-hold:' + current.currency } });
            const available = await tx.ledgerAccount.upsert({
              where: { accountKey: 'user:' + current.creator.userId + ':creator-available:' + current.currency },
              create: { accountKey: 'user:' + current.creator.userId + ':creator-available:' + current.currency, ownerId: current.creator.userId, type: LedgerAccountType.CREATOR_AVAILABLE, currency: current.currency },
              update: {},
            });
            if (!hold) throw new ConflictException('Payout hold ledger account is missing');
            await tx.ledgerTransaction.create({
              data: {
                idempotencyKey: 'payout-release-failed:' + current.reference, type: 'CREATOR_PAYOUT_RELEASE_FAILED',
                currency: current.currency, amountMinor: current.amountMinor, reference: current.reference,
                entries: { create: [
                  { accountId: hold.id, direction: 'DEBIT', amountMinor: current.amountMinor },
                  { accountId: available.id, direction: 'CREDIT', amountMinor: current.amountMinor },
                ] },
              },
            });
          }
          await tx.payoutRequest.update({ where: { id: current.id }, data: { status: PayoutRequestStatus.FAILED, failureReason: 'Paystack reversed the transfer' } });
        }
        await tx.paymentWebhookEvent.update({
          where: { provider_eventKey: { provider: PROVIDER, eventKey } }, data: { processedAt: new Date() },
        });
        await tx.financialAuditLog.create({
          data: {
            actorUserId: 'system:paystack-webhook', action: eventType.toUpperCase().replace('.', '_'),
            entityType: 'PayoutRequest', entityId: current.id,
            metadata: { reference: current.reference, providerTransferCode: verified.transfer_code || null, amountMinor: current.amountMinor, currency: current.currency },
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return { received: true, transferEventProcessed: true };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw error;
    }
  }



  async reconcilePayoutTransfer(adminUserId: string, payoutRequestId: string) {
    const request = await this.prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
    if (!request) throw new NotFoundException('Payout request not found');
    if (request.provider !== PROVIDER || (request.status !== PayoutRequestStatus.SUBMITTED &&
        request.status !== PayoutRequestStatus.PROCESSING &&
        request.status !== PayoutRequestStatus.PAID)) {
      throw new ConflictException('Only submitted or completed Paystack payouts can be reconciled');
    }
    const response = await fetch(PAYSTACK_API + '/transfer/verify/' + encodeURIComponent(request.reference.toLowerCase()), {
      headers: { Authorization: 'Bearer ' + this.secretKey() },
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => null) as {
      status?: boolean;
      data?: { status?: string; reference?: string; amount?: number; currency?: string; failures?: unknown; fees?: number };
    } | null;
    if (!response.ok || !result?.status || !result.data ||
        result.data.reference?.toLowerCase() !== request.reference.toLowerCase() ||
        result.data.amount !== request.amountMinor || result.data.currency !== request.currency) {
      throw new ServiceUnavailableException('Paystack could not confirm a matching transfer. The payout remains unchanged.');
    }
    const providerStatus = result.data.status;
    if (providerStatus === 'pending' || providerStatus === 'otp' || providerStatus === 'received') {
      await this.prisma.financialAuditLog.create({
        data: {
          actorUserId: adminUserId, action: 'PAYOUT_TRANSFER_RECONCILIATION_PENDING',
          entityType: 'PayoutRequest', entityId: request.id,
          metadata: { reference: request.reference, providerStatus },
        },
      });
      return { reference: request.reference, status: request.status, providerStatus, reconciled: false };
    }
    const eventType = providerStatus === 'success' ? 'transfer.success'
      : providerStatus === 'failed' ? 'transfer.failed'
      : providerStatus === 'reversed' ? 'transfer.reversed' : null;
    if (!eventType) {
      throw new ServiceUnavailableException('Paystack returned a non-final transfer status; no ledger changes were made');
    }
    const processed = await this.handlePaystackTransferWebhook(
      eventType, request.reference, { failures: result.data.failures || null, fees: result.data.fees },
      { event: eventType, data: { reference: request.reference, status: providerStatus } },
    );
    await this.prisma.financialAuditLog.create({
      data: {
        actorUserId: adminUserId, action: 'PAYOUT_TRANSFER_RECONCILED',
        entityType: 'PayoutRequest', entityId: request.id,
        metadata: { reference: request.reference, providerStatus },
      },
    });
    return { reference: request.reference, providerStatus, reconciled: true, result: processed };
  }


}
