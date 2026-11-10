import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CatalogController } from './catalog.controller';
import { CreatorsModule } from './creators/creators.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, AuthModule, CreatorsModule],
  controllers: [HealthController, CatalogController],
})
export class AppModule {}
