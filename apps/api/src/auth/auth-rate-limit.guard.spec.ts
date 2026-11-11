import { ExecutionContext, TooManyRequestsException } from '@nestjs/common';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

describe('AuthRateLimitGuard', () => {
  let guard: AuthRateLimitGuard;

  const contextFor = (ip: string) => ({
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  }) as unknown as ExecutionContext;

  beforeEach(() => {
    AuthRateLimitGuard.resetForTests();
    guard = new AuthRateLimitGuard();
  });

  it('allows the first ten authentication attempts from one IP', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(guard.canActivate(contextFor('203.0.113.10'))).toBe(true);
    }
  });

  it('blocks the eleventh attempt from the same IP', () => {
    for (let i = 0; i < 10; i += 1) guard.canActivate(contextFor('203.0.113.10'));
    expect(() => guard.canActivate(contextFor('203.0.113.10'))).toThrow(TooManyRequestsException);
  });

  it('tracks different source IPs independently', () => {
    for (let i = 0; i < 10; i += 1) guard.canActivate(contextFor('203.0.113.10'));
    expect(guard.canActivate(contextFor('203.0.113.11'))).toBe(true);
  });
});
