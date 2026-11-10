# VOXA

VOXA is a global audio, video, podcast, creator, and community platform. The product direction includes on-demand podcasts, creator channels, live audio/video rooms, audience participation, virtual gifts, memberships, short-form clips, and a multi-sided creator economy.

> **Status:** Early engineering foundation. This repository is not a production-ready service. Live media, authentication, payments, wallet settlement, moderation operations, and deployment integrations require implementation, provider configuration, security review, and testing.

## Product pillars

- **Listen & watch:** discover, follow, save, and resume podcasts and episodes.
- **Create:** publish audio/video episodes, schedule events, manage a creator profile.
- **VOXA LIVE:** host audio/video broadcasts; invite co-hosts; allow audience members to request the stage; support moderated chat, reactions, polls, Q&A, recording, and replays.
- **Community:** creator communities, episode discussions, memberships, notifications, and sharing.
- **Creator economy:** subscriptions, paid memberships, tips, virtual gifts, ticketed events, sponsorships, and advertising.
- **VOXA Moments:** creator-approved short clips from eligible episodes and live recordings.

## Repository layout

- `apps/mobile` — Expo / React Native client foundation.
- `apps/api` — NestJS API foundation.
- `packages/contracts` — shared API/event contracts (planned).
- `infra` — local development dependencies.
- `docs` — product, architecture, live, security, and delivery specifications.

## Local prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose
- PostgreSQL 16 and Redis 7 (or use `infra/docker-compose.yml`)

## Development status

This first commit establishes product and technical foundations. It deliberately does not pretend that simulated screens are connected to real streaming, AI, money movement, or user accounts. See [the implementation roadmap](docs/ROADMAP.md) for phased delivery and acceptance criteria.

## Core technical direction

- Mobile: Expo + React Native + TypeScript
- API: NestJS + TypeScript
- Data: PostgreSQL + Prisma
- Cache / ephemeral state: Redis
- Live media: LiveKit / WebRTC SFU (provider integration to be implemented)
- Media storage: S3-compatible object storage + CDN
- Observability: structured logs, metrics, traces, and audit events

## Security baseline

Never trust client-side wallet balances, gift purchases, creator earnings, moderation decisions, or payment status. Financial events must be verified server-side and recorded in an immutable, auditable ledger. Do not commit secrets or production credentials.


## Step 1 — API authentication foundation

The API now includes initial email/password registration and login endpoints:

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/health`
- `GET /v1/catalog/episodes`

Passwords are hashed with bcrypt. Access tokens are signed JWTs with a short 15-minute lifetime. This is an initial development foundation, not a complete production identity system: refresh-token rotation, email verification, password reset, MFA, abuse throttling, account recovery, and security testing remain required before launch.

### Run the API locally

1. Install Node.js 20+ and pnpm 9+.
2. Copy `apps/api/.env.example` to `apps/api/.env` and replace the JWT secret with a long random value.
3. Start PostgreSQL and Redis with `docker compose -f infra/docker-compose.yml up -d`.
4. Install workspace dependencies with `pnpm install`.
5. Generate Prisma Client with `pnpm --filter @voxa/api prisma:generate`.
6. Apply the Prisma schema to your local database with `pnpm --filter @voxa/api prisma:migrate`.
7. Start the API with `pnpm dev:api`.

Do not use the sample local database password or example JWT secret in production.

## Step 2 — Creator profiles and follows

Initial creator endpoints are available:

- `POST /v1/creators/me` — create a creator profile for the authenticated account.
- `GET /v1/creators/:handle` — view a public creator profile and follower/show counts.
- `POST /v1/creators/:handle/follow` — follow a creator (requires Bearer token).
- `DELETE /v1/creators/:handle/follow` — unfollow a creator (requires Bearer token).

Creator handles are normalized to lowercase. A user cannot follow their own creator profile. Follow requests are idempotent. Creator onboarding changes the account role within a database transaction.

Example creator onboarding request:

```http
POST /v1/creators/me
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "handle": "myshow",
  "bio": "Conversations about faith, culture, and ideas."
}
```

The API is still an early foundation. Add refresh-token rotation, email verification, password recovery, request throttling, automated tests, and full deployment configuration before production use.

## Step 3 — Podcast publishing and playback foundation

Creator publishing and listener library endpoints:

- `POST /v1/shows` — create a show (creator authentication required).
- `PATCH /v1/shows/:showId` — update an owned show.
- `POST /v1/shows/:showId/episodes` — create a draft episode.
- `PATCH /v1/shows/:showId/episodes/:episodeId` — update an owned episode.
- `POST /v1/shows/:showId/episodes/:episodeId/publish` — publish an episode once required metadata and a media key exist.
- `GET /v1/shows/:showId` — public show and published episodes.
- `GET /v1/episodes/:episodeId` — public published episode detail.
- `PUT /v1/episodes/:episodeId/bookmark` and `DELETE /v1/episodes/:episodeId/bookmark` — save/remove a bookmark (authentication required).
- `GET /v1/me/bookmarks` — list the authenticated listener's saved episodes.
- `PUT /v1/episodes/:episodeId/progress` — save playback position (authentication required).
- `GET /v1/me/playback-progress` — list recent playback progress (authentication required).

Playback progress is bounded by the episode duration when known. Draft and archived content is not exposed through public show/episode endpoints. The media key is metadata only at this stage: upload signing, transcoding, malware/content checks, CDN delivery, and playback authorization are not yet connected. Configure a trusted media pipeline before accepting real uploads or serving production media.


## Step 4 — Media storage integration

Configure an S3-compatible bucket (AWS S3, Cloudflare R2, or MinIO) using the `S3_*` variables in `apps/api/.env.example`. The API never receives the media bytes: it issues a short-lived signed PUT URL so the client uploads directly to object storage.

- `POST /v1/shows/:showId/episodes/:episodeId/upload-url` — authenticated creator requests a signed upload URL. Body: `{ "contentType": "audio/mpeg", "sizeBytes": 12000000 }`.
- Client uploads bytes to the returned `uploadUrl` with HTTP PUT and the returned `Content-Type` header.
- `POST /v1/shows/:showId/episodes/:episodeId/complete-upload` — authenticated creator confirms upload. Body: `{ "objectKey": "users/.../episodes/.../....mp3" }`. API checks object existence, type, size, and owner metadata before attaching it to the draft episode.
- `GET /v1/episodes/:episodeId/playback-url` — returns a short-lived signed GET URL for a published episode.

Upload URLs expire quickly; object keys are scoped to the authenticated user and episode. Configure bucket CORS to allow PUT from your web/mobile app origins and keep the bucket private. Set lifecycle rules and CDN/cache policy deliberately. Do not expose storage credentials in client apps.

**Production gaps:** this foundation does not yet transcode media, generate adaptive bitrate HLS/DASH renditions, scan files for malware, inspect actual codecs/duration, moderate content, or integrate a CDN. The client-supplied duration remains untrusted until a media-processing worker is added. Production release must add those controls, plus storage lifecycle/cleanup for abandoned uploads.


## Step 5 — Discovery and media-pipeline hardening

Public discovery endpoints now provide cursor-paginated, published-only content:

- `GET /v1/discovery/shows?q=&category=&language=&cursor=&limit=` — search shows by title, description, or creator handle.
- `GET /v1/discovery/episodes?q=&category=&language=&cursor=&limit=` — search published episodes and filter through their show's category/language.
- `GET /v1/discovery/categories` — list categories that currently contain published episodes.

The page size is capped at 50. Results are ordered newest-first; this is not yet a personalized or popularity-ranked recommendation engine. Search currently uses PostgreSQL case-insensitive substring matching; production search should move to a dedicated search index as catalogue size grows.

**Upload security correction:** episode creation and editing no longer accept a client-supplied `mediaKey`. Media keys are attached only through the authenticated signed-upload completion flow.

**Media processing status:** uploads are stored and can be served through short-lived signed URLs, but transcoding and validation are not falsely marked as complete. The next media milestone must add a durable processing-job state machine and worker (probe actual codecs/duration, malware scan, transcode to adaptive HLS/DASH, generate thumbnails/waveforms, and publish only after successful validation). Until that worker is deployed, creator-supplied duration metadata must not be treated as verified and this API is not ready for production media traffic.


## Step 6 — Media asset processing state

The database now tracks each uploaded media object as a `MediaAsset` with durable states:

- `UPLOADED` — object storage upload was confirmed.
- `QUEUED` — accepted by a processing queue (queue integration is not yet enabled).
- `PROCESSING` — a worker has claimed the asset.
- `READY` — validation and output generation have succeeded.
- `FAILED` — processing failed and needs retry or review.

The upload completion endpoint now creates/updates a `MediaAsset` record and returns its processing state. The migration is in `apps/api/prisma/migrations/20261110160000_media_asset_processing`.

**Important boundary:** this commit adds durable processing state, not a functioning transcoder. There is no deployed FFmpeg worker, Redis/BullMQ queue, malware scanner, HLS/DASH packager, or CDN output yet. An asset remains `UPLOADED` until a real worker processes it. Do not advertise production-ready media processing or mark assets `READY` manually.


## Step 7 — VOXA LIVE / LiveKit authorization foundation

Initial live-room API routes are now available:

- `GET /v1/live/rooms` — list public live and scheduled rooms.
- `POST /v1/live/rooms` — create a room (authentication required).
- `POST /v1/live/rooms/:roomId/join-token` — issue a short-lived LiveKit participant token.
- `POST /v1/live/rooms/:roomId/end` — host ends the room and LiveKit disconnects all participants.
- `POST /v1/live/rooms/:roomId/stage-requests` — request to join the speaker stage.
- `POST /v1/live/rooms/:roomId/stage-requests/:requestId/approve` — host approves a speaker.
- `POST /v1/live/rooms/:roomId/stage-requests/:requestId/reject` — host rejects a speaker.

Configure `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in `apps/api/.env`. The API secret must remain server-side. Tokens expire after ten minutes. The host and approved speakers receive publish permission; audience members receive subscribe-only permissions. A room becomes LIVE when the host requests a join token.

The database now enforces one stage request per participant per room. Apply the migration with the documented Prisma migration workflow.

**Not production complete:** a real LiveKit project and credentials are required. The web/mobile LiveKit client, chat, reactions, moderator roles, stage capacity limits, room ending, recording/replay, restricted-room entitlements, abuse throttling, and automated integration tests remain to be built. Members-only and private rooms reject non-host participants until entitlement checks are implemented.
