import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMembershipCheckoutDto } from './dto/create-membership-checkout.dto';
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

  @Post('webhooks/paystack')
  paystackWebhook(
    @Req() req: WebhookRequest,
    @Body() body: { event?: string; data?: { reference?: string } },
    @Headers('x-paystack-signature') signature: string | string[] | undefined,
  ) {
    return this.payments.handlePaystackWebhook(body, req.rawBody, signature);
  }
}
