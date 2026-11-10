import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ShowsController } from './shows.controller';
import { ShowsService } from './shows.service';

@Module({
  imports: [JwtModule.register({
    secret: process.env.JWT_SECRET,
    signOptions: { issuer: 'voxa-api', audience: 'voxa-clients' },
  })],
  controllers: [ShowsController],
  providers: [ShowsService, JwtAuthGuard],
})
export class ShowsModule {}
