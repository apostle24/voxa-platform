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
- `apps/web` — Next.js web client foundation (landing page, account sign-in/registration, LIVE discovery, room controls).
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
- `POST /v1/live/rooms/:roomId/speakers/:speakerId/remove` — host removes an approved speaker and disconnects them from LiveKit.
- `POST /v1/live/rooms/:roomId/stage-requests` — request to join the speaker stage.
- `POST /v1/live/rooms/:roomId/stage-requests/:requestId/approve` — host approves a speaker.
- `POST /v1/live/rooms/:roomId/stage-requests/:requestId/reject` — host rejects a speaker.

Configure `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in `apps/api/.env`. The API secret must remain server-side. Tokens expire after ten minutes. The host and approved speakers receive publish permission; audience members receive subscribe-only permissions. A room becomes LIVE when the host requests a join token.

The database now enforces one stage request per participant per room. Apply the migration with the documented Prisma migration workflow.

**Not production complete:** a real LiveKit project and credentials are required. The web/mobile LiveKit client, chat, reactions, moderator roles, stage capacity limits, room ending, recording/replay, restricted-room entitlements, abuse throttling, and automated integration tests remain to be built. Members-only and private rooms reject non-host participants until entitlement checks are implemented.


## Web client (early MVP)

The Next.js app lives in `apps/web`.

1. Copy `apps/web/.env.example` to `apps/web/.env.local`.
2. Set `NEXT_PUBLIC_VOXA_API_URL` to the API base URL, including `/v1`.
3. Add the web origin to the API's `CORS_ORIGINS` setting.
4. Install workspace dependencies from the repository root with `pnpm install`.
5. Start the web client with `pnpm --filter @voxa/web dev`.
6. Open `http://localhost:3001` (or the port shown by Next.js).

The client includes email/password sign-in and registration, public live-room discovery, room creation, LiveKit connection, microphone/camera controls, audience stage requests, host approval/rejection, and speaker removal. The current MVP stores its short-lived access token in `sessionStorage`; this is a development convenience, not the production session design. Add secure HTTP-only cookie sessions, refresh-token rotation, CSRF protection, and rate limiting before production.

The live room UI refreshes stage state periodically. It does not yet include real-time chat, reactions, audience counts from LiveKit, moderator roles, recording, replay, or complete accessibility and device-selection controls. LiveKit credentials, a working API/database deployment, and browser microphone/camera permissions are required for an actual broadcast.

### Live chat and reactions (early MVP)

The room UI now sends chat messages and emoji reactions over LiveKit's reliable data channel. This is room-scoped and ephemeral: messages are not persisted, are not available as replay history, and are not independently moderated by a server-side chat service yet. Keep LiveKit data publishing enabled for participants. Before a public launch, add server-enforced message rate limits, spam and abuse detection, user blocking/reporting, host/moderator message controls, durable audit records, and retention/privacy rules. Existing host stage controls can remove speakers, but they do not constitute full chat moderation.

### Creator community and notifications (early MVP)

- Creator onboarding is available at `/creator/setup`; public creator pages are available at `/creator/{handle}`.
- Creator pages show the creator bio, published shows, and currently live public rooms. Signed-in listeners can follow and unfollow creators.
- A creator receives an inbox notification when a new follower arrives.
- Followers receive an inbox notification when a creator starts a public live room.
- The notification inbox is available at `/notifications`. API routes: `GET /v1/notifications`, `PATCH /v1/notifications/:notificationId/read`, and `PATCH /v1/notifications/read-all`.
- Notifications are stored in PostgreSQL. Push delivery, email delivery, notification preferences, pagination beyond the latest 50, and realtime unread-count updates are not implemented yet.
### Creator memberships and premium episodes (foundation)

- Creators can create and update monthly membership plans through `POST /v1/creators/me/membership-plans` and `PATCH /v1/creators/me/membership-plans/:planId`.
- Public visitors can list active plans with `GET /v1/creators/:handle/membership-plans`.
- Creators can restrict an episode with `PATCH /v1/shows/:showId/episodes/:episodeId/membership` and body `{ "membershipRequired": true }`. An active membership plan must exist first.
- Listeners can inspect their membership records at `GET /v1/me/memberships`; creators can inspect their subscriber records at `GET /v1/creators/me/memberships`.
- Premium playback uses `GET /v1/episodes/:episodeId/member-playback-url` with a valid Bearer token. The API checks for an ACTIVE subscription whose paid period has not expired. The public playback URL refuses premium episodes.
- Prices are stored as integer minor currency units (for example, 1299 means 12.99 in a two-decimal currency). Currency is an ISO-style three-letter uppercase code. No client-supplied amount is used to authorize access.

**Important payment boundary:** there is no checkout provider, verified webhook, subscription activation/cancellation workflow, refund flow, or payout integration yet. Subscription records remain PENDING unless a future verified provider integration activates them; do not manually mark a user ACTIVE from the client. Membership plan configuration is not the same as accepting payments.

### Financial ledger foundation

The database now has ledger accounts, immutable transaction/entry records, unique idempotency keys, and a server-side balanced-transfer service. A transfer creates matching debit and credit entries in one database transaction and rejects reuse of an idempotency key with different transfer details. No public wallet-balance mutation or payout endpoint exists. Wallet balances must be derived from ledger entries; never trust client-side balances.

**Still required before real money:** payment-provider selection and country support checks, signed webhook verification, webhook event deduplication, reconciliation, refunds/chargebacks, payout onboarding/KYC, tax and consumer-law review, fraud controls, operational monitoring, and financial/security testing.


### Paystack membership checkout (GHS pilot foundation)

- Authenticated listeners can start checkout with `POST /v1/memberships/checkout` and `{ "planId": "..." }`. The API reads the plan price and currency from PostgreSQL; clients cannot submit an amount.
- This initial provider path accepts GHS plans only and creates a one-time payment for one month of access. It does not create automatic recurring card charges.
- Configure `PAYSTACK_SECRET_KEY` on the API server and set `PAYSTACK_CALLBACK_URL` to the frontend's payment-return page. Never expose the secret to the browser.
- Configure Paystack to send webhooks to `POST /v1/webhooks/paystack`. The API verifies the HMAC SHA-512 signature against the raw request body, then independently verifies the transaction with Paystack before activating membership.
- Successful payments are recorded as idempotent webhook events, activate/extend the membership period, and create matching ledger debit/credit entries. Replayed success events do not create a second membership credit.
- Creators can view ledger-derived pending/available balances and recent transactions at `GET /v1/creators/me/earnings`; the web dashboard is `/creator/earnings`. Listeners can view their payment attempts at `GET /v1/me/payments`.
- Payment attempts, webhook payloads, and ledger entries are retained for audit. No creator withdrawal or payout API is enabled.

**Before production:** run the new Prisma migration against a disposable/staging database; configure Paystack test credentials and webhook URL; test success, failed, duplicate, amount-mismatch, currency-mismatch, and invalid-signature cases; confirm your Paystack merchant account's Ghana eligibility, supported payment channels, settlement rules, fees, refunds and chargeback processes. Current checkout is a GHS one-time monthly pass only. Automatic renewal, mobile-money recurring charges, cross-currency conversion, platform fees and creator payouts are not implemented.
