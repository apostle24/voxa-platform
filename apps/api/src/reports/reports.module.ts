import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { LiveModule } from '../live/live.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, LiveModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
