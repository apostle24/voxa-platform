import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeadObjectCommand, PutObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { PublicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';

const EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav',
  'audio/ogg': 'ogg', 'audio/webm': 'webm', 'video/mp4': 'mp4',
  'video/webm': 'webm', 'video/quicktime': 'mov',
};

@Injectable()
export class MediaService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET', '');
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    this.client = new S3Client({
      region: this.config.get<string>('S3_REGION', 'auto'),
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: this.config.get<string>('S3_FORCE_PATH_STYLE', 'false') === 'true',
      credentials: this.config.get<string>('S3_ACCESS_KEY_ID') && this.config.get<string>('S3_SECRET_ACCESS_KEY')
        ? { accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID')!, secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY')! }
        : undefined,
    });
  }

  private ensureConfigured() {
    if (!this.bucket) throw new ServiceUnavailableException('Media storage is not configured');
  }

  private async ownedDraftEpisode(userId: string, showId: string, episodeId: string) {
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, showId, show: { creator: { userId } } },
      select: { id: true, status: true },
    });
    if (!episode) throw new NotFoundException('Episode not found');
    if (episode.status !== PublicationStatus.DRAFT) throw new ConflictException('Media cannot be changed after publication');
  }

  async createUploadUrl(userId: string, showId: string, episodeId: string, input: CreateUploadUrlDto) {
    this.ensureConfigured();
    await this.ownedDraftEpisode(userId, showId, episodeId);
    const maxBytes = input.contentType.startsWith('video/')
      ? Number(this.config.get('MEDIA_MAX_VIDEO_BYTES', 2147483648))
      : Number(this.config.get('MEDIA_MAX_AUDIO_BYTES', 524288000));
    if (input.sizeBytes > maxBytes) throw new ConflictException('File exceeds the configured upload limit');
    const extension = EXTENSIONS[input.contentType];
    const objectKey = `users/${userId}/episodes/${episodeId}/${randomUUID()}.${extension}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket, Key: objectKey, ContentType: input.contentType, ContentLength: input.sizeBytes,
      Metadata: { ownerid: userId, episodeid: episodeId },
    });
    const expiresIn = Math.max(60, Math.min(900, Number(this.config.get('S3_UPLOAD_URL_TTL_SECONDS', 600))));
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });
    return { uploadUrl, objectKey, method: 'PUT', headers: { 'Content-Type': input.contentType }, expiresIn };
  }

  async completeUpload(userId: string, showId: string, episodeId: string, objectKey: string) {
    this.ensureConfigured();
    await this.ownedDraftEpisode(userId, showId, episodeId);
    const prefix = `users/${userId}/episodes/${episodeId}/`;
    if (!objectKey.startsWith(prefix) || objectKey.includes('..')) throw new ForbiddenException('Invalid media object key');
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    if (!head.ContentLength || !head.ContentType || !EXTENSIONS[head.ContentType] || head.Metadata?.ownerid !== userId || head.Metadata?.episodeid !== episodeId) {
      throw new ConflictException('Uploaded media is empty or has an unsupported content type');
    }
    const maxBytes = head.ContentType.startsWith('video/')
      ? Number(this.config.get('MEDIA_MAX_VIDEO_BYTES', 2147483648))
      : Number(this.config.get('MEDIA_MAX_AUDIO_BYTES', 524288000));
    if (head.ContentLength > maxBytes) throw new ConflictException('Uploaded media exceeds the configured size limit');
    const asset = await this.prisma.mediaAsset.upsert({
      where: { objectKey },
      create: { episodeId, objectKey, contentType: head.ContentType, sizeBytes: BigInt(head.ContentLength), status: 'UPLOADED' },
      update: { contentType: head.ContentType, sizeBytes: BigInt(head.ContentLength), status: 'UPLOADED', failureReason: null, processedAt: null },
    });
    await this.prisma.episode.update({ where: { id: episodeId }, data: { mediaKey: objectKey } });
    return { uploaded: true, episodeId, mediaAssetId: asset.id, processingStatus: asset.status, mediaKey: objectKey, sizeBytes: head.ContentLength, contentType: head.ContentType };
  }

  async getPlaybackUrl(episodeId: string, userId?: string) {
    this.ensureConfigured();
    const episode = await this.prisma.episode.findFirst({
      where: { id: episodeId, status: PublicationStatus.PUBLISHED, show: { status: PublicationStatus.PUBLISHED } },
      select: { mediaKey: true, membershipRequired: true, show: { select: { creatorId: true } } },
    });
    if (!episode?.mediaKey) throw new NotFoundException('Published media not found');
    if (episode.membershipRequired) {
      if (!userId) throw new ForbiddenException('Sign in and hold an active creator membership to access this episode');
      const membership = await this.prisma.membershipSubscription.findFirst({
        where: {
          subscriberId: userId,
          creatorId: episode.show.creatorId,
          status: 'ACTIVE',
          currentPeriodEnd: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!membership) throw new ForbiddenException('An active creator membership is required to access this episode');
    }
    const expiresIn = Math.max(60, Math.min(900, Number(this.config.get('S3_PLAYBACK_URL_TTL_SECONDS', 300))));
    const [url, asset] = await Promise.all([
      getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: episode.mediaKey }), { expiresIn }),
      this.prisma.mediaAsset.findUnique({
        where: { objectKey: episode.mediaKey },
        select: { contentType: true, sizeBytes: true, durationSeconds: true },
      }),
    ]);
    return {
      url,
      expiresIn,
      contentType: asset?.contentType || 'application/octet-stream',
      sizeBytes: asset?.sizeBytes?.toString() || null,
      durationSeconds: asset?.durationSeconds ?? null,
    };
  }
}