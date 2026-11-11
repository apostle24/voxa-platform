import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ShowsController } from './shows.controller';
import { ShowsService } from './shows.service';

@Module({
  imports: [AuthModule],
  controllers: [ShowsController],
  providers: [ShowsService],
})
export class ShowsModule {}
