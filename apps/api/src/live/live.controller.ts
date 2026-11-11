import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateLiveRoomDto } from './dto/create-live-room.dto';
import { CreateLiveChatMessageDto } from './dto/create-live-chat-message.dto';
import { CreateLivePollDto, VoteLivePollDto, CreateLiveQuestionDto, ModerateLiveQuestionDto } from './dto/live-audience-interactions.dto';
import { CreateLiveAgendaItemDto, UpdateLiveAgendaItemDto, HandoffLiveSpeakerDto } from './dto/live-session-agenda.dto';
import { LiveService } from './live.service';

@Controller('live')
export class LiveController {
  constructor(private readonly live: LiveService) {}

  @Get('rooms/me')
  @UseGuards(JwtAuthGuard)
  listMyRooms(@Req() req: AuthenticatedRequest) {
    return this.live.listMyLiveRooms(req.user.id);
  }

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

  @Post('rooms/:roomId/recording/start')
  @UseGuards(JwtAuthGuard)
  startRoomRecording(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Body('consentConfirmed') consentConfirmed: boolean) {
    return this.live.startRoomRecording(req.user.id, roomId, consentConfirmed);
  }

  @Post('rooms/:roomId/recording/create-replay-draft')
  @UseGuards(JwtAuthGuard)
  createRecordingEpisodeDraft(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.createRecordingEpisodeDraft(req.user.id, roomId);
  }

  @Post('rooms/:roomId/recording/stop')
  @UseGuards(JwtAuthGuard)
  stopRoomRecording(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.stopRoomRecording(req.user.id, roomId);
  }

  @Post('rooms/:roomId/end')
  @UseGuards(JwtAuthGuard)
  endRoom(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.endRoom(req.user.id, roomId);
  }

  @Get('rooms/:roomId/moderators')
  @UseGuards(JwtAuthGuard)
  listRoomModerators(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.listRoomModerators(req.user.id, roomId);
  }

  @Post('rooms/:roomId/moderators')
  @UseGuards(JwtAuthGuard)
  addRoomModerator(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Body('userId') userId: string) {
    return this.live.addRoomModerator(req.user.id, roomId, userId);
  }

  @Post('rooms/:roomId/moderators/:moderatorId/remove')
  @UseGuards(JwtAuthGuard)
  removeRoomModerator(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('moderatorId') moderatorId: string) {
    return this.live.removeRoomModerator(req.user.id, roomId, moderatorId);
  }


  @Get('rooms/:roomId/interactions')
  @UseGuards(JwtAuthGuard)
  getAudienceInteractions(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.getAudienceInteractions(req.user.id, roomId);
  }

  @Post('rooms/:roomId/polls')
  @UseGuards(JwtAuthGuard)
  createLivePoll(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Body() input: CreateLivePollDto) {
    return this.live.createLivePoll(req.user.id, roomId, input.question, input.options);
  }

  @Post('rooms/:roomId/polls/:pollId/vote')
  @UseGuards(JwtAuthGuard)
  voteLivePoll(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('pollId') pollId: string, @Body() input: VoteLivePollDto) {
    return this.live.voteLivePoll(req.user.id, roomId, pollId, input.optionId);
  }

  @Post('rooms/:roomId/polls/:pollId/close')
  @UseGuards(JwtAuthGuard)
  closeLivePoll(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('pollId') pollId: string) {
    return this.live.closeLivePoll(req.user.id, roomId, pollId);
  }

  @Post('rooms/:roomId/questions')
  @UseGuards(JwtAuthGuard)
  submitLiveQuestion(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Body() input: CreateLiveQuestionDto) {
    return this.live.submitLiveQuestion(req.user.id, roomId, input.question);
  }

  @Post('rooms/:roomId/questions/:questionId/moderate')
  @UseGuards(JwtAuthGuard)
  moderateLiveQuestion(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('questionId') questionId: string, @Body() input: ModerateLiveQuestionDto) {
    return this.live.moderateLiveQuestion(req.user.id, roomId, questionId, input);
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


  @Get('rooms/:roomId/session-plan')
  @UseGuards(JwtAuthGuard)
  getSessionPlan(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.getSessionPlan(req.user.id, roomId);
  }

  @Post('rooms/:roomId/agenda')
  @UseGuards(JwtAuthGuard)
  createAgendaItem(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Body() input: CreateLiveAgendaItemDto) {
    return this.live.createAgendaItem(req.user.id, roomId, input);
  }

  @Post('rooms/:roomId/agenda/:itemId/update')
  @UseGuards(JwtAuthGuard)
  updateAgendaItem(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('itemId') itemId: string, @Body() input: UpdateLiveAgendaItemDto) {
    return this.live.updateAgendaItem(req.user.id, roomId, itemId, input);
  }

  @Post('rooms/:roomId/agenda/:itemId/delete')
  @UseGuards(JwtAuthGuard)
  deleteAgendaItem(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('itemId') itemId: string) {
    return this.live.deleteAgendaItem(req.user.id, roomId, itemId);
  }

  @Post('rooms/:roomId/agenda/:itemId/start')
  @UseGuards(JwtAuthGuard)
  startAgendaItem(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('itemId') itemId: string) {
    return this.live.startAgendaItem(req.user.id, roomId, itemId);
  }

  @Post('rooms/:roomId/agenda/:itemId/complete')
  @UseGuards(JwtAuthGuard)
  completeAgendaItem(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Param('itemId') itemId: string) {
    return this.live.completeAgendaItem(req.user.id, roomId, itemId);
  }

  @Post('rooms/:roomId/speaker-handoff')
  @UseGuards(JwtAuthGuard)
  handoffSpeaker(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string, @Body() input: HandoffLiveSpeakerDto) {
    return this.live.handoffSpeaker(req.user.id, roomId, input.speakerId, input.agendaItemId);
  }

  @Post('rooms/:roomId/speaker-turn/end')
  @UseGuards(JwtAuthGuard)
  endSpeakerTurn(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.endSpeakerTurn(req.user.id, roomId);
  }

  @Get('rooms/:roomId/stage')
  @UseGuards(JwtAuthGuard)
  getStageState(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.getStageState(req.user.id, roomId);
  }

  @Post('rooms/:roomId/cancel')
  @UseGuards(JwtAuthGuard)
  cancelScheduledRoom(@Req() req: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.live.cancelScheduledRoom(req.user.id, roomId);
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
