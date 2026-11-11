import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard account enforcement', () => {
  const request: any = { headers: { authorization: 'Bearer valid-token' } };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  let jwt: { verifyAsync: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    request.user = undefined;
    jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', email: 'user@example.com', role: 'LISTENER' }) };
    prisma = { user: { findUnique: jest.fn() } };
    guard = new JwtAuthGuard(jwt as unknown as JwtService, prisma as unknown as PrismaService);
  });

  it('allows active accounts and uses their current role', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'CREATOR', suspendedUntil: null, suspensionReason: null });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'user@example.com', role: 'CREATOR' });
  });

  it('rejects accounts while suspension is active', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'LISTENER', suspendedUntil: new Date(Date.now() + 60_000), suspensionReason: 'Repeated abuse' });
    await expect(guard.canActivate(context)).rejects.toThrow('temporarily suspended');
  });

  it('rejects accounts that no longer exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(context)).rejects.toThrow('Account no longer exists');
  });
});
