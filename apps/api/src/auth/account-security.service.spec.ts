import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AccountSecurityService } from './account-security.service';

describe('AccountSecurityService', () => {
  let service: AccountSecurityService;
  let prisma: any;
  let mail: any;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      emailActionToken: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
      authSession: { updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    mail = { assertReady: jest.fn(), sendAccountLink: jest.fn().mockResolvedValue(undefined) };
    prisma.$transaction.mockImplementation((callback: any) => callback(prisma));
    prisma.emailActionToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.emailActionToken.create.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
    prisma.authSession.updateMany.mockResolvedValue({ count: 1 });
    service = new AccountSecurityService(prisma, mail);
    process.env.FRONTEND_URL = 'https://voxa.example';
  });

  afterAll(() => { delete process.env.FRONTEND_URL; });

  it('does not reveal whether a password-reset email exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.requestPasswordReset(' UNKNOWN@EXAMPLE.COM ')).resolves.toEqual({ accepted: true });
    expect(mail.sendAccountLink).not.toHaveBeenCalled();
  });

  it('stores only a hash and emails a one-time password reset link', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'person@example.com' });
    await expect(service.requestPasswordReset('PERSON@example.com')).resolves.toEqual({ accepted: true });
    const token = prisma.emailActionToken.create.mock.calls[0][0].data;
    expect(token.userId).toBe('user-1');
    expect(token.purpose).toBe('RESET_PASSWORD');
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.tokenHash).not.toBe(prisma.emailActionToken.create.mock.calls[0][0].data.rawToken);
    expect(mail.sendAccountLink).toHaveBeenCalledWith('person@example.com', expect.any(String), expect.any(String), expect.stringContaining('/reset-password?token='));
  });

  it('consumes a reset token, changes the password and revokes every active session', async () => {
    prisma.emailActionToken.findUnique.mockResolvedValue({
      id: 'token-1', userId: 'user-1', purpose: 'RESET_PASSWORD', consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.resetPassword('raw-token-value', 'New-strong-password-123')).resolves.toEqual({ passwordReset: true });
    const updated = prisma.user.update.mock.calls[0][0].data.passwordHash;
    await expect(bcrypt.compare('New-strong-password-123', updated)).resolves.toBe(true);
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null }, data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects an already consumed or expired reset token', async () => {
    prisma.emailActionToken.findUnique.mockResolvedValue({
      id: 'token-1', userId: 'user-1', purpose: 'RESET_PASSWORD', consumedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.resetPassword('raw-token-value', 'New-strong-password-123')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not change the password if another request consumed the token first', async () => {
    prisma.emailActionToken.findUnique.mockResolvedValue({
      id: 'token-1', userId: 'user-1', purpose: 'RESET_PASSWORD', consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.emailActionToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.resetPassword('raw-token-value', 'New-strong-password-123')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
