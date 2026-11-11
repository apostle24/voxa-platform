import { createHmac } from 'node:crypto';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService safety boundaries', () => {
  let service: PaymentsService;
  let prisma: any;
  const originalSecret = process.env.PAYSTACK_SECRET_KEY;
  const originalTransfers = process.env.PAYSTACK_TRANSFERS_ENABLED;
  const originalExecution = process.env.PAYSTACK_PAYOUT_EXECUTION_ENABLED;

  beforeEach(() => {
    prisma = {
      payoutRequest: { findUnique: jest.fn(), findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      financialAuditLog: { create: jest.fn() },
      paymentAttempt: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      paymentWebhookEvent: { create: jest.fn(), update: jest.fn() },
      membershipSubscription: { findUnique: jest.fn(), upsert: jest.fn() },
      creator: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      ledgerAccount: { findUnique: jest.fn(), upsert: jest.fn() },
      ledgerTransaction: { findUnique: jest.fn(), create: jest.fn() },
      membershipPlan: { findFirst: jest.fn() },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new PaymentsService(prisma as unknown as PrismaService);
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    delete process.env.PAYSTACK_TRANSFERS_ENABLED;
    delete process.env.PAYSTACK_PAYOUT_EXECUTION_ENABLED;
  });

  afterEach(() => { jest.restoreAllMocks(); });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = originalSecret;
    if (originalTransfers === undefined) delete process.env.PAYSTACK_TRANSFERS_ENABLED;
    else process.env.PAYSTACK_TRANSFERS_ENABLED = originalTransfers;
    if (originalExecution === undefined) delete process.env.PAYSTACK_PAYOUT_EXECUTION_ENABLED;
    else process.env.PAYSTACK_PAYOUT_EXECUTION_ENABLED = originalExecution;
  });

  it('rejects a webhook with an invalid signature before accessing payment records', async () => {
    const rawBody = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'VOXA_TEST' } }));

    await expect(service.handlePaystackWebhook(
      { event: 'charge.success', data: { reference: 'VOXA_TEST' } },
      rawBody,
      'invalid-signature',
    )).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.paymentAttempt.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a webhook without the raw request body', async () => {
    await expect(service.handlePaystackWebhook(
      { event: 'charge.success', data: { reference: 'VOXA_TEST' } },
      undefined,
      'signature',
    )).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a validly signed unrelated event without treating it as a payment', async () => {
    const body = { event: 'customer.created', data: { reference: 'VOXA_TEST' } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(rawBody).digest('hex');

    await expect(service.handlePaystackWebhook(body, rawBody, signature))
      .resolves.toEqual({ received: true, ignored: true });

    expect(prisma.paymentAttempt.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allocates a GHS100 membership as 85% creator earnings and 15% VOXA commission', async () => {
    prisma.membershipPlan.findFirst.mockResolvedValue({
      id: 'plan-1', creatorId: 'creator-1', priceMinor: 10000, currency: 'GHS',
      creator: { user: { id: 'creator-user-1' } },
    });
    prisma.user.findUnique.mockResolvedValue({ email: 'listener@example.com' });
    prisma.paymentAttempt.create.mockResolvedValue({
      id: 'attempt-1', amountMinor: 10000, currency: 'GHS',
    });
    prisma.paymentAttempt.update.mockResolvedValue({
      id: 'attempt-1', reference: 'VOXA_TEST', amountMinor: 10000,
      currency: 'GHS', status: 'INITIALIZED', checkoutUrl: 'https://paystack.test/checkout',
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        status: true, data: { authorization_url: 'https://paystack.test/checkout' },
      }), { status: 200 }),
    );

    await service.createMembershipCheckout('listener-1', 'plan-1');

    expect(prisma.paymentAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        amountMinor: 10000, currency: 'GHS',
        platformFeeBps: 1500, platformFeeMinor: 1500, creatorNetMinor: 8500,
      }),
    }));
    const providerRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(providerRequest).toMatchObject({ amount: 10000, currency: 'GHS', email: 'listener@example.com' });
  });

  it('preserves an initialized payment attempt when Paystack initialization times out', async () => {
    prisma.membershipPlan.findFirst.mockResolvedValue({
      id: 'plan-1', creatorId: 'creator-1', priceMinor: 10000, currency: 'GHS',
      creator: { user: { id: 'creator-user-1' } },
    });
    prisma.user.findUnique.mockResolvedValue({ email: 'listener@example.com' });
    prisma.paymentAttempt.create.mockResolvedValue({
      id: 'attempt-1', amountMinor: 10000, currency: 'GHS',
    });
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network timeout'));

    await expect(service.createMembershipCheckout('listener-1', 'plan-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.paymentAttempt.create).toHaveBeenCalled();
    expect(prisma.paymentAttempt.update).not.toHaveBeenCalled();
  });

  it('marks a payment attempt failed only after an explicit provider rejection', async () => {
    prisma.membershipPlan.findFirst.mockResolvedValue({
      id: 'plan-1', creatorId: 'creator-1', priceMinor: 10000, currency: 'GHS',
      creator: { user: { id: 'creator-user-1' } },
    });
    prisma.user.findUnique.mockResolvedValue({ email: 'listener@example.com' });
    prisma.paymentAttempt.create.mockResolvedValue({
      id: 'attempt-1', amountMinor: 10000, currency: 'GHS',
    });
    prisma.paymentAttempt.update.mockResolvedValue({});
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: false, message: 'Rejected' }), { status: 400 }),
    );

    await expect(service.createMembershipCheckout('listener-1', 'plan-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.paymentAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' }, data: { status: 'FAILED' },
    });
  });


  it('posts verified membership revenue and provider fees to separate balanced ledger transactions', async () => {
    const body = { event: 'charge.success', data: { reference: 'VOXA_TEST' } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(rawBody).digest('hex');
    const attempt = {
      id: 'attempt-1', reference: 'VOXA_TEST', provider: 'paystack',
      userId: 'listener-1', creatorId: 'creator-1', planId: 'plan-1',
      amountMinor: 10000, currency: 'GHS',
      platformFeeBps: 1500, platformFeeMinor: 1500, creatorNetMinor: 8500,
      status: 'INITIALIZED',
    };
    prisma.paymentAttempt.findUnique.mockResolvedValue(attempt);
    prisma.paymentAttempt.findUniqueOrThrow.mockResolvedValue(attempt);
    prisma.paymentAttempt.update.mockResolvedValue({});
    prisma.paymentWebhookEvent.create.mockResolvedValue({});
    prisma.paymentWebhookEvent.update.mockResolvedValue({});
    prisma.membershipSubscription.findUnique.mockResolvedValue(null);
    prisma.membershipSubscription.upsert.mockResolvedValue({});
    prisma.creator.findUniqueOrThrow.mockResolvedValue({ userId: 'creator-user-1' });

    const accountIds = new Map<string, string>();
    prisma.ledgerAccount.upsert.mockImplementation(async ({ where, create }: any) => {
      const key = where.accountKey as string;
      if (!accountIds.has(key)) accountIds.set(key, 'account-' + (accountIds.size + 1));
      return { id: accountIds.get(key) };
    });
    prisma.ledgerTransaction.create
      .mockResolvedValueOnce({ id: 'membership-ledger-1' })
      .mockResolvedValueOnce({ id: 'provider-fee-ledger-1' });

    const tx = {
      paymentWebhookEvent: prisma.paymentWebhookEvent,
      paymentAttempt: { findUniqueOrThrow: prisma.paymentAttempt.findUniqueOrThrow, update: prisma.paymentAttempt.update },
      membershipSubscription: prisma.membershipSubscription,
      creator: prisma.creator,
      ledgerAccount: prisma.ledgerAccount,
      ledgerTransaction: prisma.ledgerTransaction,
    };
    prisma.$transaction.mockImplementation(async (callback: (client: any) => Promise<unknown>) => callback(tx));

    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        status: true,
        data: { status: 'success', reference: 'VOXA_TEST', amount: 10000, currency: 'GHS', fees: 200 },
      }), { status: 200 }),
    );

    await expect(service.handlePaystackWebhook(body, rawBody, signature)).resolves.toEqual({
      received: true, membershipActivated: true, transactionId: 'membership-ledger-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/verify/VOXA_TEST',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-paystack-secret' } }),
    );
    expect(prisma.ledgerTransaction.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        idempotencyKey: 'paystack:membership:VOXA_TEST',
        type: 'MEMBERSHIP_PAYMENT',
        amountMinor: 10000,
        entries: { create: [
          { accountId: 'account-1', direction: 'DEBIT', amountMinor: 10000 },
          { accountId: 'account-2', direction: 'CREDIT', amountMinor: 8500 },
          { accountId: 'account-3', direction: 'CREDIT', amountMinor: 1500 },
        ] },
      }),
    });
    expect(prisma.ledgerTransaction.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        idempotencyKey: 'paystack:provider-fee:VOXA_TEST',
        type: 'PROVIDER_PROCESSING_FEE',
        amountMinor: 200,
        entries: { create: [
          { accountId: 'account-4', direction: 'DEBIT', amountMinor: 200 },
          { accountId: 'account-1', direction: 'CREDIT', amountMinor: 200 },
        ] },
      }),
    });
    expect(prisma.paymentAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({ status: 'PAID', providerFeeMinor: 200 }),
    }));
    expect(prisma.paymentWebhookEvent.update).toHaveBeenCalled();
  });


  it('releases only matured paid earnings with a stable ledger idempotency key', async () => {
    prisma.creator.findUnique.mockResolvedValue({ id: 'creator-1', userId: 'creator-user-1' });
    prisma.paymentAttempt.findMany.mockResolvedValue([{
      id: 'attempt-1', reference: 'VOXA_MEMBERSHIP_1', creatorNetMinor: 8500, currency: 'GHS',
      creator: { userId: 'creator-user-1' },
    }]);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      paymentAttempt: { findMany: prisma.paymentAttempt.findMany },
      ledgerTransaction: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'settlement-1' }) },
      ledgerAccount: {
        upsert: jest.fn()
          .mockResolvedValueOnce({ id: 'pending-account' })
          .mockResolvedValueOnce({ id: 'available-account' }),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: any) => Promise<unknown>) => callback(tx));

    await expect(service.runScheduledSettlementBatch()).resolves.toMatchObject({
      skipped: false, checked: 1, released: 1, settlementHoldDays: 7, batchLimit: 100,
    });

    const query = prisma.paymentAttempt.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ provider: 'paystack', status: 'PAID' });
    expect(query.where.paidAt.lte).toBeInstanceOf(Date);
    expect(Date.now() - query.where.paidAt.lte.getTime()).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.ledgerTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: 'settlement-release:VOXA_MEMBERSHIP_1',
        type: 'SETTLEMENT_RELEASE', amountMinor: 8500, reference: 'VOXA_MEMBERSHIP_1',
        entries: { create: [
          { accountId: 'pending-account', direction: 'DEBIT', amountMinor: 8500 },
          { accountId: 'available-account', direction: 'CREDIT', amountMinor: 8500 },
        ] },
      }),
    });
  });

  it('does not release settlement earnings when another worker owns the advisory lock', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: false }]) };
    prisma.$transaction.mockImplementation(async (callback: (client: any) => Promise<unknown>) => callback(tx));

    await expect(service.runScheduledSettlementBatch()).resolves.toMatchObject({
      skipped: true, checked: 0, released: 0,
    });

    expect(prisma.paymentAttempt.findMany).not.toHaveBeenCalled();
  });

  it('releases a failed payout hold only after independently verifying the provider transfer', async () => {
    const body = { event: 'transfer.failed', data: { reference: 'VOXA_PAYOUT_1', failures: 'bank rejected' } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(rawBody).digest('hex');
    const payout = {
      id: 'payout-1', reference: 'VOXA_PAYOUT_1', provider: 'paystack',
      amountMinor: 5000, currency: 'GHS', status: 'SUBMITTED',
      creator: { userId: 'creator-user-1' },
    };
    prisma.payoutRequest.findFirst.mockResolvedValue(payout);
    prisma.payoutRequest.findUniqueOrThrow.mockResolvedValue(payout);
    prisma.paymentWebhookEvent.create.mockResolvedValue({});
    prisma.paymentWebhookEvent.update.mockResolvedValue({});
    prisma.ledgerAccount.findUnique.mockResolvedValue({ id: 'hold-account' });
    prisma.ledgerAccount.upsert.mockResolvedValue({ id: 'available-account' });
    prisma.ledgerTransaction.create.mockResolvedValue({ id: 'release-1' });
    prisma.payoutRequest.update.mockResolvedValue({});
    const tx = {
      paymentWebhookEvent: prisma.paymentWebhookEvent,
      payoutRequest: prisma.payoutRequest,
      ledgerAccount: prisma.ledgerAccount,
      ledgerTransaction: prisma.ledgerTransaction,
      financialAuditLog: prisma.financialAuditLog,
    };
    prisma.$transaction.mockImplementation(async (callback: (client: any) => Promise<unknown>) => callback(tx));
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        status: true,
        data: { status: 'failed', reference: 'VOXA_PAYOUT_1', amount: 5000, currency: 'GHS' },
      }), { status: 200 }),
    );

    await expect(service.handlePaystackWebhook(body, rawBody, signature)).resolves.toEqual({
      received: true, transferEventProcessed: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.paystack.co/transfer/verify/VOXA_PAYOUT_1',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-paystack-secret' } }),
    );
    expect(prisma.ledgerTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: 'payout-release-failed:VOXA_PAYOUT_1',
        type: 'CREATOR_PAYOUT_RELEASE_FAILED', amountMinor: 5000,
        entries: { create: [
          { accountId: 'hold-account', direction: 'DEBIT', amountMinor: 5000 },
          { accountId: 'available-account', direction: 'CREDIT', amountMinor: 5000 },
        ] },
      }),
    });
    expect(prisma.payoutRequest.update).toHaveBeenCalledWith({
      where: { id: 'payout-1' },
      data: { status: 'FAILED', failureReason: 'bank rejected' },
    });
  });


  it('settles a verified successful payout and books provider fees separately', async () => {
    const body = { event: 'transfer.success', data: { reference: 'VOXA_PAYOUT_PAID' } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(rawBody).digest('hex');
    const payout = {
      id: 'payout-paid-1', reference: 'VOXA_PAYOUT_PAID', provider: 'paystack',
      amountMinor: 5000, currency: 'GHS', status: 'SUBMITTED',
      creator: { userId: 'creator-user-1' },
    };
    prisma.payoutRequest.findFirst.mockResolvedValue(payout);
    prisma.payoutRequest.findUniqueOrThrow.mockResolvedValue(payout);
    prisma.paymentWebhookEvent.create.mockResolvedValue({});
    prisma.paymentWebhookEvent.update.mockResolvedValue({});
    prisma.ledgerAccount.findUnique
      .mockResolvedValueOnce({ id: 'hold-account' })
      .mockResolvedValueOnce({ id: 'clearing-account' });
    prisma.ledgerAccount.upsert.mockResolvedValue({ id: 'fee-expense-account' });
    prisma.ledgerTransaction.create
      .mockResolvedValueOnce({ id: 'payout-paid-ledger' })
      .mockResolvedValueOnce({ id: 'payout-fee-ledger' });
    prisma.payoutRequest.update.mockResolvedValue({});
    const tx = {
      paymentWebhookEvent: prisma.paymentWebhookEvent,
      payoutRequest: prisma.payoutRequest,
      ledgerAccount: prisma.ledgerAccount,
      ledgerTransaction: prisma.ledgerTransaction,
      financialAuditLog: prisma.financialAuditLog,
    };
    prisma.$transaction.mockImplementation(async (callback: (client: any) => Promise<unknown>) => callback(tx));
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        status: true,
        data: {
          status: 'success', reference: 'VOXA_PAYOUT_PAID', amount: 5000,
          currency: 'GHS', transfer_code: 'TRF_123', fees: 125,
        },
      }), { status: 200 }),
    );

    await expect(service.handlePaystackWebhook(body, rawBody, signature)).resolves.toEqual({
      received: true, transferEventProcessed: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.paystack.co/transfer/verify/VOXA_PAYOUT_PAID',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-paystack-secret' } }),
    );
    expect(prisma.ledgerTransaction.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        idempotencyKey: 'payout-paid:VOXA_PAYOUT_PAID',
        type: 'CREATOR_PAYOUT_PAID', amountMinor: 5000,
        entries: { create: [
          { accountId: 'hold-account', direction: 'DEBIT', amountMinor: 5000 },
          { accountId: 'clearing-account', direction: 'CREDIT', amountMinor: 5000 },
        ] },
      }),
    });
    expect(prisma.ledgerTransaction.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        idempotencyKey: 'paystack:payout-provider-fee:VOXA_PAYOUT_PAID',
        type: 'PAYOUT_PROVIDER_PROCESSING_FEE', amountMinor: 125,
        entries: { create: [
          { accountId: 'fee-expense-account', direction: 'DEBIT', amountMinor: 125 },
          { accountId: 'clearing-account', direction: 'CREDIT', amountMinor: 125 },
        ] },
      }),
    });
    expect(prisma.payoutRequest.update).toHaveBeenCalledWith({
      where: { id: 'payout-paid-1' },
      data: expect.objectContaining({ status: 'PAID', providerTransferCode: 'TRF_123' }),
    });
  });

  it('returns a reversed paid payout from clearing to creator availability', async () => {
    const body = { event: 'transfer.reversed', data: { reference: 'VOXA_PAYOUT_REVERSAL' } };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(rawBody).digest('hex');
    const payout = {
      id: 'payout-reversal-1', reference: 'VOXA_PAYOUT_REVERSAL', provider: 'paystack',
      amountMinor: 5000, currency: 'GHS', status: 'PAID',
      creator: { userId: 'creator-user-1' },
    };
    prisma.payoutRequest.findFirst.mockResolvedValue(payout);
    prisma.payoutRequest.findUniqueOrThrow.mockResolvedValue(payout);
    prisma.paymentWebhookEvent.create.mockResolvedValue({});
    prisma.paymentWebhookEvent.update.mockResolvedValue({});
    prisma.ledgerAccount.findUnique.mockResolvedValue({ id: 'clearing-account' });
    prisma.ledgerAccount.upsert.mockResolvedValue({ id: 'available-account' });
    prisma.ledgerTransaction.create.mockResolvedValue({ id: 'reversal-ledger' });
    prisma.payoutRequest.update.mockResolvedValue({});
    const tx = {
      paymentWebhookEvent: prisma.paymentWebhookEvent,
      payoutRequest: prisma.payoutRequest,
      ledgerAccount: prisma.ledgerAccount,
      ledgerTransaction: prisma.ledgerTransaction,
      financialAuditLog: prisma.financialAuditLog,
    };
    prisma.$transaction.mockImplementation(async (callback: (client: any) => Promise<unknown>) => callback(tx));
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        status: true,
        data: { status: 'reversed', reference: 'VOXA_PAYOUT_REVERSAL', amount: 5000, currency: 'GHS' },
      }), { status: 200 }),
    );

    await expect(service.handlePaystackWebhook(body, rawBody, signature)).resolves.toEqual({
      received: true, transferEventProcessed: true,
    });

    expect(prisma.ledgerTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: 'payout-reversal:VOXA_PAYOUT_REVERSAL',
        type: 'CREATOR_PAYOUT_REVERSED', amountMinor: 5000,
        entries: { create: [
          { accountId: 'clearing-account', direction: 'DEBIT', amountMinor: 5000 },
          { accountId: 'available-account', direction: 'CREDIT', amountMinor: 5000 },
        ] },
      }),
    });
    expect(prisma.payoutRequest.update).toHaveBeenCalledWith({
      where: { id: 'payout-reversal-1' },
      data: { status: 'FAILED', failureReason: 'Paystack reversed the transfer' },
    });
  });

  it('keeps payout execution disabled unless both explicit safety flags are enabled', async () => {
    await expect(service.submitApprovedPayout('admin-1', 'payout-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.payoutRequest.findUnique).not.toHaveBeenCalled();
    expect(prisma.payoutRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.financialAuditLog.create).not.toHaveBeenCalled();
  });
});
