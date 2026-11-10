import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CreatorsController } from './creators.controller';
import { CreatorsService } from './creators.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { issuer: 'voxa-api', audience: 'voxa-clients' },
    }),
  ],
  controllers: [CreatorsController],
  providers: [CreatorsService, JwtAuthGuard],
})
export class CreatorsModule {}
