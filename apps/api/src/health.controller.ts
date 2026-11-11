import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Liveness only confirms that the API process can answer HTTP requests.
  @Get()
  getLiveness() {
    return {
      service: 'voxa-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      check: 'liveness',
    };
  }

  // Readiness confirms the API can reach its primary database dependency.
  @Get('ready')
  async getReadiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        service: 'voxa-api',
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks: { database: 'ok' },
      };
    } catch {
      throw new ServiceUnavailableException({
        service: 'voxa-api',
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        checks: { database: 'unavailable' },
      });
    }
  }
}
