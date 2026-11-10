import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateShowDto } from './dto/create-show.dto';
import { UpdateShowDto } from './dto/update-show.dto';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { UpdateEpisodeDto } from './dto/update-episode.dto';
import { SaveProgressDto } from './dto/save-progress.dto';
import { ShowsService } from './shows.service';

@Controller()
export class ShowsController {
  constructor(private readonly shows: ShowsService) {}

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

  @Get('shows/:showId')
  getShow(@Param('showId') showId: string) {
    return this.shows.getShow(showId);
  }

  @Get('episodes/:episodeId')
  getEpisode(@Param('episodeId') episodeId: string) {
    return this.shows.getEpisode(episodeId);
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
