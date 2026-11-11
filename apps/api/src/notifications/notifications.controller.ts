import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { NotificationRealtimeService } from './notification-realtime.service';

class RegisterNotificationDeviceDto {
  @IsString() @MaxLength(512) expoPushToken!: string;
  @IsIn(['ios', 'android']) platform!: 'ios' | 'android';
  @IsOptional() @IsString() @MaxLength(160) deviceName?: string;
}

class UnregisterNotificationDeviceDto {
  @IsString() @MaxLength(512) expoPushToken!: string;
}

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

  @Post('devices')
  registerDevice(@Req() req: AuthenticatedRequest, @Body() input: RegisterNotificationDeviceDto) {
    return this.notifications.registerDevice(req.user.id, input);
  }

  @Delete('devices')
  unregisterDevice(@Req() req: AuthenticatedRequest, @Body() input: UnregisterNotificationDeviceDto) {
    return this.notifications.unregisterDevice(req.user.id, input.expoPushToken);
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
