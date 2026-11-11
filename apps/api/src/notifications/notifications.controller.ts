import { Body, Controller, Get, Param, Patch, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { NotificationRealtimeService } from './notification-realtime.service';

class UpdateNotificationPreferencesDto {
  @IsOptional() @IsBoolean() follows?: boolean;
  @IsOptional() @IsBoolean() comments?: boolean;
  @IsOptional() @IsBoolean() community?: boolean;
  @IsOptional() @IsBoolean() liveInvitations?: boolean;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService, private readonly realtime: NotificationRealtimeService) {}

  @Sse('stream')
  stream(@Req() req: AuthenticatedRequest) {
    return this.realtime.stream(req.user.id);
  }

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query('unreadOnly') unreadOnly?: string) {
    return this.notifications.list(req.user.id, unreadOnly === 'true');
  }

  @Get('preferences')
  getPreferences(@Req() req: AuthenticatedRequest) {
    return this.notifications.getPreferences(req.user.id);
  }

  @Patch('preferences')
  updatePreferences(@Req() req: AuthenticatedRequest, @Body() input: UpdateNotificationPreferencesDto) {
    return this.notifications.updatePreferences(req.user.id, input);
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
