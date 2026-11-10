import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query('unreadOnly') unreadOnly?: string) {
    return this.notifications.list(req.user.id, unreadOnly === 'true');
  }

  @Patch('read-all')
  markAllRead(@Req() req: AuthenticatedRequest) {
    return this.notifications.markAllRead(req.user.id);
  }

  @Patch(':notificationId/read')
  markRead(@Req() req: AuthenticatedRequest, @Param('notificationId') notificationId: string) {
    return this.notifications.markRead(req.user.id, notificationId);
  }
}