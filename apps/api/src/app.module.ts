import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { CatalogController } from './catalog.controller';

@Module({
  controllers: [HealthController, CatalogController],
})
export class AppModule {}
