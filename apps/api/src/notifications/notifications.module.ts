import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [JwtModule.register({
    secret: process.env.JWT_SECRET,
    signOptions: { issuer: 'voxa-api', audience: 'voxa-clients' },
  })],
  controllers: [NotificationsController],
  providers: [NotificationsService, JwtAuthGuard],
})
export class NotificationsModule {}