import { Injectable, UnauthorizedException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(input: Buffer): string {
  let bits = 0, value = 0, output = '';
  for (const byte of input) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}
function base32Decode(input: string): Buffer {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const char of input.replace(/=+$/,'').toUpperCase()) {
    const index = BASE32.indexOf(char); if (index < 0) throw new UnauthorizedException('Invalid authenticator secret');
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
function totp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}
function matchingTotpCounter(secret: Buffer, code: string, now = Date.now()): number | null {
  if (!/^\\d{6}$/.test(code)) return null;
  const counter = Math.floor(now / 30_000);
  for (let drift = -1; drift <= 1; drift++) {
    const candidate = counter + drift;
    if (candidate < 0) continue;
    const expected = Buffer.from(totp(secret, candidate));
    const actual = Buffer.from(code);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return candidate;
  }
  return null;
}

@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService) {}

  async beginSetup(userId: string, email: string) {
    const existing = await this.prisma.mfaCredential.findUnique({ where: { userId } });
    if (existing?.enabledAt) throw new ConflictException('MFA is already enabled');
    const secret = base32Encode(randomBytes(20));
    const encryptedSecret = this.encrypt(secret);
    const credential = await this.prisma.mfaCredential.upsert({
      where: { userId },
      create: { userId, encryptedSecret },
      update: { encryptedSecret, enabledAt: null },
    });
    const label = encodeURIComponent('VOXA:' + email);
    const issuer = encodeURIComponent('VOXA');
    return { setupRequired: true, secret, otpauthUrl: 'otpauth://totp/' + label + '?secret=' + secret + '&issuer=' + issuer + '&algorithm=SHA1&digits=6&period=30' };
  }

  async enable(userId: string, code: string) {
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } });
    if (!credential || credential.enabledAt) throw new UnauthorizedException('MFA setup is not pending');
    const matchedCounter = matchingTotpCounter(base32Decode(this.decrypt(credential.encryptedSecret)), code);
    if (matchedCounter === null) throw new UnauthorizedException('Authenticator code is invalid');
    const codes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex').toUpperCase());
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaCredential.update({ where: { id: credential.id }, data: { enabledAt: new Date(), lastTotpCounter: matchedCounter } });
      await tx.mfaBackupCode.deleteMany({ where: { credentialId: credential.id } });
      await tx.mfaBackupCode.createMany({ data: codes.map(code => ({ credentialId: credential.id, codeHash: hash(code) })) });
      // Existing long-lived sessions were created before MFA was enabled; require a fresh MFA login on every device.
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return { enabled: true, backupCodes: codes };
  }

  async disable(userId: string, code: string) {
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId }, include: { backupCodes: true } });
    if (!credential?.enabledAt) throw new UnauthorizedException('Authenticator or backup code is invalid');
    const factor = this.identifyFactor(credential, code);
    if (!factor) throw new UnauthorizedException('Authenticator or backup code is invalid');
    await this.prisma.$transaction(async (tx) => {
      await this.consumeFactor(tx, credential.id, factor);
      await tx.mfaCredential.delete({ where: { id: credential.id } });
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return { disabled: true };
  }

  async createLoginChallenge(userId: string) {
    const raw = randomBytes(32).toString('hex');
    await this.prisma.mfaLoginChallenge.create({ data: { userId, tokenHash: hash(raw), expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) } });
    return { mfaRequired: true, challengeToken: raw, expiresIn: 300 };
  }

  async verifyLoginChallenge(rawToken: string, code: string) {
    const challenge = await this.prisma.mfaLoginChallenge.findUnique({
      where: { tokenHash: hash(rawToken) },
      include: { user: { include: { mfaCredential: { include: { backupCodes: true } } } } },
    });
    const now = new Date();
    const credential = challenge?.user.mfaCredential;
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now || !credential?.enabledAt) {
      throw new UnauthorizedException('MFA challenge is invalid or expired');
    }
    const factor = this.identifyFactor(credential, code);
    if (!factor) throw new UnauthorizedException('Authenticator or backup code is invalid');
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.mfaLoginChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new UnauthorizedException('MFA challenge has already been used');
      await this.consumeFactor(tx, credential.id, factor);
    });
    return { id: challenge.user.id, email: challenge.user.email, displayName: challenge.user.displayName, role: challenge.user.role };
  }

  async isEnabled(userId: string) {
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId }, select: { enabledAt: true } });
    return Boolean(credential?.enabledAt);
  }

  private identifyFactor(credential: any, code: string): { kind: 'totp'; counter: number } | { kind: 'backup'; id: string } | null {
    const counter = matchingTotpCounter(base32Decode(this.decrypt(credential.encryptedSecret)), code);
    if (counter !== null) return { kind: 'totp', counter };
    if (!/^[A-F0-9]{20}$/.test(code.toUpperCase())) return null;
    const codeHash = hash(code.toUpperCase());
    const backup = credential.backupCodes?.find((item: any) => item.codeHash === codeHash && !item.consumedAt);
    return backup ? { kind: 'backup', id: backup.id } : null;
  }

  private async consumeFactor(tx: any, credentialId: string, factor: { kind: 'totp'; counter: number } | { kind: 'backup'; id: string }) {
    const result = factor.kind === 'totp'
      ? await tx.mfaCredential.updateMany({
          where: { id: credentialId, OR: [{ lastTotpCounter: null }, { lastTotpCounter: { lt: factor.counter } }] },
          data: { lastTotpCounter: factor.counter },
        })
      : await tx.mfaBackupCode.updateMany({ where: { id: factor.id, credentialId, consumedAt: null }, data: { consumedAt: new Date() } });
    if (result.count !== 1) throw new UnauthorizedException('Authenticator code has already been used');
  }

  private encrypt(value: string) {
    const key = this.encryptionKey(); const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
  }
  private decrypt(value: string) {
    const [iv, tag, encrypted] = value.split('.');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
  }
  private encryptionKey() {
    const raw = process.env.MFA_ENCRYPTION_KEY;
    if (!raw) throw new ServiceUnavailableException('MFA encryption is not configured');
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new ServiceUnavailableException('MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    return key;
  }
}
