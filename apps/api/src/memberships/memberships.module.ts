import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

@Module({
  imports: [JwtModule.register({
    secret: process.env.JWT_SECRET,
    signOptions: { issuer: 'voxa-api', audience: 'voxa-clients' },
  })],
  controllers: [MembershipsController],
  providers: [MembershipsService, JwtAuthGuard],
  exports: [MembershipsService],
})
export class MembershipsModule {}
