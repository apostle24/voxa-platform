import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { CreatorsService } from './creators.service';

@Controller('creators')
export class CreatorsController {
  constructor(private readonly creators: CreatorsService) {}

  @Post('me')
  @UseGuards(JwtAuthGuard)
  onboard(@Req() request: AuthenticatedRequest, @Body() input: CreateCreatorDto) {
    return this.creators.onboard(request.user.id, input);
  }

  @Get(':handle')
  getByHandle(@Param('handle') handle: string) {
    return this.creators.getByHandle(handle);
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
