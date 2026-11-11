# VOXA Integration and Staging Verification Plan

Updated: 11 November 2026

## Purpose

This plan turns the combined development build into a testable application. A green GitHub Actions build confirms static checks and the configured unit tests pass; it does not establish that PostgreSQL migrations, browser journeys, external providers, or deployed services work together.

Current integration candidate:
- Branch: `integration/full-stack`
- Commit: `0140e4f142947b39aa2c1bd4996eb712a0a3e24c`
- Pull request: https://github.com/apostle24/voxa-platform/pull/27
- CI runs: 43027653881 and 43027633770 — completed successfully.
- PR #27 remains a draft integration PR. It has not been merged to `main`.

## Verification already completed

The successful CI workflow ran:
1. Frozen pnpm workspace installation.
2. Prisma schema validation.
3. Prisma Client generation.
4. Media worker JavaScript syntax validation.
5. Isolated media worker Docker image build.
6. API and web TypeScript typechecking.
7. API Jest unit tests.
8. API production build.
9. Next.js web production build.

These checks are repeatable and should remain required on future changes.

## Important database migration blocker

The current migration directory does not contain an initial schema migration. The earliest visible migration, `20261110160000_media_asset_processing`, creates `MediaAsset` with a foreign key to the pre-existing `Episode` table. Later migrations also alter or reference pre-existing core tables such as `User`, `Creator`, `Show`, and `Episode`.

The CI workflow currently validates the Prisma schema but does not start PostgreSQL or execute `prisma migrate deploy`. Therefore the green CI result does not prove that a new empty database can be initialized from the committed migration history.

**Required before staging:** establish the authoritative baseline migration (or a documented, reproducible baseline procedure for an existing database), then add a PostgreSQL-backed CI job that applies the complete migration history to an empty database. Do not run a destructive schema reset against any shared or production database.

## Staging environment prerequisites

Provision separate staging resources and store credentials only in the hosting provider's encrypted secret manager:

- PostgreSQL database with backups and migration access.
- Private S3-compatible bucket, browser-origin CORS policy, and separate original/processed object prefixes.
- API and web origins with HTTPS, correct CORS allowlist, secure cookie domain/same-site settings, and trusted proxy configuration.
- Resend account, verified sender domain, and `RESEND_API_KEY`.
- LiveKit project URL and API credentials; configure the webhook URL as `/v1/live/webhooks/livekit`.
- Paystack test credentials and webhook configuration for GHS membership checkout.
- MFA encryption key generated as a base64-encoded 32-byte key.
- Error reporting, structured logs, health/readiness monitoring, and operator access.

Keep all financial automation disabled during initial staging:
- `PAYSTACK_TRANSFERS_ENABLED=false`
- `PAYSTACK_PAYOUT_EXECUTION_ENABLED=false`
- `SETTLEMENT_WORKER_ENABLED=false`
- `LIVEKIT_RECORDING_ENABLED=false` until recording consent and egress behavior are verified.

Never paste secrets into GitHub issues, pull-request comments, source files, or ChatGPT messages.

## End-to-end verification matrix

| Journey | Test procedure | Pass condition |
|---|---|---|
| Registration and email | Register a new account; inspect delivered verification email; follow the one-time link | Account is created, link verifies once, expired/reused links are rejected |
| Login and refresh | Sign in; allow access token to expire; exercise refresh; replay an old refresh token | Refresh rotates once; replay is rejected; session revocation takes effect |
| Password recovery | Request reset for known and unknown addresses; use valid, expired and reused links | Responses do not disclose account existence; reset is one-time and revokes sessions |
| MFA | Enroll authenticator; sign in with TOTP; consume a backup code; attempt to reuse it | TOTP challenge works; backup code works once; replay is rejected |
| Account sessions | List sessions; revoke one; revoke all | Only the current user's sessions are exposed and revoked sessions cannot refresh |
| Creator onboarding | Create creator profile and public handle | Profile is created and public page displays the correct creator |
| Podcast publishing | Create show and episode draft; upload real audio/video; complete upload; wait for worker; publish | Asset reaches READY only after scanning/transcoding; published episode is playable |
| Listener playback | Discover, play, queue, bookmark, pause and resume an episode | Correct media plays; saved progress and library state persist |
| Membership checkout | Use Paystack test mode for a GHS membership; deliver webhook more than once | Provider verification succeeds; membership activates once; ledger balances |
| Settlement and payouts | Use test fixtures to mature a payment, release earnings, reserve payout, fail/succeed/reverse transfer | Ledger remains balanced; idempotency and hold-release rules are preserved |
| Live room | Host creates room; audience joins; requests stage; host approves/rejects/removes; participant leaves | Token permissions and persisted stage/presence lifecycle match room state |
| LiveKit webhooks | Deliver valid, duplicate and invalid-signature webhook events | Valid events process once; duplicates are ignored; invalid signatures are rejected |
| Live recording/replay | Only after consent workflow and LiveKit Egress are verified, record a test room and process replay | Recording output is private, processed, linked to a draft, and only published after creator review |
| Media failure recovery | Upload invalid media; force worker failure; retry from Creator Studio | Failed asset remains unpublished; retry resets only the owned failed draft asset |
| Admin controls | Use admin account to review finance operations and audit trail | Non-admin access is denied; each sensitive action is auditable |

## Release gates

### Gate A — repository and migration integrity
- CI green on the exact candidate commit.
- Complete migration history applies to a brand-new disposable PostgreSQL database.
- Existing-database upgrade rehearsal succeeds on a sanitized copy.
- No destructive migration or data loss is present.

### Gate B — staging user journeys
- Registration, verification, login, refresh, password recovery, MFA and session revocation pass.
- Creator upload, media worker processing, publishing and listener playback pass using real staging storage.
- LiveKit join/stage/webhook tests pass.
- Paystack test-mode membership and webhook tests pass with balanced ledger assertions.
- Browser tests cover the principal listener and creator journeys.

### Gate C — operational readiness
- Backups and restore drill completed.
- Alerts and logs cover API, worker, database, storage, LiveKit and payment webhooks.
- Rate limits, upload limits, moderation, privacy, terms, copyright and incident procedures reviewed.
- Payout and settlement flags remain off until provider approval, finance reconciliation and explicit operator sign-off.

### Gate D — controlled production release
- Explicit release approval.
- Production secrets and domains configured outside source control.
- Migrations rehearsed and rollback/forward-fix plan documented.
- Smoke tests and monitoring verified immediately after deployment.

## Current decision

VOXA has passed the combined code-level CI build, but it is not yet staging-verified or production-ready. The next engineering priority is the database migration baseline and PostgreSQL-backed migration CI, followed by repeatable staging integration and browser end-to-end tests. New monetization or social features should not displace these release-critical checks.
