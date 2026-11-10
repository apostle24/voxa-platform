# VOXA Build Audit — 10 November 2026

## Audit scope and confidence

Repository reviewed: `apostle24/voxa-platform`, branch `main`.
Audited HEAD: `67f8b5a9b8d18f4cbca5b9872432397fc48f9ac0`.
The latest application-code commit in the audited chain is `b50e69e00906a88a1348ac9f1beca0a4cc559d19`; the two later commits update settlement configuration and documentation.

GitHub Actions run [42918279049](https://github.com/apostle24/voxa-platform/actions/runs/42918279049) completed successfully. Dependency installation, Prisma validation, Prisma generation, API compilation, and web compilation all passed. This is build evidence only. No live database, provider account, object-storage bucket, LiveKit project, deployed environment, or end-to-end user journey was available to verify in this repository audit.

## Executive assessment

VOXA is an early but meaningful **web/API engineering foundation**, not a complete podcast/social platform and not production-ready. The strongest implemented areas are creator identity/profile foundations, podcast metadata APIs, a first LiveKit room-control/media connection path, in-app notifications, and a comparatively advanced GHS membership/ledger/payout workflow.

The main product experience is still incomplete. The repository contains no mobile app source, no shared contracts package, no automated test files, and only ten web page routes. Several large product pillars remain specification-only. The next stage should prioritize making the current core safe and demonstrably usable before adding more monetization or growth features.

## What exists now

### Repository and infrastructure
- pnpm monorepo with NestJS API and Next.js 15 / React 19 web client.
- PostgreSQL / Prisma schema and migrations.
- Docker Compose development dependencies (PostgreSQL and Redis).
- One GitHub Actions workflow that validates Prisma and builds API and web.
- Product, architecture, LIVE, security, roadmap, and finance documentation.

### API capabilities implemented in code
- Email/password registration and login; bcrypt password hashing; 15-minute JWT access tokens.
- Creator profile creation, update, public profile retrieval, follow/unfollow.
- Show and episode draft creation/update/publish APIs.
- Public show/episode reads, discovery API endpoints, bookmarks, playback progress.
- S3-compatible signed upload and playback URL foundation.
- Live room creation/listing, LiveKit access tokens, stage requests, host approval/rejection, speaker removal, room ending.
- Persisted in-app notification inbox and read/unread actions.
- Membership plan create/update/list and subscriber/creator membership reads.
- Paystack GHS one-time monthly membership checkout and signed webhook verification.
- Double-entry ledger postings for membership gross, 15% VOXA commission, 85% creator pending earnings, and separately recorded provider fees.
- Creator earnings/history, payout destinations, payout request reservation, admin verification/review/approval, gated Paystack transfer submission, transfer reconciliation, and verified transfer webhook handling.
- Ledger-derived admin finance overview and finance dashboard.
- Seven-day settlement release path plus an optional scheduled settlement worker.

### Web routes present
- Landing page
- Login/register
- Public LIVE room list and create-room form
- LIVE room client with LiveKit connection, mic/camera, stage request, host approve/reject/remove/end controls
- Creator onboarding and creator public profile
- Notifications inbox
- Creator earnings
- Payment completion/status page
- Admin finance dashboard

## What is not built yet (or only specified)

- **Mobile:** no `apps/mobile` source files are present, despite the README describing a mobile foundation.
- **Shared contracts:** no `packages/contracts` source is present.
- **Podcast listener experience:** no show detail route, episode detail route, audio/video player, browse/discovery UI, listening queue, transcript, chapters, comments, or working episode playback journey.
- **Creator Studio:** no complete show/episode management UI, upload workflow UI, publishing checklist, creator analytics, audience insights, or scheduling dashboard.
- **LIVE engagement:** no application chat, reactions, polls, Q&A, co-host invitation, moderator role/permissions, stage capacity, lock-stage/slow-mode controls, participant presence/quality indicators, recording, replay processing, or scheduled-room orchestration.
- **Community:** no creator community spaces, posts, discussions, announcements, member roles, or community moderation.
- **VOXA Moments:** no short-form clip creation, editing, approval, rights linkage, or feed.
- **Commerce beyond memberships:** no user wallet/coins, gifts, tips, ticketing, paid event access, ads, sponsorship marketplace, refunds, chargebacks, or consumer premium.
- **Trust and safety:** no report/block/mute/ban/appeal workflows, moderation queues, automated abuse/spam controls, age controls, copyright takedown workflow, or safety operations console.
- **Notifications delivery:** inbox is persisted, but push and email delivery are absent.
- **Production operations:** no deployment manifests/pipeline, secrets-manager wiring, CDN/media processing workers, observability stack, alerting, backup/restore evidence, incident runbooks, or load/penetration testing.

## Findings that need fixing or verification

### Critical / launch blockers
1. **Authentication is MVP-only.** Access tokens are stored in browser `sessionStorage`; refresh-token rotation, secure HTTP-only cookie sessions, email verification, password recovery, MFA, session/device revocation, and rate limiting are absent.
2. **Admin provisioning is undefined.** Registration always creates a normal listener. Admin routes check a JWT role, but the repository contains no safe first-admin bootstrap or privileged-role management process. Do not make a public role-assignment endpoint.
3. **No automated tests.** The tree contains no unit, integration, or end-to-end test files. CI currently proves compilation/schema validity, not behavior, security, financial invariants, or API contracts.
4. **No production integrations are verified.** LiveKit, Paystack, S3, database, DNS, email/push, and deployment credentials are not configured by this code audit. Payment/payout flags are disabled by default.
5. **Media is not production-safe yet.** Upload completion checks object metadata and size/type labels, but there is no actual codec/file-signature inspection, malware scan, moderation, duration extraction, transcoding, adaptive streaming, or CDN pipeline.
6. **Financial operations need test coverage and operational controls before live money.** The code includes a strong foundation, but there are no verified staging payment/payout runs, provider reconciliation reports, refund/chargeback flows, fraud/velocity controls, or independent ledger invariant tests.

### High-priority engineering corrections
1. **Settlement worker overlap guard:** the worker's immediate startup batch is launched before setting `settlementRunInProgress`. If it runs longer than the configured interval, the timer may start a second in-process batch. Set/clear the guard around the initial run as well.
2. **Settlement batch sizing:** one serializable transaction processes up to 500 payments with multiple account/ledger operations per payment and a 30-second timeout. Load-test this and likely reduce/chunk the batch or optimize queries before enabling the worker.
3. **Coordinate settlement paths:** the scheduled worker uses a PostgreSQL advisory lock, while the on-demand earnings/payout release path does not use that same lock. The unique ledger key is a second safeguard, but concurrent collisions can abort a whole scheduled batch. Unify the locking/retry behavior and test concurrency.
4. **Environment variable consistency:** root `.env.example` uses `OBJECT_STORAGE_*` names, while the API reads `S3_*`; the API-specific `apps/api/.env.example` has the names the code actually reads. Make root and service examples consistent.
5. **CI trigger gap:** the `pull_request` path filter omits `apps/web/**`, so web-only pull requests may not run this workflow. Add it.
6. **Reproducible CI installs:** CI uses `pnpm install --no-frozen-lockfile`; switch to frozen-lockfile installs once the lockfile is confirmed committed and current.
7. **CI quality gates:** add API/web typecheck, unit/integration tests, migration checks, lint, and later browser end-to-end tests. Build-only success must not be described as functional verification.
8. **Membership plan currency mismatch:** plan creation accepts any three-letter currency, but the current Paystack checkout only accepts GHS. Enforce the current GHS product boundary in plan creation/UI or implement a proper provider/country capability layer before exposing other currencies.
9. **Route completeness:** creator show cards link to `/shows/:id`, but there is no corresponding web route. Add show and episode routes/player before treating podcast publishing as a complete user journey.
10. **LIVE permission and state hardening:** restricted rooms are intentionally denied pending entitlements. Add room-scoped moderator permissions, stage capacity, token refresh/revocation handling, stage state tests, and ensure room state transitions reconcile against actual LiveKit events.
11. **Documentation drift:** `docs/VOXA_LIVE.md` still says the client SDK is not integrated, although a LiveKit web client exists. Finance documentation has older “not yet implemented” statements alongside later implementation sections. Reconcile docs into one accurate current-state description.

### Additional quality work
- Add pagination and request throttling to high-volume list and mutation endpoints.
- Add secure upload quotas, signed URL lifecycle controls, file validation, and cleanup of abandoned uploads.
- Improve user-facing auth, payment, room, and network error states.
- Add API health/readiness checks that actually test database/provider dependencies; current health response is a static process response.
- Add structured logs, metrics, tracing, error reporting, audit retention, and alerts.
- Define backup retention, restore drills, incident response, privacy/data deletion/export, legal terms, and market-by-market compliance.

## Recommended build structure and order

### Stage A — Stabilize the existing foundation (do first)
- Fix settlement worker guard, batch strategy, and shared locking/retry.
- Align environment templates and CI path/install rules.
- Add first automated tests for auth, creator ownership, publishing permissions, media authorization, LIVE stage permissions, payment webhook verification/idempotency, ledger balance, payout reserve/release/reversal, and settlement concurrency.
- Add a safe, documented admin bootstrap.
- Reconcile stale documentation and create a truthful deployment/configuration checklist.

**Exit gate:** CI runs frozen install, schema/migration validation, typecheck, unit/integration tests, and API/web builds; critical tests pass.

### Stage B — Complete the podcast product journey
- Discovery/search pages, creator show pages, episode pages, audio/video player.
- Creator Studio for show/episode creation, upload, status, publish, and membership gating.
- Real media worker: validation, malware scanning, metadata extraction, transcoding/HLS, thumbnails/artwork, CDN delivery.
- Playback progress, bookmarks, queues, accessibility, transcripts/chapters foundations.

**Exit gate:** a creator can upload and publish a valid episode and a listener can discover, play, save, and resume it end-to-end.

### Stage C — Make VOXA LIVE launchable
- Chat, reactions, presence, moderator roles, host controls, stage capacity, reporting/block/mute.
- Room lifecycle orchestration and robust reconnect/token refresh.
- Recording consent, recording pipeline, replay processing, scheduled events.
- Real-device/network tests and load testing.

**Exit gate:** moderated live audio/video works reliably across multiple clients and a room can be safely ended and reconciled.

### Stage D — Complete identity, community, and mobile
- Secure account/session lifecycle, verification, recovery, MFA, privacy controls.
- Community spaces, discussions, member entitlements and notifications delivery.
- Expo mobile app using shared contracts and secure native session storage.
- Accessibility, localization, analytics and app-store readiness.

### Stage E — Controlled commerce expansion
- Finish provider staging verification, payout reconciliation, refunds, chargebacks, risk controls and financial operations.
- Build gift/tip wallets, ticketed events and creator monetization only after ledger and entitlement tests.
- Add country-by-country provider/currency/payout capability rules.
- Ads/sponsorships and premium consumer plans later, with clear consent and policy controls.

### Stage F — VOXA Moments, recommendations, scale and launch
- Creator-approved short clips with source/rights traceability.
- Search/recommendation ranking, localization and creator analytics.
- Regional media delivery, SLOs, observability, load/chaos/security testing.
- Legal, privacy, trust-and-safety staffing, support, incident response and phased market launch.

## Release safety switches

Keep these disabled until approved staging verification:
- `PAYSTACK_TRANSFERS_ENABLED=false`
- `PAYSTACK_PAYOUT_EXECUTION_ENABLED=false`
- `SETTLEMENT_WORKER_ENABLED=false` until the worker corrections, concurrency tests, deployment monitoring, and database readiness checks are complete.

Never put provider credentials in GitHub source files or browser-exposed `NEXT_PUBLIC_*` variables. Configure them only in the hosting provider's encrypted environment/secret settings.

## Audit conclusion

The project has a useful technical foundation and a successful compile pipeline, but it is not yet a finished website or a production-ready global platform. The next engineering work should begin with **Stage A stabilization and automated verification**, then complete the podcast listener/creator experience before expanding the product surface. Live payments, payouts, scheduled settlement, and public global launch remain gated.


## Audit follow-up — stabilization work in progress

Changes committed after the initial audit:
- The settlement worker now uses a 100-payment scheduled batch and a 60-second serializable transaction timeout.
- Request-triggered settlement now acquires the same PostgreSQL advisory lock as the scheduled worker, preventing both release paths from competing for the same ledger movements.
- A one-time operator-run initial administrator creation script is available at `apps/api/scripts/bootstrap-admin.cjs`, exposed as `pnpm admin:bootstrap` from `apps/api`. It creates a new ADMIN user only; it refuses to promote or overwrite an existing account.
- Membership plan creation and currency updates now enforce the current GHS-only Paystack checkout boundary.
- Jest/ts-jest API test tooling and CI test execution have been added.
- Initial unit tests cover authentication, ledger transfer validation/idempotency, restricted LIVE room access, and the GHS membership currency boundary.

Verification:
- The earlier CI run `42919754708` passed dependency installation, Prisma validation/generation, API/web typecheck, the first five authentication tests, and both builds.
- A later CI run is queued/running for the expanded ledger/LIVE/membership test suite. Do not treat those additional tests as passed until that run completes successfully.
- No production database was used to run the admin bootstrap. No provider credentials or live payment/payout transfers were used.
- No frozen dependency install is possible yet because `pnpm-lock.yaml` is absent. The workflow therefore remains on `--no-frozen-lockfile` until the lockfile can be generated and committed.

Remaining Stage A exit requirements:
1. Expanded tests pass in CI.
2. Commit a generated pnpm lockfile and restore frozen installs.
3. Add tests for webhook signature/amount/idempotency, creator payout reservation/release/reversal, settlement batch concurrency, and LIVE host/stage authorization.
4. Add migration drift checks and safe admin bootstrap operational verification in a non-production environment.
5. Keep the settlement and payout execution flags disabled until staging verification and monitoring are complete.
