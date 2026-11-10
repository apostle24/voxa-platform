import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateLiveRoomDto } from './dto/create-live-room.dto';
import { LiveService } from './live.service';

@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  @Get('rooms')
  listRooms() {
    return this.live.listLiveRooms();
  }

  @Post('rooms')
  @UseGuards(JwtAuthGuard)
  createRoom(@Req() req: AuthenticatedRequest, @Body() input: CreateLiveRoomDto) {
    return this.live.createRoom(req.user.id, input);
  }

  @Post('rooms/:roomId/end')
  @UseGuards(JwtAuthGuard)
  endRoom(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.endRoom(req.user.id, roomId);
  }

  @Get('rooms/:roomId/stage')
  @UseGuards(JwtAuthGuard)
  getStageState(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.getStageState(req.user.id, roomId);
  }

  @Post('rooms/:roomId/join-token')
  @UseGuards(JwtAuthGuard)
  joinToken(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.joinToken(req.user.id, roomId);
  }

  @Post('rooms/:roomId/speakers/:speakerId/remove')
  @UseGuards(JwtAuthGuard)
  removeSpeaker(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('speakerId') speakerId: string) {
    return this.live.removeSpeaker(req.user.id, roomId, speakerId);
  }

  @Post('rooms/:roomId/stage-requests')
  @UseGuards(JwtAuthGuard)
  requestStage(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.requestStage(req.user.id, roomId);
  }

  @Post('rooms/:roomId/stage-requests/:requestId/approve')
  @UseGuards(JwtAuthGuard)
  approveStage(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('requestId') requestId: string) {
    return this.live.decideStageRequest(req.user.id, roomId, requestId, true);
  }

  @Post('rooms/:roomId/stage-requests/:requestId/reject')
  @UseGuards(JwtAuthGuard)
  rejectStage(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('requestId') requestId: string) {
    return this.live.decideStageRequest(req.user.id, roomId, requestId, false);
  }
}
