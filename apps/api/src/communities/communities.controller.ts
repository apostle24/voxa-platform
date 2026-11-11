import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, Delete } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateCommunityDto } from './dto/create-community.dto';
import { CreateCommunityPostDto } from './dto/create-community-post.dto';
import { CommunitiesService } from './communities.service';

@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communities: CommunitiesService) {}

  @Get()
  discover(@Query('q') q?: string, @Query('category') category?: string) {
    return this.communities.discover(q, category);
  }

  @Get(':communityId/membership')
  @UseGuards(JwtAuthGuard)
  membership(@Req() req: AuthenticatedRequest, @Param('communityId') id: string) {
    return this.communities.membership(req.user.id, id);
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.communities.get(slug);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Req() req: AuthenticatedRequest, @Body() input: CreateCommunityDto) {
    return this.communities.create(req.user.id, input);
  }

  @Post(':communityId/join')
  @UseGuards(JwtAuthGuard)
  join(@Req() req: AuthenticatedRequest, @Param('communityId') id: string) {
    return this.communities.join(req.user.id, id);
  }

  @Delete(':communityId/join')
  @UseGuards(JwtAuthGuard)
  leave(@Req() req: AuthenticatedRequest, @Param('communityId') id: string) {
    return this.communities.leave(req.user.id, id);
  }

  @Post(':communityId/posts')
  @UseGuards(JwtAuthGuard)
  post(@Req() req: AuthenticatedRequest, @Param('communityId') id: string, @Body() input: CreateCommunityPostDto) {
    return this.communities.createPost(req.user.id, id, input.content);
  }
}