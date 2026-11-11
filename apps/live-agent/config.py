"""Validated environment configuration for the VOXA LIVE captions agent."""
from dataclasses import dataclass
import os


@dataclass(frozen=True)
class AgentConfig:
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    openai_api_key: str
    stt_model: str = "gpt-4o-mini-transcribe"
    language: str = "en"
    max_participants: int = 24
    agent_name: str = "voxa-live-captions"

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> "AgentConfig":
        env = os.environ if environ is None else environ
        required = ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "OPENAI_API_KEY")
        missing = [name for name in required if not env.get(name, "").strip()]
        if missing:
            raise ValueError("Missing required environment variables: " + ", ".join(missing))
        try:
            limit = int(env.get("VOXA_LIVE_CAPTIONS_MAX_PARTICIPANTS", "24"))
        except ValueError as exc:
            raise ValueError("VOXA_LIVE_CAPTIONS_MAX_PARTICIPANTS must be an integer") from exc
        if not 1 <= limit <= 100:
            raise ValueError("VOXA_LIVE_CAPTIONS_MAX_PARTICIPANTS must be between 1 and 100")
        return cls(
            livekit_url=env["LIVEKIT_URL"].strip(),
            livekit_api_key=env["LIVEKIT_API_KEY"].strip(),
            livekit_api_secret=env["LIVEKIT_API_SECRET"].strip(),
            openai_api_key=env["OPENAI_API_KEY"].strip(),
            stt_model=env.get("VOXA_LIVE_STT_MODEL", "gpt-4o-mini-transcribe").strip(),
            language=env.get("VOXA_LIVE_CAPTIONS_LANGUAGE", "en").strip(),
            max_participants=limit,
            agent_name=env.get("VOXA_LIVE_CAPTIONS_AGENT_NAME", "voxa-live-captions").strip(),
        )
