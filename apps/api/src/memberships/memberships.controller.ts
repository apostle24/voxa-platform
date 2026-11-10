import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMembershipPlanDto } from './dto/create-membership-plan.dto';
import { UpdateMembershipPlanDto } from './dto/update-membership-plan.dto';
import { MembershipsService } from './memberships.service';

@Controller()
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get('creators/me/membership-plans')
  @UseGuards(JwtAuthGuard)
  myPlans(@Req() req: AuthenticatedRequest) {
    return this.memberships.myPlans(req.user.id);
  }

  @Get('creators/:handle/membership-plans')
  listPublicPlans(@Param('handle') handle: string) {
    return this.memberships.listPublicPlans(handle);
  }

  @Post('creators/me/membership-plans')
  @UseGuards(JwtAuthGuard)
  createPlan(@Req() req: AuthenticatedRequest, @Body() input: CreateMembershipPlanDto) {
    return this.memberships.createPlan(req.user.id, input);
  }

  @Patch('creators/me/membership-plans/:planId')
  @UseGuards(JwtAuthGuard)
  updatePlan(@Req() req: AuthenticatedRequest, @Param('planId') planId: string, @Body() input: UpdateMembershipPlanDto) {
    return this.memberships.updatePlan(req.user.id, planId, input);
  }

  @Get('me/memberships')
  @UseGuards(JwtAuthGuard)
  myMemberships(@Req() req: AuthenticatedRequest) {
    return this.memberships.myMemberships(req.user.id);
  }

  @Get('creators/me/memberships')
  @UseGuards(JwtAuthGuard)
  creatorMemberships(@Req() req: AuthenticatedRequest) {
    return this.memberships.creatorMemberships(req.user.id);
  }
}
