import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { LiveModule } from '../live/live.module';

@Module({
  imports: [LiveModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
