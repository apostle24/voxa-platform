import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailDeliveryService } from './email-delivery.service';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AccountSecurityService {
  constructor(private readonly prisma: PrismaService, private readonly mail: EmailDeliveryService) {}

  async requestEmailVerification(emailInput: string) {
    this.mail.assertReady();
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, email: true, emailVerifiedAt: true } });
    if (!user || user.emailVerifiedAt) return { accepted: true };
    const raw = await this.issueToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    const url = this.frontendUrl('/verify-email#token=' + encodeURIComponent(raw));
    await this.mail.sendAccountLink(user.email, 'Verify your VOXA email', 'Use this link to verify your email. It expires in 24 hours.', url);
    return { accepted: true };
  }

  async confirmEmailVerification(rawToken: string) {
    const tokenHash = hash(rawToken);
    const token = await this.prisma.emailActionToken.findUnique({ where: { tokenHash } });
    const now = new Date();
    if (!token || token.purpose !== 'VERIFY_EMAIL' || token.consumedAt || token.expiresAt <= now) {
      throw new UnauthorizedException('Verification link is invalid or expired');
    }
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailActionToken.updateMany({
        where: { id: token.id, purpose: 'VERIFY_EMAIL', consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new UnauthorizedException('Verification link is invalid or expired');
      await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: now } });
      await tx.emailActionToken.updateMany({ where: { userId: token.userId, purpose: 'VERIFY_EMAIL', consumedAt: null }, data: { consumedAt: now } });
    });
    return { verified: true };
  }

  async requestPasswordReset(emailInput: string) {
    this.mail.assertReady();
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (!user) return { accepted: true };
    const raw = await this.issueToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);
    const url = this.frontendUrl('/reset-password?token=' + encodeURIComponent(raw));
    await this.mail.sendAccountLink(user.email, 'Reset your VOXA password', 'Use this link to choose a new password. It expires in 30 minutes.', url);
    return { accepted: true };
  }

  async resetPassword(rawToken: string, password: string) {
    const tokenHash = hash(rawToken);
    const token = await this.prisma.emailActionToken.findUnique({ where: { tokenHash } });
    const now = new Date();
    if (!token || token.purpose !== 'RESET_PASSWORD' || token.consumedAt || token.expiresAt <= now) {
      throw new UnauthorizedException('Password reset link is invalid or expired');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailActionToken.updateMany({
        where: { id: token.id, purpose: 'RESET_PASSWORD', consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new UnauthorizedException('Password reset link is invalid or expired');
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.authSession.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.emailActionToken.updateMany({ where: { userId: token.userId, purpose: 'RESET_PASSWORD', consumedAt: null }, data: { consumedAt: now } });
    });
    return { passwordReset: true };
  }

  private async issueToken(userId: string, purpose: string, ttlMs: number) {
    const raw = randomBytes(32).toString('hex');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.emailActionToken.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: now } });
      await tx.emailActionToken.create({ data: { userId, purpose, tokenHash: hash(raw), expiresAt: new Date(now.getTime() + ttlMs) } });
    });
    return raw;
  }

  private frontendUrl(path: string) {
    const base = process.env.FRONTEND_URL || 'http://localhost:3001';
    return new URL(path, base).toString();
  }
}
