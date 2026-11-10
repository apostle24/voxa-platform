import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [ConfigModule, JwtModule.register({
    secret: process.env.JWT_SECRET,
    signOptions: { issuer: 'voxa-api', audience: 'voxa-clients' },
  })],
  controllers: [MediaController],
  providers: [MediaService, JwtAuthGuard],
})
export class MediaModule {}