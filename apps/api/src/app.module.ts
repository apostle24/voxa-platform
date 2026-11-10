import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MediaModule } from './media/media.module';
import { AuthModule } from './auth/auth.module';
import { CatalogController } from './catalog.controller';
import { CreatorsModule } from './creators/creators.module';
import { LiveModule } from './live/live.module';
import { ShowsModule } from './shows/shows.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, CreatorsModule, ShowsModule, MediaModule, LiveModule],
  controllers: [HealthController, CatalogController],
})
export class AppModule {}
