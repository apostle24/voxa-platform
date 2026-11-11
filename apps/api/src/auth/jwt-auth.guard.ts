import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

export type AuthenticatedRequest = {
  user: { id: string; email: string; role: string };
  headers: { authorization?: string };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Bearer access token required');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(header.slice(7), {
        issuer: 'voxa-api', audience: 'voxa-clients',
      });
      if (!payload.sub || !payload.email) throw new Error('Invalid token payload');
      const account = await this.prisma.user.findUnique({
        where: { id: payload.sub }, select: { id: true, suspendedUntil: true, suspensionReason: true, role: true },
      });
      if (!account) throw new UnauthorizedException('Account no longer exists');
      if (account.suspendedUntil && account.suspendedUntil > new Date()) {
        throw new UnauthorizedException('This account is temporarily suspended. ' + (account.suspensionReason || 'Contact VOXA support for assistance.'));
      }
      request.user = { id: payload.sub, email: payload.email, role: account.role };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Access token is invalid or expired');
    }
  }
}
