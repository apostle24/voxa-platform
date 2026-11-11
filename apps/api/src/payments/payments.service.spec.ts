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
      payoutRequest: { findUnique: jest.fn(), updateMany: jest.fn() },
      financialAuditLog: { create: jest.fn() },
      paymentAttempt: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
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

  it('keeps payout execution disabled unless both explicit safety flags are enabled', async () => {
    await expect(service.submitApprovedPayout('admin-1', 'payout-1'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.payoutRequest.findUnique).not.toHaveBeenCalled();
    expect(prisma.payoutRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.financialAuditLog.create).not.toHaveBeenCalled();
  });
});
