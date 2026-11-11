# VOXA

VOXA is being built as a global podcast, audio/video, creator, live-conversation and community platform. The product direction includes on-demand shows, live rooms, creator communities, VOXA Moments, memberships, and a global creator economy.

> **Current status: early functional web/API MVP, not production-ready.** The repository now contains real authentication, creator and podcast APIs, a web listening journey, a Creator Studio upload/publish flow, a LiveKit-connected web room client, in-app notifications, and a GHS Paystack membership/ledger/payout foundation. Production identity security, media processing, trust-and-safety operations, mobile device verification, several social features, deployment, and real-provider staging verification remain incomplete.

## Repository structure

- `apps/api` — NestJS API, Prisma schema/migrations, auth, creator, show/episode, media, LIVE, notification, membership, ledger and payment modules.
- `apps/web` — Next.js web application and browser clients.
- `apps/mobile` — Expo / React Native Android and iOS application.
- `infra` — local PostgreSQL and Redis development services.
- `docs` — product, architecture, security, LIVE, financial and operational plans.

The native mobile application is now scaffolded under `apps/mobile` with authentication, discovery, audio playback, communities, creator show creation, and LiveKit room entry. It still needs dependency installation, native device builds, and end-to-end verification.

## Implemented product journeys

### Listener and podcast experience

- Discover published shows and episodes, search, and filter by available categories.
- Open public show pages and episode detail pages.
- Play uploaded audio or video through native browser controls.
- Save/bookmark episodes.
- Save playback position and resume unfinished episodes when signed in.
- Access a personal library at `/library`.

### Creator experience

- Create a creator profile at `/creator/setup`.
- View a public creator profile at `/creator/[handle]`.
- Create show and episode drafts in Creator Studio at `/creator/studio`.
- Create GHS monthly membership plans and mark eligible episodes as members-only from Creator Studio.
- Request a signed media upload URL, upload directly to S3-compatible storage, and confirm the upload.
- Publish a show and then publish an episode once its required metadata and media are attached.
- View creator earnings at `/creator/earnings`.

### VOXA LIVE

- Live room discovery and room creation.
- LiveKit browser SDK connection, microphone/camera controls, and host/audience token permissions.
- Audience stage requests, host approval/rejection, speaker removal and room ending.
- Room-scoped ephemeral chat and reactions over LiveKit data channels.

LIVE is not yet a fully moderated broadcast product: moderator roles, reliable presence, chat moderation, capacity controls, recording/replays, scheduled-room orchestration and extensive real-device/load testing remain outstanding.

### Other web routes

- `/` — VOXA landing page
- `/discover` — podcast discovery
- `/shows/[showId]` — public show page
- `/episodes/[episodeId]` — audio/video episode player
- `/library` — bookmarks and listening progress
- `/creator/setup` — creator onboarding
- `/creator/[handle]` — public creator page
- `/creator/studio` — show/episode management
- `/creator/earnings` — creator earnings
- `/live` and `/live/[roomId]` — LIVE discovery and room
- `/notifications` — persisted in-app inbox
- `/admin/finance` — admin finance console
- `/payment/complete` — payment return/status page

## API capabilities

The API uses the global `/v1` prefix. Core endpoint groups include:

- Authentication: `POST /v1/auth/register`, `POST /v1/auth/login`.
- Creators: `POST/PATCH /v1/creators/me`, `GET /v1/creators/:handle`, follow/unfollow.
- Podcast: show and episode draft, publish, public reads, discovery, bookmarks and playback progress.
- Media: signed upload URL, upload completion, public/member playback URL.
- LIVE: rooms, join tokens, stage requests and host stage controls.
- Notifications: inbox, mark read, mark all read.
- Memberships: creator-owned plan listing/creation, checkout, subscriptions and membership-gated episode access.
- Finance: earnings, payout destinations, payout requests, admin review/approval/submission/reconciliation and finance overview.

See the relevant controllers under `apps/api/src` and the operational documents under `docs` for request shapes and safeguards.

## Creator membership and financial model

The current membership checkout foundation is **GHS-only and one-time monthly**, through Paystack. It does not auto-renew.

- VOXA platform commission: **15% of membership gross**.
- Creator entitlement: **85% of membership gross before provider fees**.
- Provider processing fees are booked separately as VOXA/platform expenses; they are not deducted from the creator's 85%.
- Successful creator earnings have a **seven-day settlement hold** before release to available earnings.
- The scheduled settlement worker processes up to 100 matured payments per batch and uses a PostgreSQL advisory lock plus per-payment ledger idempotency.
- Creator payout requests reserve available funds in a separate payout-hold account. Admin verification/review and Paystack transfer submission/reconciliation foundations exist.

**All real payout execution remains gated.** Keep `PAYSTACK_TRANSFERS_ENABLED=false`, `PAYSTACK_PAYOUT_EXECUTION_ENABLED=false`, and `SETTLEMENT_WORKER_ENABLED=false` until Paystack business approval, staging verification, operational monitoring and reconciliation controls are complete. No real merchant transaction or payout was performed as part of repository development.

## Local development

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose
- PostgreSQL 16 and Redis 7 (or the local Compose services)

### Start the API

1. Copy `apps/api/.env.example` to `apps/api/.env`.
2. Configure a strong random `JWT_SECRET` (at least 32 characters) and local `DATABASE_URL`.
3. Start local services: `docker compose -f infra/docker-compose.yml up -d`.
4. Install dependencies from the repository root: `pnpm install`.
5. Generate Prisma Client: `pnpm --filter @voxa/api prisma:generate`.
6. Apply migrations using the documented local/staging migration process.
7. Start the API: `pnpm dev:api`.

### Start the web app

1. Copy `apps/web/.env.example` to `apps/web/.env.local`.
2. Set `NEXT_PUBLIC_VOXA_API_URL` to the API base URL including `/v1`.
3. Add the web origin to API `CORS_ORIGINS`.
4. Start the web app: `pnpm --filter @voxa/web dev`.
5. Open the local URL shown by Next.js (typically `http://localhost:3001`).

### Storage and LiveKit

For media upload/playback, configure the API server's `S3_*` variables and the bucket CORS policy for the deployed web origin. Keep the bucket private. See [Media Operations](docs/MEDIA_OPERATIONS.md).

For VOXA LIVE, configure `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` on the API server. Never expose the LiveKit API secret in browser variables.

## CI and verification

GitHub Actions workflow `.github/workflows/api-ci.yml` currently performs:

1. Frozen pnpm dependency installation using the committed `pnpm-lock.yaml`.
2. Prisma schema validation and Prisma Client generation.
3. API and web TypeScript typechecking.
4. API unit tests.
5. API build.
6. Web build.

A successful CI run verifies schema/build/typecheck/tests; it does **not** replace database-backed integration tests, real-provider staging tests, browser end-to-end tests, security review or production deployment verification.

## Security and production limitations

- Authentication is still MVP-grade. Browser access tokens currently use `sessionStorage`; refresh-token rotation, secure HTTP-only cookie sessions, email verification, password recovery, MFA, device/session revocation and rate limiting remain to be implemented.
- Initial administrator creation is an operator-run one-time script: from `apps/api`, run `pnpm admin:bootstrap` with `DATABASE_URL`, `VOXA_BOOTSTRAP_ADMIN_EMAIL` and `VOXA_BOOTSTRAP_ADMIN_PASSWORD` set securely. It refuses to create a second administrator or promote an existing account. Never expose this as a public endpoint.
- Media upload currently checks declared MIME type, object metadata and size. It does not inspect file signatures/codecs, scan malware, moderate content, transcode, create adaptive HLS/DASH renditions or deliver through a configured CDN. Uploaded originals are served through short-lived signed URLs.
- Notifications are persisted in the inbox; push and email delivery are not implemented.
- No automated end-to-end tests, load tests, penetration tests, backup/restore drills, incident alerting or production observability are included yet.
- Report/block/mute/ban/appeal workflows, copyright takedowns, age controls, community discussions, VOXA Moments, gifts, tips, wallets, ticketing, ads, sponsorships, and AI recommendations remain future work.
- The mobile app is a first native foundation; push notifications, background audio validation, app-store signing, offline caching, and full-device QA remain outstanding.

Do not commit provider credentials, production database URLs, signing secrets, or other secrets to Git. Store them only in the hosting provider's encrypted secret/environment settings.

## Project documents

- [Full build audit and staged implementation plan](docs/BUILD_AUDIT.md)
- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [VOXA LIVE design](docs/VOXA_LIVE.md)
- [Security and compliance](docs/SECURITY_AND_COMPLIANCE.md)
- [Financial operations](docs/FINANCIAL_OPERATIONS.md)
- [Media operations](docs/MEDIA_OPERATIONS.md)
- [Roadmap](docs/ROADMAP.md)

VOXA is being developed in deliberate stages: stabilize and test the foundation, complete the podcast journey, harden LIVE, build community/mobile, expand creator commerce, then scale and prepare for a controlled launch.

## Mobile application

The Expo app lives in `apps/mobile`. See [Mobile README](apps/mobile/README.md) for setup. It is an independent npm-installed native workspace; install its dependencies from that directory, configure `EXPO_PUBLIC_VOXA_API_URL`, then run Expo. LiveKit requires a native development build and cannot run inside Expo Go.

- The native app now includes creator episode drafts, signed media upload, publishing controls, community discussions/replies, and live stage moderation. Apply the `20261111260000_community_post_comments` migration before using community replies.


## Trust & Safety
VOXA includes authenticated reports for episodes, VOXA Moments, live rooms, community posts, and accounts. Moderators and administrators can review reports and apply audited content/account actions. Users can block and unblock accounts; blocked users are filtered from community discussions and live chat; blocking a live host prevents chat participation in that host's room. Mobile includes report actions, blocked-account management, and a role-gated moderation queue. Apply migrations `20261111280000_mobile_safety_moderation` and `20261111290000_community_post_moderation` before using these workflows. Reports are non-punitive until a moderator reviews them.


## Web Creator Studio
The web Creator Studio provides a consolidated creator workspace for show and episode publishing, media processing, transcript and chapter editing, creator audience tools, analytics, and VOXA LIVE session management. The studio overview shows owned shows, published episodes, drafts, and live/scheduled sessions. Creators can open a live room from the dashboard to manage stage requests, speakers, chat, recording, and audience interactions. Published episodes can be returned to draft using the authenticated unpublish endpoint. The authenticated `GET /live/rooms/me` endpoint lists only the current creator's live rooms for this dashboard.


## Web Community Experience
The web community area supports community discovery and search, community creation with optional artwork, joining and leaving, member-only discussion feeds, post creation, threaded replies, and reporting community posts. Public community detail responses contain community metadata and counts only; discussion content is retrieved through the authenticated membership-protected posts endpoint. Community owners can manage their members from Creator Audience. Authorized moderators can use `/admin/community-moderation` to review community-post reports, hide reported posts, dismiss reports, and restore previously hidden posts.
