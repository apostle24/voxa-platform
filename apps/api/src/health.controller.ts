import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return {
      service: 'voxa-api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      readiness: 'foundation-only',
    };
  }
}
