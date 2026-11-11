import { CanActivate, ExecutionContext, Injectable, TooManyRequestsException } from '@nestjs/common';

type AuthRequest = {
  ip?: string;
  socket?: { remoteAddress?: string };
};

type AttemptWindow = { count: number; resetAt: number };

/**
 * Process-local emergency protection for public authentication endpoints.
 * Production deployments with multiple API replicas should additionally enforce
 * a shared rate limit at the ingress/API gateway.
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private static readonly attempts = new Map<string, AttemptWindow>();
  private static readonly windowMs = 15 * 60 * 1000;
  private static readonly maxAttempts = 10;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    const key = ip;
    const now = Date.now();
    let window = AuthRateLimitGuard.attempts.get(key);

    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + AuthRateLimitGuard.windowMs };
      AuthRateLimitGuard.attempts.set(key, window);
    }

    window.count += 1;
    if (window.count > AuthRateLimitGuard.maxAttempts) {
      throw new TooManyRequestsException('Too many authentication attempts. Try again in 15 minutes.');
    }

    // Bound memory if the process receives a large number of distinct source IPs.
    if (AuthRateLimitGuard.attempts.size > 10_000) {
      for (const [entryKey, entry] of AuthRateLimitGuard.attempts) {
        if (entry.resetAt <= now) AuthRateLimitGuard.attempts.delete(entryKey);
      }
    }
    return true;
  }

  static resetForTests() {
    AuthRateLimitGuard.attempts.clear();
  }
}
