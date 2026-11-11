import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CommunitiesController } from './communities.controller';
import { CommunitiesService } from './communities.service';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { issuer: 'voxa-api', audience: 'voxa-clients' } })],
  controllers: [CommunitiesController],
  providers: [CommunitiesService, JwtAuthGuard],
})
export class CommunitiesModule {}