import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateLiveRoomDto } from './dto/create-live-room.dto';
import { CreateLiveChatMessageDto } from './dto/create-live-chat-message.dto';
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

  @Post('webhooks/livekit')
  receiveLiveKitWebhook(@Req() req: any, @Headers('authorization') authorization?: string) {
    const rawBody = req.rawBody?.toString('utf8') || (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');
    return this.live.receiveLiveKitWebhook(rawBody, authorization);
  }

  @Post('rooms/:roomId/end')
  @UseGuards(JwtAuthGuard)
  endRoom(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.endRoom(req.user.id, roomId);
  }

  @Get('rooms/:roomId/chat')
  @UseGuards(JwtAuthGuard)
  getChatMessages(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.getChatMessages(req.user.id, roomId);
  }

  @Post('rooms/:roomId/chat')
  @UseGuards(JwtAuthGuard)
  postChatMessage(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Body() input: CreateLiveChatMessageDto) {
    return this.live.postChatMessage(req.user.id, roomId, input.content);
  }

  @Post('rooms/:roomId/chat/:messageId/delete')
  @UseGuards(JwtAuthGuard)
  deleteChatMessage(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('messageId') messageId: string) {
    return this.live.deleteChatMessage(req.user.id, roomId, messageId);
  }

  @Post('rooms/:roomId/presence/heartbeat')
  @UseGuards(JwtAuthGuard)
  heartbeatViewer(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Body('sessionId') sessionId: string) {
    return this.live.heartbeatViewer(req.user.id, roomId, sessionId);
  }

  @Post('rooms/:roomId/presence/leave')
  @UseGuards(JwtAuthGuard)
  leaveViewer(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Body('sessionId') sessionId: string) {
    return this.live.leaveViewer(req.user.id, roomId, sessionId);
  }

  @Get('rooms/:roomId/analytics')
  @UseGuards(JwtAuthGuard)
  getRoomAnalytics(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.getRoomAnalytics(req.user.id, roomId);
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
