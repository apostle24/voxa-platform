import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Patch,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { UpdateCreatorDto } from './dto/update-creator.dto';
import { CreatorsService } from './creators.service';

@Controller('creators')
export class CreatorsController {
  constructor(private readonly creators: CreatorsService) {}

  @Post('me')
  @UseGuards(JwtAuthGuard)
  onboard(@Req() request: AuthenticatedRequest, @Body() input: CreateCreatorDto) {
    return this.creators.onboard(request.user.id, input);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMyProfile(@Req() request: AuthenticatedRequest, @Body() input: UpdateCreatorDto) {
    return this.creators.updateMyProfile(request.user.id, input.bio);
  }

  @Get('me/following')
  @UseGuards(JwtAuthGuard)
  getFollowing(@Req() request: AuthenticatedRequest) {
    return this.creators.getFollowing(request.user.id);
  }

  @Get('me/audience')
  @UseGuards(JwtAuthGuard)
  getMyAudience(@Req() request: AuthenticatedRequest, @Query('q') q?: string) {
    return this.creators.getMyAudience(request.user.id, q);
  }
  @Get('me/analytics')
  @UseGuards(JwtAuthGuard)
  getMyAnalytics(@Req() request: AuthenticatedRequest) {
    return this.creators.getMyAnalytics(request.user.id);
  }

  @Get(':handle')
  getByHandle(@Param('handle') handle: string) {
    return this.creators.getByHandle(handle);
  }

  @Get(':handle/follow-status')
  @UseGuards(JwtAuthGuard)
  followStatus(@Req() request: AuthenticatedRequest, @Param('handle') handle: string) {
    return this.creators.getFollowStatus(request.user.id, handle);
  }

  @Post(':handle/follow')
  @UseGuards(JwtAuthGuard)
  follow(@Req() request: AuthenticatedRequest, @Param('handle') handle: string) {
    return this.creators.follow(request.user.id, handle);
  }

  @Delete(':handle/follow')
  @UseGuards(JwtAuthGuard)
  unfollow(@Req() request: AuthenticatedRequest, @Param('handle') handle: string) {
    return this.creators.unfollow(request.user.id, handle);
  }
}
