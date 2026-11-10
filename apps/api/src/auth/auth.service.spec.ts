import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };
  let jwt: { signAsync: jest.Mock };

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters-long';
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed-access-token') };
    service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('normalizes email, hashes the password, and returns a short-lived access token', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data, select }: any) => ({
      id: 'user-1',
      email: data.email,
      displayName: data.displayName,
      role: 'LISTENER',
    }));

    const result = await service.register({
      email: '  PERSON@Example.COM ',
      password: 'A-strong-test-password-123',
      displayName: '  Listener One  ',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'person@example.com' },
      select: { id: true },
    });
    const created = prisma.user.create.mock.calls[0][0].data;
    expect(created.email).toBe('person@example.com');
    expect(created.displayName).toBe('Listener One');
    expect(created.passwordHash).not.toBe('A-strong-test-password-123');
    await expect(bcrypt.compare('A-strong-test-password-123', created.passwordHash)).resolves.toBe(true);
    expect(result).toMatchObject({ accessToken: 'signed-access-token', tokenType: 'Bearer', expiresIn: 900 });
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'person@example.com',
      role: 'LISTENER',
    });
  });

  it('rejects registration when the email is already in use', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });
    await expect(service.register({
      email: 'person@example.com',
      password: 'A-strong-test-password-123',
      displayName: 'Listener',
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
      id: 'user-2',
      email: 'person@example.com',
      displayName: 'Listener Two',
      passwordHash,
      role: 'LISTENER',
    });

    const result = await service.login({
      email: ' PERSON@EXAMPLE.COM ',
      password: 'Correct-password-123',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'person@example.com' } });
    expect(result.user).toMatchObject({ id: 'user-2', email: 'person@example.com', role: 'LISTENER' });
    expect(jwt.signAsync).toHaveBeenCalled();
  });

  it('rejects a wrong password without issuing a token', async () => {
    const passwordHash = await bcrypt.hash('Correct-password-123', 4);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-3',
      email: 'person@example.com',
      displayName: 'Listener Three',
      passwordHash,
      role: 'LISTENER',
    });

    await expect(service.login({
      email: 'person@example.com',
      password: 'incorrect-password',
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
});
