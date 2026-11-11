# VOXA

VOXA is being built as a global podcast, audio/video, creator, live-conversation and community platform. The product direction includes on-demand shows, live rooms, creator communities, VOXA Moments, memberships, and a global creator economy.

> **Current status: integrated development build; not production-ready.** The full-stack integration candidate combines podcast publishing/playback, creator and listener journeys, VOXA Moments, live rooms, replay, account profile/session controls, email verification, password recovery and TOTP MFA. Its combined GitHub CI checks have passed, including API/web typechecks, API unit tests, production builds and the media-worker image build. This does not yet prove database migration deployment, browser end-to-end behavior, real-provider staging, or production operation. See [the integration and staging verification plan](docs/INTEGRATION_TEST_PLAN.md).

## Repository structure

- `apps/api` — NestJS API, Prisma schema/migrations, auth, creator, show/episode, media, LIVE, notification, membership, ledger and payment modules.
- `apps/web` — Next.js web application and browser clients.
- `infra` — local PostgreSQL and Redis development services.
- `docs` — product, architecture, security, LIVE, financial and operational plans.

There is **no mobile app source tree yet** and no shared contracts package yet. Those are future milestones, not completed foundations.

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
- Room-scoped persistent chat and reactions, audience presence, reconnect recovery, signed LiveKit webhook lifecycle, and host-controlled recording/replay foundations.

Recording remains feature-flagged and needs explicit participant consent controls and real Egress/S3 staging verification.

LIVE is not yet a fully moderated broadcast product: moderator roles, reliable presence, chat moderation, capacity controls, recording/replays, scheduled-room orchestration and extensive real-device/load testing remain outstanding.

### Other web routes

- `/` — VOXA landing page
- `/discover` — podcast discovery
- `/shows/[showId]` — public show page
- `/episodes/[episodeId]` — audio/video episode player
- `/library` — bookmarks and listening progress
- `/following` — followed creators
- `/history` — listening history
- `/moments` — VOXA Moments
- `/replays` — published live replays
- `/settings/profile` and `/settings/security` — account and MFA settings
- `/forgot-password`, `/reset-password`, `/verify-email` — account recovery and verification
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

- Authentication: registration/login, rotating refresh-token sessions, logout/current-all-session revocation, email verification, password recovery, TOTP MFA and one-time backup codes.
- Account security: profile/password updates and authenticated session listing/revocation.
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
3. Media-worker syntax validation and isolated Docker image build.
4. API and web TypeScript typechecking.
5. API unit tests.
6. API and web production builds.

The current full-stack integration candidate is PR #27 (`integration/full-stack`); its two latest CI runs completed successfully. The PR remains a draft and has not been merged to `main`.

A successful CI run verifies schema/build/typecheck/tests; it does **not** replace database-backed integration tests, real-provider staging tests, browser end-to-end tests, security review or production deployment verification.

## Security and production limitations

- Authentication now includes short-lived browser access tokens, hashed rotating refresh sessions in HttpOnly cookies, replay rejection, session revocation, trusted-origin checks, process-local login/registration throttling, email verification, password recovery, TOTP MFA and one-time backup codes. Shared rate limiting across API replicas and full staging security verification remain outstanding.
- Initial administrator creation is an operator-run one-time script: from `apps/api`, run `pnpm admin:bootstrap` with `DATABASE_URL`, `VOXA_BOOTSTRAP_ADMIN_EMAIL` and `VOXA_BOOTSTRAP_ADMIN_PASSWORD` set securely. It refuses to create a second administrator or promote an existing account. Never expose this as a public endpoint.
- Media upload and processing now include ownership/metadata/signature checks, a separate worker, malware scanning, FFprobe inspection and FFmpeg MP3 or H.264/AAC MP4 processing. The worker is packaged and CI-built but has not yet been deployed and verified against real staging storage and media. Adaptive HLS/DASH, CDN delivery, thumbnails, transcripts, content moderation and copyright workflows remain outstanding.
- Notifications are persisted in the inbox; push and email delivery are not implemented.
- Database-backed migration deployment from an empty database, browser end-to-end tests, load/penetration tests, backup/restore drills, incident alerting and production observability remain outstanding. The migration baseline must be established before claiming that a fresh database can be initialized from migration history.
- Report/block/mute/ban/appeal workflows, copyright takedowns, age controls, community discussions, VOXA Moments, gifts, tips, wallets, ticketing, ads, sponsorships, and AI recommendations remain future work.
- There is no mobile application yet.

Do not commit provider credentials, production database URLs, signing secrets, or other secrets to Git. Store them only in the hosting provider's encrypted secret/environment settings.

## Project documents

- [Full build audit and staged implementation plan](docs/BUILD_AUDIT.md)
- [Integration and staging verification plan](docs/INTEGRATION_TEST_PLAN.md)
- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [VOXA LIVE design](docs/VOXA_LIVE.md)
- [Security and compliance](docs/SECURITY_AND_COMPLIANCE.md)
- [Financial operations](docs/FINANCIAL_OPERATIONS.md)
- [Media operations](docs/MEDIA_OPERATIONS.md)
- [Roadmap](docs/ROADMAP.md)

VOXA is being developed in deliberate stages: stabilize and test the foundation, complete the podcast journey, harden LIVE, build community/mobile, expand creator commerce, then scale and prepare for a controlled launch.
