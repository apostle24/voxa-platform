import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters-long';
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      authSession: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    jwt = {
      signAsync: jest.fn().mockImplementation((_payload: unknown, options?: unknown) => Promise.resolve(options ? 'signed-refresh-token' : 'signed-access-token')),
      verifyAsync: jest.fn(),
    };
    prisma.authSession.create.mockResolvedValue({});
    service = new AuthService(prisma as PrismaService, jwt as unknown as JwtService);
  });

  afterAll(() => { delete process.env.JWT_SECRET; });

  it('returns only the authenticated account profile fields', async () => {
    const profile = { id: 'user-10', email: 'listener@example.com', displayName: 'Listener', role: 'LISTENER', createdAt: new Date(), creator: null };
    prisma.user.findUnique.mockResolvedValue(profile);
    await expect(service.getMyProfile('user-10')).resolves.toEqual(profile);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-10' },
      select: { id: true, email: true, displayName: true, role: true, createdAt: true, creator: { select: { handle: true } } },
    });
  });

  it('normalizes and persists the account display name', async () => {
    prisma.user.update.mockResolvedValue({ id: 'user-10', email: 'listener@example.com', displayName: 'Joshua Manyikina', role: 'LISTENER' });
    await expect(service.updateMyProfile('user-10', '  Joshua   Manyikina  ')).resolves.toMatchObject({ displayName: 'Joshua Manyikina' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-10' }, data: { displayName: 'Joshua Manyikina' },
      select: { id: true, email: true, displayName: true, role: true },
    });
  });

  it('rejects a display name that is blank after trimming', async () => {
    await expect(service.updateMyProfile('user-10', '   ')).rejects.toThrow('Display name must be between 2 and 80 characters');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('normalizes email, hashes the password, persists a refresh session, and returns a short-lived access token', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }: any) => ({
      id: 'user-1', email: data.email, displayName: data.displayName, role: 'LISTENER',
    }));

    const result = await service.register({
      email: '  PERSON@Example.COM ',
      password: 'A-strong-test-password-123',
      displayName: '  Listener One  ',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'person@example.com' }, select: { id: true },
    });
    const created = prisma.user.create.mock.calls[0][0].data;
    expect(created.email).toBe('person@example.com');
    expect(created.displayName).toBe('Listener One');
    await expect(bcrypt.compare('A-strong-test-password-123', created.passwordHash)).resolves.toBe(true);
    expect(result).toMatchObject({ accessToken: 'signed-access-token', tokenType: 'Bearer', expiresIn: 900, user: { id: 'user-1' } });
    expect(prisma.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', tokenHash: expect.any(String), expiresAt: expect.any(Date) }),
    });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'user-1', email: 'person@example.com', role: 'LISTENER' });
    expect(result).toHaveProperty('refreshToken', 'signed-refresh-token');
  });

  it('rejects registration when the email is already in use', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
    await expect(service.register({
      email: 'person@example.com', password: 'A-strong-test-password-123', displayName: 'Listener',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('returns the same generic error for an unknown email and a wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login({ email: 'missing@example.com', password: 'wrong-password' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('authenticates a valid password and normalizes the login email', async () => {
    const passwordHash = await bcrypt.hash('Correct-password-123', 4);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2', email: 'person@example.com', displayName: 'Listener Two', passwordHash, role: 'LISTENER',
    });
    const result = await service.login({ email: ' PERSON@EXAMPLE.COM ', password: 'Correct-password-123' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'person@example.com' } });
    expect(result.user).toMatchObject({ id: 'user-2', email: 'person@example.com', role: 'LISTENER' });
    expect(prisma.authSession.create).toHaveBeenCalled();
  });

  it('rejects a wrong password without issuing a token or creating a session', async () => {
    const passwordHash = await bcrypt.hash('Correct-password-123', 4);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-3', email: 'person@example.com', displayName: 'Listener Three', passwordHash, role: 'LISTENER',
    });
    await expect(service.login({ email: 'person@example.com', password: 'incorrect-password' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(prisma.authSession.create).not.toHaveBeenCalled();
  });

  it('rotates a valid refresh session atomically and invalidates the old token', async () => {
    const session = {
      id: 'session-old', userId: 'user-4', tokenHash: expect.any(String),
      expiresAt: new Date(Date.now() + 60_000), revokedAt: null,
      user: { id: 'user-4', email: 'user@example.com', displayName: 'User Four', role: 'LISTENER' },
    };
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-4', jti: 'session-old', typ: 'refresh' });
    prisma.authSession.findUnique.mockResolvedValue(session);
    const tx = {
      authSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));

    const result = await service.refresh('old-refresh-token');

    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-old', tokenHash: expect.any(String), revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { revokedAt: expect.any(Date), replacedById: expect.any(String), lastUsedAt: expect.any(Date) },
    });
    expect(tx.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-4', tokenHash: expect.any(String), expiresAt: expect.any(Date) }),
    });
    expect(result).toMatchObject({ accessToken: 'signed-access-token', user: { id: 'user-4' }, expiresIn: 900 });
    expect(result).toHaveProperty('refreshToken', 'signed-refresh-token');
  });

  it('rejects refresh-token replay when another request already rotated it', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-4', jti: 'session-old', typ: 'refresh' });
    prisma.authSession.findUnique.mockResolvedValue({
      id: 'session-old', userId: 'user-4', expiresAt: new Date(Date.now() + 60_000), revokedAt: null,
      user: { id: 'user-4', email: 'user@example.com', displayName: 'User Four', role: 'LISTENER' },
    });
    const tx = { authSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn() } };
    prisma.$transaction.mockImplementation((callback: any) => callback(tx));
    await expect(service.refresh('replayed-refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.authSession.create).not.toHaveBeenCalled();
  });

  it('rejects refresh tokens with the wrong token type', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-4', jti: 'session-old', typ: 'access' });
    await expect(service.refresh('wrong-kind-token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.authSession.findUnique).not.toHaveBeenCalled();
  });

  it('revokes every active session for the user on logout-all', async () => {
    prisma.authSession.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.logoutAll('user-4')).resolves.toEqual({ success: true });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-4', revokedAt: null }, data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokes the current refresh session on logout', async () => {
    prisma.authSession.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.logout('refresh-token')).resolves.toEqual({ success: true });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
