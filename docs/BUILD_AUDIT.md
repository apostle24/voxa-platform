# VOXA Build Audit — 11 November 2026

## Audit identity and evidence

- Repository: `apostle24/voxa-platform`
- Branch: `main`
- Audited HEAD: authentication session rotation merged at `1cdb56abd370c2e2cffea5a0a4e866e201f74cb0`; account email/recovery work is in progress on a feature branch.
- Latest verified CI: [GitHub Actions run #257](https://github.com/apostle24/voxa-platform/actions/runs/42982097080) — **completed successfully**.
- Verified CI steps: frozen pnpm install, Prisma validation and generation, media-worker syntax check, isolated media-worker Docker image build, API/web typecheck, API unit tests, API build, web build.
- Repository inspection included the current recursive Git tree, README, product/architecture/roadmap docs, API and web package manifests, auth/live/media/payment implementation, worker script, environment examples, and current CI workflow.

A green CI run proves the checked-in code passes those automated checks. It does **not** prove production deployment, real database/object-storage/LiveKit/Paystack connectivity, browser end-to-end behavior, real media processing, live-room quality, or real-money movement. Those have not been represented as verified.

## Executive assessment

VOXA is an early functional web/API MVP with meaningful podcast, LIVE, creator and financial foundations. It is **not a finished global platform and is not production-ready**. The next priority is to verify and harden the existing end-to-end journeys, not to add a large number of unrelated features.

The current repository has:
- A pnpm monorepo with NestJS API and Next.js 15 / React 19 web client.
- PostgreSQL/Prisma schema and migrations.
- A current CI pipeline with typechecking, API tests, API/web builds, and a worker Docker build.
- 6 API Jest spec files.
- 15 Next.js page/layout route files.
- No `apps/mobile` source tree and no shared `packages/contracts` package.

## What is implemented in the current repository

### Listener and podcast journey
- Discovery page with published show/episode search and category filtering.
- Public show detail and episode detail routes.
- Browser audio/video playback through native controls.
- Bookmarks, playback progress and personal library/resume journey.
- Creator public profile pages.

### Creator journey
- Creator onboarding and profile editing.
- Creator Studio for show and episode drafts.
- Direct signed upload to S3-compatible storage.
- Upload completion checks object ownership metadata, content type, size and sampled file signature.
- Uploaded assets enter a processing queue; publishing and playback require a processed READY asset.
- Membership plan creation and members-only episode controls.
- Creator earnings page.

### Media processing foundation
- Separate Node worker at `apps/api/scripts/media-worker.cjs`.
- Worker claims queued assets, tracks attempts, renews processing leases, recovers stale leases and limits retries.
- ClamAV scan, FFprobe stream/duration inspection, FFmpeg MP3 or H.264/AAC MP4 transcode.
- Processed object upload to a separate storage key; asset becomes READY only after processed upload and database update.
- Dedicated Dockerfile, non-root runtime entrypoint, Compose deployment file and Docker CI build are committed.
- **Not yet verified:** deployed worker, real S3-compatible bucket, actual sample media through the complete pipeline, malware database operations under deployment, and playback in a browser using real processed assets.

### VOXA LIVE
- Live room creation and public room discovery.
- LiveKit browser SDK connection, microphone/camera controls and short-lived server-issued room tokens.
- Host/audience publishing permissions and speaker-stage state.
- Audience stage requests, host approve/reject, speaker removal and host room ending.
- Ephemeral room chat and reactions over LiveKit data channels.
- **Not yet a complete broadcast product:** application-backed durable chat, moderator roles, stage capacity, chat moderation, polls/Q&A, robust participant presence, token refresh/reconnect handling, recording/replay and load-tested room orchestration.

### Memberships, payments and finance
- GHS one-time monthly membership checkout foundation through Paystack.
- Signed webhook validation and independent provider transaction verification.
- Membership activation and extension.
- Double-entry ledger entries for gross collection, 15% VOXA commission and 85% creator pending entitlement.
- Provider fees are accounted separately as platform expenses, not deducted from the creator's 85%.
- Seven-day settlement hold and optional scheduled settlement worker.
- Creator earnings/history, payout destination onboarding, payout request reservation and admin finance console.
- Admin destination verification, payout review/approval, gated transfer submission and provider reconciliation foundations.
- Transfer feature flags default to disabled.
- **Not yet verified:** real merchant credentials, staging collection, live provider callbacks, approved Transfers access, real payout, bank reconciliation, refund/chargeback and fraud operations.

### Notifications and administration
- Persisted in-app inbox and read/unread actions.
- Follow and creator-live notification records.
- Admin finance overview, payout review and financial audit records.
- Push/email delivery and a broad trust-and-safety operations console are not built.

## Current web routes

- `/` — landing
- `/login` — authentication
- `/discover` — podcast discovery
- `/shows/[showId]` — show detail
- `/episodes/[episodeId]` — episode playback
- `/library` — saved and unfinished listening
- `/creator/setup` — creator onboarding
- `/creator/[handle]` — public creator profile
- `/creator/studio` — creator publishing studio
- `/creator/earnings` — creator earnings
- `/live` and `/live/[roomId]` — LIVE discovery and room
- `/notifications` — notification inbox
- `/admin/finance` — finance console
- `/payment/complete` — payment return/status

## Automated verification currently present

Six API Jest spec files exist:
- `auth/auth.service.spec.ts`
- `auth/auth-rate-limit.guard.spec.ts`
- `ledger/ledger.service.spec.ts`
- `live/live.service.spec.ts`
- `media/media.service.spec.ts`
- `memberships/memberships.service.spec.ts`
- `shows/shows.service.spec.ts`

The tests cover selected service behavior and safety boundaries. There is no web browser E2E suite, no API integration suite backed by a real test database, and no dedicated payments/payout service test file in the current tree. The successful CI run is therefore useful but not a substitute for full product verification.

## Findings and remaining risks

### P0 — must be addressed before public production launch

1. **Authentication/session security is being hardened, but is not yet production-complete.** The current implementation adds 15-minute access tokens, 30-day refresh JWTs stored only as SHA-256 hashes in PostgreSQL, HttpOnly refresh cookies, single-use atomic refresh rotation, replay rejection, current/all-session revocation, trusted-Origin checks for cookie endpoints, and a process-local 10-attempt/15-minute IP limiter on login/registration. The web client retries one 401 after refreshing. The session-rotation implementation passed CI and was merged. Email verification and password recovery are implemented on the current feature branch, pending CI and review. Registration sends a verification link; hashed one-time tokens expire (24 hours for verification, 30 minutes for password reset), reset revokes all active refresh sessions, and Resend delivery requires production configuration. Email verification is recorded but is not yet enforced as a sign-in gate. MFA, device/session management UI, and shared rate limiting across API replicas remain outstanding.
2. **No full end-to-end product verification.** Automated browser tests and database-backed integration tests are absent. The primary listener, creator, live and payment journeys need repeatable tests.
3. **External integrations are not production-verified.** Database, S3, LiveKit and Paystack credentials/deployments have not been used for verified staging journeys. Payment and payout flags must remain disabled until provider approval and staging verification.
4. **Media worker is packaged, not operationally proven.** It has not been deployed and exercised against real files, object storage and production-like worker limits. HLS/DASH, CDN delivery, thumbnails, transcripts, moderation and copyright controls remain absent.
5. **Trust and safety is incomplete.** Report, block, mute, ban, appeal, moderation queue, age controls, content/copyright workflows and abuse operations are not implemented.
6. **Financial risk controls are incomplete.** Payment/payout service test coverage, refunds, chargebacks, fraud/velocity controls, step-up authentication for payout changes, reconciliation reporting and operator alerting remain required before real money.

### P1 — high priority engineering work

1. Finish auth lifecycle: email verification, password recovery, MFA, session/device management UI, and shared ingress/API-gateway rate limiting; validate cookie/CORS settings against the deployed frontend/API domains.
2. Add payments and payout unit/integration tests for webhook idempotency, provider verification, ledger balance, reserve/release/reversal and ambiguous transfer outcomes.
3. Add database-backed integration tests for ownership, authorization, media and LIVE stage transitions.
4. Add browser E2E tests for registration → creator setup → show/episode upload → processing → publication → listener playback/bookmark/resume.
5. Test real media processing and improve worker observability, dead-letter handling, operator replay and cleanup.
6. Add robust LIVE moderator roles, stage capacity, participant presence, chat moderation, token refresh/reconnect and recording/replay.
7. Add API readiness checks that validate database dependency state; current health controller is a basic process-level endpoint.
8. Add structured logs, metrics, tracing, error reporting, alerts, backup retention and restore drills.
9. Add pagination, throttling, upload quotas and abandoned-upload cleanup where needed.
10. Add privacy export/deletion, terms, copyright and country-by-country compliance processes.

### P2 — product capabilities not yet built

- Persistent global player and playback queue.
- Background playback, offline downloads and casting.
- Adaptive HLS/DASH streaming and CDN delivery.
- Chapters, transcripts, captions and accessible playback.
- Community spaces, posts, discussions and member roles.
- VOXA Moments short-form video creation/feed.
- Gifts, tips, wallet/coins, ticketed events and consumer premium.
- Advertising and creator/brand sponsorship marketplace.
- AI transcripts, summaries, translation, smart clips and recommendations.
- Push and email notification delivery.
- Android and iOS applications.
- Global localization, regional delivery and creator analytics.

## Staged implementation plan and exit gates

### Stage 1 — repository audit and foundation stabilization (current)
- Keep the current successful CI baseline.
- Reconcile documentation against the current code.
- Fix verified defects and configuration drift.
- Expand test coverage around auth, ownership, media, LIVE, payments and ledger invariants.
- Add integration and browser E2E test foundations.
- Verify settlement worker locking and lifecycle in tests before enabling it.
- Preserve safe default-off flags for payouts and settlement scheduling.

**Exit gate:** CI validates schema/migrations, typechecks, runs relevant unit/integration tests, builds API/web/worker image, and the critical user journeys have automated coverage.

### Stage 2 — production-quality podcast experience
- Verify discovery, show/episode detail, upload, processing, publication and playback end to end.
- Add persistent player, queue, background playback and robust network recovery.
- Add adaptive streaming/CDN, thumbnails, chapters and transcript foundations.
- Improve creator studio statuses, validation and error recovery.

**Exit gate:** a creator can safely publish real audio/video and a listener can discover, play, save and resume it reliably on supported browsers/devices.

### Stage 3 — VOXA LIVE launch readiness
- Moderator roles and scoped permissions.
- Application-backed chat, moderation, reactions, presence and stage limits.
- Robust reconnect/token lifecycle and room state reconciliation.
- Recording consent, recording pipeline, replay processing and scheduled events.
- Real device/network and concurrent-room load testing.

**Exit gate:** moderated audio/video rooms work reliably across multiple participants and safely end/reconcile.

### Stage 4 — identity, trust, safety and community
- Secure sessions, verification, recovery, MFA and account controls.
- Report/block/mute/ban/appeal and moderation operations.
- Community spaces, discussions, announcements and member entitlements.
- Push/email notification delivery and privacy controls.

**Exit gate:** user identity, community participation and content safety have operational controls and tested workflows.

### Stage 5 — creator economy expansion
- Finish staging payments, payout verification and reconciliation.
- Refunds, chargebacks, fraud controls and payout risk management.
- Gift/tip wallets, ticketing and paid events only after ledger invariants are tested.
- Country/currency/provider capability matrix.
- Ads and sponsorship workflows after audience scale and policy readiness.

**Exit gate:** provider transactions, ledger, creator liabilities and payouts reconcile with auditable evidence.

### Stage 6 — VOXA Moments, AI, mobile and scale
- Rights-linked creator-approved clips and short-form feed.
- Search/recommendation ranking, multilingual tools and creator analytics.
- Android/iOS applications and shared API contracts.
- Observability, regional media delivery, SLOs, load/chaos/security testing.
- Legal/privacy review, support staffing and phased market rollout.

**Exit gate:** operational, legal, security, performance and support readiness are demonstrated for each launch market.

## Release safety switches

Keep these disabled until approved staging verification:
- `PAYSTACK_TRANSFERS_ENABLED=false`
- `PAYSTACK_PAYOUT_EXECUTION_ENABLED=false`
- `SETTLEMENT_WORKER_ENABLED=false` until worker concurrency tests, monitoring, deployment and database readiness checks are complete.

Never commit provider credentials, production database URLs, signing secrets or other secrets to Git. Store them only in encrypted deployment secrets/environment settings.
