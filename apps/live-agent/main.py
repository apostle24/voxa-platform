"""VOXA LIVE multi-speaker transcription agent.

The worker subscribes to each remote participant's audio independently. LiveKit
AgentSession publishes the resulting transcription segments into the room, where
web clients receive RoomEvent.TranscriptionReceived.
"""
import asyncio
import logging
import os

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, AutoSubscribe, JobContext, StopResponse, cli, room_io
from livekit.plugins import openai

from config import AgentConfig

load_dotenv()
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("voxa-live-captions")
config = AgentConfig.from_env()


class CaptionTranscriber(Agent):
    """STT-only participant session; it must never speak or generate an LLM reply."""

    def __init__(self, participant_identity: str) -> None:
        super().__init__(
            instructions="Transcribe the participant's speech accurately. Do not respond.",
            stt=openai.STT(
                model=config.stt_model,
                language=config.language,
                api_key=config.openai_api_key,
            ),
        )
        self.participant_identity = participant_identity

    async def on_user_turn_completed(self, chat_ctx, new_message) -> None:
        # The transcription output is published by AgentSession's text output.
        # Raising StopResponse prevents this transcription-only agent from replying.
        logger.debug("Final transcript received for participant %s", self.participant_identity)
        raise StopResponse()


class RoomTranscriber:
    def __init__(self, ctx: JobContext) -> None:
        self.ctx = ctx
        self.sessions: dict[str, AgentSession] = {}
        self.starting: dict[str, asyncio.Task] = {}
        self.tasks: set[asyncio.Task] = set()

    def start(self) -> None:
        self.ctx.room.on("participant_connected", self._on_participant_connected)
        self.ctx.room.on("participant_disconnected", self._on_participant_disconnected)

    def _track(self, task: asyncio.Task) -> None:
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        task.add_done_callback(self._log_task_error)

    @staticmethod
    def _log_task_error(task: asyncio.Task) -> None:
        if task.cancelled():
            return
        error = task.exception()
        if error:
            logger.exception("Caption participant task failed", exc_info=error)

    def _on_participant_connected(self, participant: rtc.RemoteParticipant) -> None:
        identity = participant.identity
        if identity in self.sessions or identity in self.starting:
            return
        if len(self.sessions) + len(self.starting) >= config.max_participants:
            logger.warning("Caption participant limit reached in room %s", self.ctx.room.name)
            return
        task = asyncio.create_task(self._start_participant(participant))
        self.starting[identity] = task
        self._track(task)

    async def _start_participant(self, participant: rtc.RemoteParticipant) -> None:
        identity = participant.identity
        session = AgentSession()
        try:
            await session.start(
                agent=CaptionTranscriber(identity),
                room=self.ctx.room,
                room_options=room_io.RoomOptions(
                    audio_input=True,
                    text_output=True,
                    audio_output=False,
                    participant_identity=identity,
                    text_input=False,
                ),
            )
            # Do not retain a session if the speaker left while STT was starting.
            if self.ctx.room.remote_participants.get(identity) is not participant:
                await session.drain()
                await session.aclose()
                return
            self.sessions[identity] = session
            logger.info("Live captions enabled for participant %s in room %s", identity, self.ctx.room.name)
        except BaseException:
            await session.aclose()
            raise
        finally:
            if self.starting.get(identity) is asyncio.current_task():
                self.starting.pop(identity, None)

    def _on_participant_disconnected(self, participant: rtc.RemoteParticipant) -> None:
        identity = participant.identity
        pending = self.starting.pop(identity, None)
        if pending:
            pending.cancel()
        session = self.sessions.pop(identity, None)
        if session:
            self._track(asyncio.create_task(self._close_session(session)))

    @staticmethod
    async def _close_session(session: AgentSession) -> None:
        try:
            await session.drain()
        finally:
            await session.aclose()

    async def aclose(self) -> None:
        self.ctx.room.off("participant_connected", self._on_participant_connected)
        self.ctx.room.off("participant_disconnected", self._on_participant_disconnected)
        for task in list(self.starting.values()):
            task.cancel()
        await asyncio.gather(*list(self.tasks), return_exceptions=True)
        sessions, self.sessions = list(self.sessions.values()), {}
        await asyncio.gather(*(self._close_session(session) for session in sessions), return_exceptions=True)


server = AgentServer()


@server.rtc_session(agent_name=config.agent_name)
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name, "agent": "voxa-live-captions"}
    transcriber = RoomTranscriber(ctx)
    transcriber.start()
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    for participant in ctx.room.remote_participants.values():
        transcriber._on_participant_connected(participant)
    ctx.add_shutdown_callback(transcriber.aclose)
    logger.info("VOXA LIVE captions agent joined room %s", ctx.room.name)


if __name__ == "__main__":
    cli.run_app(server)
