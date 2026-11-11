import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateReportDto } from './dto/create-report.dto';
import { ModerationActionDto, ReviewReportDto } from './dto/review-report.dto';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('reports')
  @UseGuards(JwtAuthGuard)
  create(@Req() req: AuthenticatedRequest, @Body() input: CreateReportDto) {
    return this.reports.create(req.user.id, input);
  }

  @Get('admin/reports')
  @UseGuards(JwtAuthGuard)
  list(@Req() req: AuthenticatedRequest, @Query('status') status?: 'NEW' | 'REVIEWING' | 'ACTIONED' | 'DISMISSED') {
    return this.reports.listForModeration(req.user.id, status);
  }

  @Patch('admin/reports/:reportId')
  @UseGuards(JwtAuthGuard)
  review(@Req() req: AuthenticatedRequest, @Param('reportId') reportId: string, @Body() input: ReviewReportDto) {
    return this.reports.review(req.user.id, reportId, input);
  }
  @Post('admin/reports/:reportId/actions')
  @UseGuards(JwtAuthGuard)
  applyAction(@Req() req: AuthenticatedRequest, @Param('reportId') reportId: string, @Body() input: ModerationActionDto) {
    return this.reports.applyContentAction(req.user.id, reportId, { action: input.action, reason: input.moderatorNote });
  }
}
