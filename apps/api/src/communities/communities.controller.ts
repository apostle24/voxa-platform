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

  @Get('me/owned')
  @UseGuards(JwtAuthGuard)
  listOwned(@Req() req: AuthenticatedRequest) {
    return this.communities.listOwned(req.user.id);
  }

  @Get(':communityId/members')
  @UseGuards(JwtAuthGuard)
  listMembers(@Req() req: AuthenticatedRequest, @Param('communityId') id: string, @Query('q') q?: string) {
    return this.communities.listMembers(req.user.id, id, q);
  }

  @Delete(':communityId/members/:memberId')
  @UseGuards(JwtAuthGuard)
  removeMember(@Req() req: AuthenticatedRequest, @Param('communityId') id: string, @Param('memberId') memberId: string) {
    return this.communities.removeMember(req.user.id, id, memberId);
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

  @Get(':communityId/posts')
  @UseGuards(JwtAuthGuard)
  listPosts(@Req() req: AuthenticatedRequest, @Param('communityId') id: string) {
    return this.communities.listPosts(req.user.id, id);
  }

  @Post(':communityId/posts/:postId/comments')
  @UseGuards(JwtAuthGuard)
  comment(@Req() req: AuthenticatedRequest, @Param('communityId') id: string, @Param('postId') postId: string, @Body() input: CreateCommunityPostDto) {
    return this.communities.createPostComment(req.user.id, id, postId, input.content);
  }

  @Post(':communityId/posts')
  @UseGuards(JwtAuthGuard)
  post(@Req() req: AuthenticatedRequest, @Param('communityId') id: string, @Body() input: CreateCommunityPostDto) {
    return this.communities.createPost(req.user.id, id, input.content);
  }
}