import { ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MfaService } from './mfa.service';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function decodeBase32(input: string) {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const char of input) {
    value = (value << 5) | BASE32.indexOf(char); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
function totp(secret: string, at = Date.now()) {
  const counter = Math.floor(at / 30_000);
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('MfaService', () => {
  let service: MfaService;
  let prisma: any;
  const key = Buffer.alloc(32, 7).toString('base64');

  beforeEach(() => {
    process.env.MFA_ENCRYPTION_KEY = key;
    prisma = {
      mfaCredential: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), delete: jest.fn() },
      mfaBackupCode: { deleteMany: jest.fn(), createMany: jest.fn(), updateMany: jest.fn() },
      mfaLoginChallenge: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
      authSession: { updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.mfaCredential.findUnique.mockResolvedValue(null);
    prisma.mfaCredential.upsert.mockImplementation(async ({ create }: any) => ({ id: 'credential-1', ...create, enabledAt: null }));
    prisma.$transaction.mockImplementation((callback: any) => callback(prisma));
    prisma.mfaCredential.update.mockResolvedValue({});
    prisma.mfaBackupCode.deleteMany.mockResolvedValue({ count: 0 });
    prisma.mfaBackupCode.createMany.mockResolvedValue({ count: 10 });
    prisma.authSession.updateMany.mockResolvedValue({ count: 2 });
    prisma.mfaLoginChallenge.create.mockImplementation(async ({ data }: any) => ({ id: 'challenge-1', ...data }));
    prisma.mfaBackupCode.updateMany.mockResolvedValue({ count: 1 });
    prisma.mfaLoginChallenge.updateMany.mockResolvedValue({ count: 1 });
    service = new MfaService(prisma as PrismaService);
  });

  afterEach(() => { delete process.env.MFA_ENCRYPTION_KEY; });

  it('refuses to create an authenticator secret when encryption is not configured', async () => {
    delete process.env.MFA_ENCRYPTION_KEY;
    await expect(service.beginSetup('user-1', 'user@example.com')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.mfaCredential.upsert).not.toHaveBeenCalled();
  });

  it('stores the authenticator secret encrypted and returns a provisioning URI', async () => {
    const result = await service.beginSetup('user-1', 'user@example.com');
    const stored = prisma.mfaCredential.upsert.mock.calls[0][0].create.encryptedSecret;
    expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    expect(result.otpauthUrl).toContain('otpauth://totp/');
    expect(result.otpauthUrl).toContain('issuer=VOXA');
    expect(stored).not.toContain(result.secret);
    expect(stored.split('.')).toHaveLength(3);
  });

  it('rejects a second setup when MFA is already enabled', async () => {
    prisma.mfaCredential.findUnique.mockResolvedValue({ enabledAt: new Date() });
    await expect(service.beginSetup('user-1', 'user@example.com')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.mfaCredential.upsert).not.toHaveBeenCalled();
  });

  it('enables MFA only after a valid TOTP and stores hashed backup codes while revoking old sessions', async () => {
    const setup = await service.beginSetup('user-1', 'user@example.com');
    const credential = { id: 'credential-1', encryptedSecret: prisma.mfaCredential.upsert.mock.calls[0][0].create.encryptedSecret, enabledAt: null };
    prisma.mfaCredential.findUnique.mockResolvedValue(credential);
    const result = await service.enable('user-1', totp(setup.secret));
    expect(result.enabled).toBe(true);
    expect(result.backupCodes).toHaveLength(10);
    expect(prisma.mfaCredential.update).toHaveBeenCalledWith({
      where: { id: 'credential-1' }, data: { enabledAt: expect.any(Date) },
    });
    const savedCodes = prisma.mfaBackupCode.createMany.mock.calls[0][0].data;
    expect(savedCodes).toHaveLength(10);
    expect(savedCodes.every((item: any) => /^[a-f0-9]{64}$/.test(item.codeHash))).toBe(true);
    expect(savedCodes.some((item: any) => result.backupCodes.includes(item.codeHash))).toBe(false);
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null }, data: { revokedAt: expect.any(Date) },
    });
  });

  it('does not enable MFA with an invalid TOTP', async () => {
    const setup = await service.beginSetup('user-1', 'user@example.com');
    prisma.mfaCredential.findUnique.mockResolvedValue({ id: 'credential-1', encryptedSecret: prisma.mfaCredential.upsert.mock.calls[0][0].create.encryptedSecret, enabledAt: null });
    await expect(service.enable('user-1', 'not-a-code')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stores only a hash of the short-lived login challenge token', async () => {
    const challenge = await service.createLoginChallenge('user-1');
    const stored = prisma.mfaLoginChallenge.create.mock.calls[0][0].data;
    expect(challenge.mfaRequired).toBe(true);
    expect(challenge.challengeToken).toHaveLength(64);
    expect(stored.tokenHash).toBe(hash(challenge.challengeToken));
    expect(stored.tokenHash).not.toBe(challenge.challengeToken);
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(4 * 60 * 1000);
  });

  it('accepts a valid TOTP once and consumes the login challenge', async () => {
    const setup = await service.beginSetup('user-1', 'user@example.com');
    const credential = { id: 'credential-1', encryptedSecret: prisma.mfaCredential.upsert.mock.calls[0][0].create.encryptedSecret, enabledAt: new Date(), backupCodes: [] };
    const challenge = await service.createLoginChallenge('user-1');
    prisma.mfaLoginChallenge.findUnique.mockResolvedValue({
      id: 'challenge-1', consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', email: 'user@example.com', displayName: 'Listener', role: 'LISTENER', mfaCredential: credential },
    });
    const user = await service.verifyLoginChallenge(challenge.challengeToken, totp(setup.secret));
    expect(user).toEqual({ id: 'user-1', email: 'user@example.com', displayName: 'Listener', role: 'LISTENER' });
    expect(prisma.mfaLoginChallenge.updateMany).toHaveBeenCalledWith({
      where: { id: 'challenge-1', consumedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('rejects an expired login challenge before verifying a code', async () => {
    const challenge = await service.createLoginChallenge('user-1');
    prisma.mfaLoginChallenge.findUnique.mockResolvedValue({
      id: 'challenge-1', consumedAt: null, expiresAt: new Date(Date.now() - 1),
      user: { id: 'user-1', mfaCredential: { enabledAt: new Date() } },
    });
    await expect(service.verifyLoginChallenge(challenge.challengeToken, '123456')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.mfaLoginChallenge.updateMany).not.toHaveBeenCalled();
  });

  it('rejects challenge reuse when another request already consumed it', async () => {
    const setup = await service.beginSetup('user-1', 'user@example.com');
    const credential = { ...prisma.mfaCredential.upsert.mock.results[0].value, enabledAt: new Date(), backupCodes: [] };
    const challenge = await service.createLoginChallenge('user-1');
    prisma.mfaLoginChallenge.findUnique.mockResolvedValue({
      id: 'challenge-1', consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', email: 'user@example.com', displayName: 'Listener', role: 'LISTENER', mfaCredential: credential },
    });
    prisma.mfaLoginChallenge.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.verifyLoginChallenge(challenge.challengeToken, totp(setup.secret))).rejects.toThrow('already been used');
  });

  it('consumes a backup code once and rejects reuse', async () => {
    const setup = await service.beginSetup('user-1', 'user@example.com');
    const backupCode = 'ABCDEF0123456789ABCD';
    const credential = {
      id: 'credential-1', encryptedSecret: prisma.mfaCredential.upsert.mock.calls[0][0].create.encryptedSecret, enabledAt: new Date(),
      backupCodes: [{ id: 'backup-1', codeHash: hash(backupCode), consumedAt: null }],
    };
    const challenge = await service.createLoginChallenge('user-1');
    prisma.mfaLoginChallenge.findUnique.mockResolvedValue({
      id: 'challenge-1', consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'user-1', email: 'user@example.com', displayName: 'Listener', role: 'LISTENER', mfaCredential: credential },
    });
    await service.verifyLoginChallenge(challenge.challengeToken, backupCode);
    expect(prisma.mfaBackupCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'backup-1', consumedAt: null }, data: { consumedAt: expect.any(Date) },
    });
    prisma.mfaBackupCode.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.verifyLoginChallenge(challenge.challengeToken, backupCode)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
