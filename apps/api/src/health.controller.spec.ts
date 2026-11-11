import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    controller = new HealthController(prisma as unknown as PrismaService);
  });

  it('reports liveness without claiming dependency readiness', () => {
    const result = controller.getLiveness();

    expect(result.service).toBe('voxa-api');
    expect(result.status).toBe('ok');
    expect(result.check).toBe('liveness');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('reports ready when the database responds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const result = await controller.getReadiness();

    expect(result.status).toBe('ready');
    expect(result.checks.database).toBe('ok');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns service unavailable when the database cannot be reached', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('database unavailable'));

    await expect(controller.getReadiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
