# VOXA LIVE captions agent

This standalone LiveKit Agent subscribes to each remote participant's audio in a VOXA LIVE room, runs OpenAI speech-to-text, and publishes transcription segments into the LiveKit room. The web client consumes those segments through LiveKit's `RoomEvent.TranscriptionReceived` event.

## Required environment

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `OPENAI_API_KEY`

Optional settings:

- `VOXA_LIVE_STT_MODEL` (default: `gpt-4o-mini-transcribe`)
- `VOXA_LIVE_CAPTIONS_LANGUAGE` (default: `en`; use a supported language code)
- `VOXA_LIVE_CAPTIONS_MAX_PARTICIPANTS` (default: `24`, allowed: 1–100)
- `LOG_LEVEL` (default: `INFO`)

The OpenAI key is used only by this server-side worker. Never expose it in browser or mobile configuration.

## Run locally

From the repository root:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r apps/live-agent/requirements.txt
export LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... OPENAI_API_KEY=...
python apps/live-agent/main.py start
```

Run the agent as a separate, always-available process. It must be registered with the same LiveKit project as the API and room clients. Set `LIVEKIT_CAPTIONS_AGENT_ENABLED=true` and `LIVEKIT_CAPTIONS_AGENT_NAME=voxa-live-captions` in the API environment after deploying the worker. When the host starts a room, the API creates one explicit LiveKit agent dispatch (and checks for an existing dispatch first). The agent handles all existing and subsequently connected participants in the room while its job is active.

## Docker Compose

Set the required values in the repository-root `.env` file and run:

```bash
docker compose -f infra/live-captions-agent.compose.yml up -d --build
```

## Tests

```bash
python -m unittest discover -s apps/live-agent -p 'test_*.py'
```

Captions are ephemeral LiveKit transcription events; this worker does not write participant speech to the VOXA database. Consent, retention, and applicable recording/transcription notices should be handled in the room experience and operational policy before production rollout.
