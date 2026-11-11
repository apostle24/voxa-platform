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
function verifyTotp(secret: Buffer, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(now / 30_000);
  for (let drift = -1; drift <= 1; drift++) {
    const expected = Buffer.from(totp(secret, counter + drift));
    const actual = Buffer.from(code);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
  }
  return false;
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
    if (!verifyTotp(base32Decode(this.decrypt(credential.encryptedSecret)), code)) throw new UnauthorizedException('Authenticator code is invalid');
    const codes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex').toUpperCase());
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaCredential.update({ where: { id: credential.id }, data: { enabledAt: new Date() } });
      await tx.mfaBackupCode.deleteMany({ where: { credentialId: credential.id } });
      await tx.mfaBackupCode.createMany({ data: codes.map(code => ({ credentialId: credential.id, codeHash: hash(code) })) });
      // Existing long-lived sessions were created before MFA was enabled; require a fresh MFA login on every device.
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return { enabled: true, backupCodes: codes };
  }

  async disable(userId: string, code: string) {
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId }, include: { backupCodes: true } });
    if (!credential?.enabledAt || !(await this.verifyCredential(credential, code))) throw new UnauthorizedException('Authenticator or backup code is invalid');
    await this.prisma.mfaCredential.delete({ where: { id: credential.id } });
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
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now || !challenge.user.mfaCredential?.enabledAt) {
      throw new UnauthorizedException('MFA challenge is invalid or expired');
    }
    if (!(await this.verifyCredential(challenge.user.mfaCredential, code))) throw new UnauthorizedException('Authenticator or backup code is invalid');
    const consumed = await this.prisma.mfaLoginChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw new UnauthorizedException('MFA challenge has already been used');
    return { id: challenge.user.id, email: challenge.user.email, displayName: challenge.user.displayName, role: challenge.user.role };
  }

  async isEnabled(userId: string) {
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId }, select: { enabledAt: true } });
    return Boolean(credential?.enabledAt);
  }

  private async verifyCredential(credential: any, code: string) {
    if (verifyTotp(base32Decode(this.decrypt(credential.encryptedSecret)), code)) return true;
    if (!/^[A-F0-9]{20}$/.test(code.toUpperCase())) return false;
    const codeHash = hash(code.toUpperCase());
    const backup = credential.backupCodes?.find((item: any) => item.codeHash === codeHash && !item.consumedAt);
    if (!backup) return false;
    const consumed = await this.prisma.mfaBackupCode.updateMany({
      where: { id: backup.id, consumedAt: null }, data: { consumedAt: new Date() },
    });
    return consumed.count === 1;
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
