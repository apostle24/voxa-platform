import { Body, Controller, ForbiddenException, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMembershipCheckoutDto } from './dto/create-membership-checkout.dto';
import { CreatePayoutDestinationDto } from './dto/create-payout-destination.dto';
import { CreatePayoutRequestDto } from './dto/create-payout-request.dto';
import { VerifyPayoutDestinationDto } from './dto/verify-payout-destination.dto';
import { AdminPayoutActionDto } from './dto/admin-payout-action.dto';
import { PaymentsService } from './payments.service';

type WebhookRequest = {
  rawBody?: Buffer;
};

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('memberships/checkout')
  @UseGuards(JwtAuthGuard)
  createMembershipCheckout(@Req() req: AuthenticatedRequest, @Body() input: CreateMembershipCheckoutDto) {
    return this.payments.createMembershipCheckout(req.user.id, input.planId);
  }

  @Get('creators/me/payout-destinations')
  @UseGuards(JwtAuthGuard)
  payoutDestinations(@Req() req: AuthenticatedRequest) {
    return this.payments.listPayoutDestinations(req.user.id);
  }

  @Patch('creators/me/payout-destinations/:destinationId/default')
  @UseGuards(JwtAuthGuard)
  setDefaultPayoutDestination(@Req() req: AuthenticatedRequest, @Param('destinationId') destinationId: string) {
    return this.payments.setDefaultPayoutDestination(req.user.id, destinationId);
  }

  @Post('creators/me/payout-destinations')
  @UseGuards(JwtAuthGuard)
  createPayoutDestination(@Req() req: AuthenticatedRequest, @Body() input: CreatePayoutDestinationDto) {
    return this.payments.createPayoutDestination(req.user.id, input);
  }


  @Post('creators/me/payout-requests')
  @UseGuards(JwtAuthGuard)
  createPayoutRequest(
    @Req() req: AuthenticatedRequest,
    @Body() input: CreatePayoutRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.payments.createPayoutRequest(req.user.id, input.destinationId, input.amountMinor, idempotencyKey);
  }

  @Get('creators/me/payout-requests')
  @UseGuards(JwtAuthGuard)
  payoutRequests(@Req() req: AuthenticatedRequest) {
    return this.payments.getCreatorPayoutRequests(req.user.id);
  }

  @Get('creators/me/earnings')
  @UseGuards(JwtAuthGuard)
  creatorEarnings(@Req() req: AuthenticatedRequest) {
    return this.payments.getCreatorEarnings(req.user.id);
  }

  @Get('me/payments/:reference')
  @UseGuards(JwtAuthGuard)
  myPaymentAttempt(@Req() req: AuthenticatedRequest, @Param('reference') reference: string) {
    return this.payments.getMyPaymentAttempt(req.user.id, reference);
  }

  @Get('me/payments')
  @UseGuards(JwtAuthGuard)
  myPaymentHistory(@Req() req: AuthenticatedRequest) {
    return this.payments.getMyPaymentHistory(req.user.id);
  }


  @Get('admin/finance/overview')
  @UseGuards(JwtAuthGuard)
  adminFinanceOverview(@Req() req: AuthenticatedRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Administrator access required');
    return this.payments.getAdminFinanceOverview();
  }

  @Get('admin/finance/payout-destinations/pending')
  @UseGuards(JwtAuthGuard)
  adminPendingPayoutDestinations(@Req() req: AuthenticatedRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Administrator access required');
    return this.payments.listAdminPayoutDestinations();
  }

  @Patch('admin/finance/payout-destinations/:destinationId/verify')
  @UseGuards(JwtAuthGuard)
  adminVerifyPayoutDestination(@Req() req: AuthenticatedRequest, @Param('destinationId') destinationId: string, @Body() input: VerifyPayoutDestinationDto) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Administrator access required');
    return this.payments.verifyPayoutDestination(req.user.id, destinationId, input);
  }

  @Get('admin/finance/payout-requests')
  @UseGuards(JwtAuthGuard)
  adminPayoutRequests(@Req() req: AuthenticatedRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Administrator access required');
    return this.payments.listAdminPayoutRequests();
  }

  @Patch('admin/finance/payout-requests/:payoutRequestId/review')
  @UseGuards(JwtAuthGuard)
  adminMarkPayoutUnderReview(@Req() req: AuthenticatedRequest, @Param('payoutRequestId') payoutRequestId: string) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Administrator access required');
    return this.payments.markPayoutRequestUnderReview(req.user.id, payoutRequestId);
  }

  @Patch('admin/finance/payout-requests/:payoutRequestId/approve')
  @UseGuards(JwtAuthGuard)
  adminApprovePayout(@Req() req: AuthenticatedRequest, @Param('payoutRequestId') payoutRequestId: string, @Body() input: AdminPayoutActionDto) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Administrator access required');
    return this.payments.approvePayoutRequest(req.user.id, payoutRequestId, input.reason);
  }

  @Post('admin/finance/payout-requests/:payoutRequestId/submit')
  @UseGuards(JwtAuthGuard)
  adminSubmitPayout(@Req() req: AuthenticatedRequest, @Param('payoutRequestId') payoutRequestId: string) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Administrator access required');
    return this.payments.submitApprovedPayout(req.user.id, payoutRequestId);
  }

  @Post('admin/finance/payout-requests/:payoutRequestId/reconcile')
  @UseGuards(JwtAuthGuard)
  adminReconcilePayout(@Req() req: AuthenticatedRequest, @Param('payoutRequestId') payoutRequestId: string) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Administrator access required');
    return this.payments.reconcilePayoutTransfer(req.user.id, payoutRequestId);
  }

  @Post('webhooks/paystack')
  paystackWebhook(
    @Req() req: WebhookRequest,
    @Body() body: { event?: string; data?: Record<string, unknown> & { reference?: string } },
    @Headers('x-paystack-signature') signature: string | string[] | undefined,
  ) {
    return this.payments.handlePaystackWebhook(body, req.rawBody, signature);
  }
}
