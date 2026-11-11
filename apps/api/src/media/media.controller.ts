import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { MediaService } from './media.service';

@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('shows/:showId/episodes/:episodeId/upload-url')
  @UseGuards(JwtAuthGuard)
  createUploadUrl(@Req() req: AuthenticatedRequest, @Param('showId') showId: string, @Param('episodeId') episodeId: string, @Body() input: CreateUploadUrlDto) {
    return this.media.createUploadUrl(req.user.id, showId, episodeId, input);
  }

  @Post('shows/:showId/episodes/:episodeId/complete-upload')
  @UseGuards(JwtAuthGuard)
  completeUpload(@Req() req: AuthenticatedRequest, @Param('showId') showId: string, @Param('episodeId') episodeId: string, @Body() input: CompleteUploadDto) {
    return this.media.completeUpload(req.user.id, showId, episodeId, input.objectKey);
  }


  @Get('episodes/:episodeId/draft-preview-url')
  @UseGuards(JwtAuthGuard)
  creatorDraftPreviewUrl(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string) {
    return this.media.getCreatorDraftPreviewUrl(req.user.id, episodeId);
  }

  @Get('episodes/:episodeId/playback-url')
  playbackUrl(@Param('episodeId') episodeId: string) {
    return this.media.getPlaybackUrl(episodeId);
  }

  @Get('episodes/:episodeId/member-playback-url')
  @UseGuards(JwtAuthGuard)
  memberPlaybackUrl(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string) {
    return this.media.getPlaybackUrl(episodeId, req.user.id);
  }
}