import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export type AuthenticatedRequest = {
  user: { id: string; email: string; role: string };
  headers: { authorization?: string };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer access token required');
    }
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        email: string;
        role: string;
      }>(header.slice(7), {
        issuer: 'voxa-api',
        audience: 'voxa-clients',
      });
      if (!payload.sub || !payload.email) throw new Error('Invalid token payload');
      request.user = { id: payload.sub, email: payload.email, role: payload.role };
      return true;
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired');
    }
  }
}
