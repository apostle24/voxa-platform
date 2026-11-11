import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateShowDto } from './dto/create-show.dto';
import { UpdateShowDto } from './dto/update-show.dto';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { UpdateEpisodeDto } from './dto/update-episode.dto';
import { SaveProgressDto } from './dto/save-progress.dto';
import { SetEpisodeMembershipDto } from './dto/set-episode-membership.dto';
import { CreateEpisodeCommentDto } from './dto/create-episode-comment.dto';
import { CreateMomentDto } from './dto/create-moment.dto';
import { ShowsService } from './shows.service';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

class SaveTranscriptDto {
  @IsString() @MinLength(1) @MaxLength(200000)
  content!: string;
  @IsOptional() @IsString() @MaxLength(12)
  language?: string;
}

@Controller()
export class ShowsController {
  constructor(private readonly shows: ShowsService) {}

  @Get('creators/me/shows')
  @UseGuards(JwtAuthGuard)
  listMyShows(@Req() req: AuthenticatedRequest) {
    return this.shows.listMyShows(req.user.id);
  }

  @Post('shows')
  @UseGuards(JwtAuthGuard)
  createShow(@Req() req: AuthenticatedRequest, @Body() input: CreateShowDto) {
    return this.shows.createShow(req.user.id, input);
  }

  @Patch('shows/:showId')
  @UseGuards(JwtAuthGuard)
  updateShow(@Req() req: AuthenticatedRequest, @Param('showId') showId: string, @Body() input: UpdateShowDto) {
    return this.shows.updateShow(req.user.id, showId, input);
  }

  @Post('shows/:showId/publish')
  @UseGuards(JwtAuthGuard)
  publishShow(@Req() req: AuthenticatedRequest, @Param('showId') showId: string) {
    return this.shows.publishShow(req.user.id, showId);
  }

  @Post('shows/:showId/episodes')
  @UseGuards(JwtAuthGuard)
  createEpisode(@Req() req: AuthenticatedRequest, @Param('showId') showId: string, @Body() input: CreateEpisodeDto) {
    return this.shows.createEpisode(req.user.id, showId, input);
  }

  @Patch('shows/:showId/episodes/:episodeId')
  @UseGuards(JwtAuthGuard)
  updateEpisode(@Req() req: AuthenticatedRequest, @Param('showId') showId: string, @Param('episodeId') episodeId: string, @Body() input: UpdateEpisodeDto) {
    return this.shows.updateEpisode(req.user.id, showId, episodeId, input);
  }

  @Post('shows/:showId/episodes/:episodeId/publish')
  @UseGuards(JwtAuthGuard)
  publishEpisode(@Req() req: AuthenticatedRequest, @Param('showId') showId: string, @Param('episodeId') episodeId: string) {
    return this.shows.publishEpisode(req.user.id, showId, episodeId);
  }


  @Get('discovery/moments')
  discoverMoments(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.shows.discoverMoments(cursor, limit ? Number(limit) : undefined);
  }

  @Get('moments/:momentId/community')
  getMomentCommunity(@Param('momentId') momentId: string) {
    return this.shows.getMomentCommunity(momentId);
  }

  @Put('moments/:momentId/like')
  @UseGuards(JwtAuthGuard)
  likeMoment(@Req() req: AuthenticatedRequest, @Param('momentId') momentId: string) {
    return this.shows.setMomentLike(req.user.id, momentId, true);
  }

  @Delete('moments/:momentId/like')
  @UseGuards(JwtAuthGuard)
  unlikeMoment(@Req() req: AuthenticatedRequest, @Param('momentId') momentId: string) {
    return this.shows.setMomentLike(req.user.id, momentId, false);
  }

  @Post('moments/:momentId/comments')
  @UseGuards(JwtAuthGuard)
  createMomentComment(@Req() req: AuthenticatedRequest, @Param('momentId') momentId: string, @Body() input: CreateEpisodeCommentDto) {
    return this.shows.createMomentComment(req.user.id, momentId, input.content, input.parentId);
  }

  @Delete('moments/:momentId/comments/:commentId')
  @UseGuards(JwtAuthGuard)
  deleteMomentComment(@Req() req: AuthenticatedRequest, @Param('momentId') momentId: string, @Param('commentId') commentId: string) {
    return this.shows.deleteMomentComment(req.user.id, momentId, commentId);
  }

  @Post('episodes/:episodeId/moments')
  @UseGuards(JwtAuthGuard)
  createMoment(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string, @Body() input: CreateMomentDto) {
    return this.shows.createMoment(req.user.id, episodeId, input.caption, input.startSeconds, input.endSeconds);
  }

  @Post('moments/:momentId/publish')
  @UseGuards(JwtAuthGuard)
  publishMoment(@Req() req: AuthenticatedRequest, @Param('momentId') momentId: string) {
    return this.shows.publishMoment(req.user.id, momentId);
  }

  @Delete('moments/:momentId')
  @UseGuards(JwtAuthGuard)
  deleteMoment(@Req() req: AuthenticatedRequest, @Param('momentId') momentId: string) {
    return this.shows.deleteMoment(req.user.id, momentId);
  }

  @Get('discovery/shows')
  discoverShows(@Query('q') q?: string, @Query('category') category?: string, @Query('language') language?: string,
    @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.shows.discoverShows({ q, category, language, cursor, limit: limit ? Number(limit) : undefined });
  }

  @Get('discovery/episodes')
  discoverEpisodes(@Query('q') q?: string, @Query('category') category?: string, @Query('language') language?: string,
    @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.shows.discoverEpisodes({ q, category, language, cursor, limit: limit ? Number(limit) : undefined });
  }

  @Get('discovery/categories')
  discoveryCategories() {
    return this.shows.discoveryCategories();
  }

  @Patch('shows/:showId/episodes/:episodeId/membership')
  @UseGuards(JwtAuthGuard)
  setEpisodeMembership(@Req() req: AuthenticatedRequest, @Param('showId') showId: string, @Param('episodeId') episodeId: string, @Body() input: SetEpisodeMembershipDto) {
    return this.shows.setEpisodeMembership(req.user.id, showId, episodeId, input.membershipRequired);
  }

  @Get('shows/:showId')
  getShow(@Param('showId') showId: string) {
    return this.shows.getShow(showId);
  }

  @Get('episodes/:episodeId')
  getEpisode(@Param('episodeId') episodeId: string) {
    return this.shows.getEpisode(episodeId);
  }

  @Get('episodes/:episodeId/transcript')
  getEpisodeTranscript(@Param('episodeId') episodeId: string, @Req() req: AuthenticatedRequest) {
    const header = req.headers?.authorization;
    const userId = header?.startsWith('Bearer ') ? req.user?.id : undefined;
    return this.shows.getEpisodeTranscript(episodeId, userId);
  }

  @Put('shows/:showId/episodes/:episodeId/transcript')
  @UseGuards(JwtAuthGuard)
  saveEpisodeTranscript(@Req() req: AuthenticatedRequest, @Param('showId') showId: string, @Param('episodeId') episodeId: string, @Body() input: SaveTranscriptDto) {
    return this.shows.saveEpisodeTranscript(req.user.id, showId, episodeId, input.content, input.language);
  }

  @Get('episodes/:episodeId/community')
  @UseGuards(JwtAuthGuard)
  getEpisodeCommunity(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string) {
    return this.shows.getEpisodeCommunity(req.user.id, episodeId);
  }

  @Post('episodes/:episodeId/comments')
  @UseGuards(JwtAuthGuard)
  createEpisodeComment(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string, @Body() input: CreateEpisodeCommentDto) {
    return this.shows.createEpisodeComment(req.user.id, episodeId, input.content, input.parentId);
  }

  @Delete('episodes/:episodeId/comments/:commentId')
  @UseGuards(JwtAuthGuard)
  deleteEpisodeComment(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string, @Param('commentId') commentId: string) {
    return this.shows.deleteEpisodeComment(req.user.id, episodeId, commentId);
  }

  @Put('episodes/:episodeId/like')
  @UseGuards(JwtAuthGuard)
  likeEpisode(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string) {
    return this.shows.setEpisodeLike(req.user.id, episodeId, true);
  }

  @Delete('episodes/:episodeId/like')
  @UseGuards(JwtAuthGuard)
  unlikeEpisode(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string) {
    return this.shows.setEpisodeLike(req.user.id, episodeId, false);
  }

  @Put('episodes/:episodeId/bookmark')
  @UseGuards(JwtAuthGuard)
  bookmark(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string) {
    return this.shows.bookmark(req.user.id, episodeId);
  }

  @Delete('episodes/:episodeId/bookmark')
  @UseGuards(JwtAuthGuard)
  unbookmark(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string) {
    return this.shows.unbookmark(req.user.id, episodeId);
  }

  @Get('me/bookmarks')
  @UseGuards(JwtAuthGuard)
  listBookmarks(@Req() req: AuthenticatedRequest) {
    return this.shows.listBookmarks(req.user.id);
  }

  @Put('episodes/:episodeId/progress')
  @UseGuards(JwtAuthGuard)
  saveProgress(@Req() req: AuthenticatedRequest, @Param('episodeId') episodeId: string, @Body() input: SaveProgressDto) {
    return this.shows.saveProgress(req.user.id, episodeId, input.positionSeconds);
  }

  @Get('me/playback-progress')
  @UseGuards(JwtAuthGuard)
  listProgress(@Req() req: AuthenticatedRequest) {
    return this.shows.listProgress(req.user.id);
  }
}
