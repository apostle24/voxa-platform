import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AccountSecurityService } from './account-security.service';
import { EmailDeliveryService } from './email-delivery.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '15m', issuer: 'voxa-api', audience: 'voxa-clients' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthRateLimitGuard, JwtAuthGuard, AccountSecurityService, EmailDeliveryService],
  exports: [AuthService],
})
export class AuthModule {}
