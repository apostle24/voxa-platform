import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { MfaService } from './mfa.service';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TTL_SECONDS = REFRESH_TTL_MS / 1000;
const TOKEN_ISSUER = 'voxa-api';
const TOKEN_AUDIENCE = 'voxa-clients';

type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mfa: MfaService,
  ) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must be configured with at least 32 characters');
    }
  }

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email is already registered');

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        displayName: input.displayName.trim(),
        passwordHash,
      },
      select: { id: true, email: true, displayName: true, role: true },
    });
    return { verificationRequired: true, user };
  }

  async login(input: LoginDto) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.emailVerifiedAt === null) {
      throw new UnauthorizedException('Please verify your email before signing in');
    }
    if (await this.mfa.isEnabled(user.id)) return this.mfa.createLoginChallenge(user.id);
    return this.issueTokens({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    });
  }

  async issueAuthenticatedSession(user: AuthUser) {
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException('Refresh session is missing');

    let claims: { sub?: string; jti?: string; typ?: string };
    try {
      claims = await this.jwt.verifyAsync(refreshToken, {
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Refresh session is invalid or expired');
    }

    if (!claims.sub || !claims.jti || claims.typ !== 'refresh') {
      throw new UnauthorizedException('Refresh session is invalid');
    }

    const tokenHash = this.hashToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, displayName: true, role: true, emailVerifiedAt: true } } },
    });
    const now = new Date();
    if (session?.user.emailVerifiedAt === null) throw new UnauthorizedException('Please verify your email before signing in');
    if (!session || session.userId !== claims.sub || session.id !== claims.jti || session.revokedAt || session.expiresAt <= now) {
      throw new UnauthorizedException('Refresh session is invalid or expired');
    }

    const next = await this.createRefreshToken(session.user);
    const rotated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.authSession.updateMany({
        where: { id: session.id, tokenHash, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now, replacedById: next.sessionId, lastUsedAt: now },
      });
      if (result.count !== 1) return false;
      await tx.authSession.create({
        data: {
          id: next.sessionId,
          userId: session.userId,
          tokenHash: next.tokenHash,
          expiresAt: next.expiresAt,
        },
      });
      return true;
    });

    if (!rotated) throw new UnauthorizedException('Refresh session has already been used');
    return {
      ...(await this.issueAccessToken(session.user)),
      refreshToken: next.refreshToken,
      user: session.user,
    };
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.authSession.updateMany({
        where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true };
  }

  async logoutAll(userId: string) {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  private async issueTokens(user: AuthUser) {
    const access = await this.issueAccessToken(user);
    const refresh = await this.createRefreshToken(user);
    await this.prisma.authSession.create({
      data: {
        id: refresh.sessionId,
        userId: user.id,
        tokenHash: refresh.tokenHash,
        expiresAt: refresh.expiresAt,
      },
    });
    return {
      ...access,
      refreshToken: refresh.refreshToken,
      tokenType: 'Bearer',
      user,
    };
  }

  private async issueAccessToken(user: AuthUser) {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return { accessToken, tokenType: 'Bearer', expiresIn: 900 };
  }

  private async createRefreshToken(user: AuthUser) {
    const sessionId = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, typ: 'refresh' },
      {
        expiresIn: REFRESH_TTL_SECONDS,
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        jwtid: sessionId,
      },
    );
    return {
      sessionId,
      refreshToken,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
