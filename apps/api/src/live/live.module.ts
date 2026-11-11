import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';

@Module({
  imports: [ConfigModule, JwtModule.register({
    secret: process.env.JWT_SECRET,
    signOptions: { issuer: 'voxa-api', audience: 'voxa-clients' },
  })],
  controllers: [LiveController],
  providers: [LiveService, JwtAuthGuard],
  exports: [LiveService],
})
export class LiveModule {}
