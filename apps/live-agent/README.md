# VOXA LIVE captions agent

This standalone LiveKit Agent subscribes to each remote participant's audio in a VOXA LIVE room, runs OpenAI speech-to-text, and publishes transcription segments into the LiveKit room. The web client consumes those segments through LiveKit's `RoomEvent.TranscriptionReceived` event.

## Required environment

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `OPENAI_API_KEY`
- `VOXA_LIVE_CAPTIONS_API_URL` (VOXA API base URL, including `/v1`)
- `VOXA_LIVE_CAPTIONS_INGEST_SECRET` (must match `LIVEKIT_CAPTIONS_INGEST_SECRET` on the API)

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

Final speech segments are also sent over an authenticated server-to-server endpoint and retained with the room recording. When a replay draft is created, VOXA copies the transcript, speaker identity, and timestamps into the replay episode transcript; if the draft already exists, later transcript batches update it. Configure matching ingestion secrets on the worker and API. Recording consent is required to start recording; transcription notices and retention policy must also be communicated before production rollout.
