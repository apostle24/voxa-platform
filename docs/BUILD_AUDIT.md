# VOXA Build Audit — 11 November 2026

## Audit scope

- Repository: `apostle24/voxa-platform`
- Audited branch: `deploy/voxa-staging-render`
- Purpose: describe the repository state used for the Render staging build.
- This is a source-tree audit. A feature is not considered staging-verified merely because its source files exist.

## Executive assessment

VOXA is an active multi-app monorepo with a substantial web/API MVP, community and moderation code, an Expo mobile application scaffold, and a Python LIVE captions agent. It is **not yet a verified production release**. The immediate objective is a reproducible repository build followed by staging smoke and end-to-end tests.

The previous version of this document described an earlier repository snapshot. Its statements that there was no mobile source tree and no community backend are stale and are superseded by this audit.

## Verified source structure

### API and data layer

- NestJS API in `apps/api`.
- Prisma/PostgreSQL schema and ordered SQL migrations.
- Modules registered in `apps/api/src/app.module.ts`: authentication, creators, shows, media, LIVE, notifications, memberships, ledger, payments, communities and reports.
- Community entities in Prisma: `Community`, `CommunityMember`, `CommunityPost`, `CommunityPostComment`.
- Community controller/service and a community service Jest spec exist.
- Reports controller/service implement reporting, moderation queue actions, account blocking/unblocking and `GET /users/me/blocked`.
- Readiness endpoint `GET /v1/health/ready` checks PostgreSQL connectivity.

### Web app

Next.js app routes present in the audited tree include:

- Listener: `/`, `/discover`, `/following`, `/history`, `/library`, `/shows/[showId]`, `/episodes/[episodeId]`, `/moments`, `/replays`.
- Identity: `/login`, `/verify-email`, `/forgot-password`, `/reset-password`, `/settings/profile`, `/settings/security`.
- Creator: `/creator/setup`, `/creator/[handle]`, `/creator/studio`, `/creator/analytics`, `/creator/audience`, `/creator/earnings`.
- Communities: `/communities`, `/communities/[slug]`.
- LIVE: `/live`, `/live/[roomId]`.
- Operations: `/notifications`, `/admin/community-moderation`, `/admin/finance`, `/payment/complete`.

The creator audience and community moderation pages exist in the audited branch. They must remain access-controlled and their API calls must be covered by tests; they are not dead routes based on the current source tree.

### Mobile app

An Expo app source tree exists at `apps/mobile`, including `App.tsx`, `index.ts`, `app.json`, `tsconfig.json`, API/session helpers and theme files. It includes account flows, podcast discovery/playback, communities, LIVE, creator and profile screens, notification registration and deep-link handling.

**Not yet verified:** Android/iOS native builds, EAS builds, real-device permissions, push delivery and LiveKit device sessions. The mobile package is currently intentionally outside the root pnpm workspace; CI installs its dependencies separately and typechecks it.

### LIVE captions agent

The Python agent includes `main.py`, `config.py`, `requirements.txt`, `test_config.py` and a Dockerfile. Configuration validates required LiveKit/OpenAI credentials and participant limits.

**Not yet verified:** deployed agent registration, real LiveKit room join, provider transcription, transcript persistence and reconnect/shutdown behavior against staging credentials.

### Infrastructure

Compose definitions exist for local PostgreSQL/Redis, the media worker and the LIVE captions agent. Dockerfiles exist for the media worker and LIVE agent.

## Repository-level defects addressed in this stabilisation pass

1. Render build commands no longer attempt to overwrite the protected system `pnpm` binary with `corepack enable`.
2. Known API TypeScript defects discovered in the first Render build were patched on the staging branch.
3. Frontend API URL trailing-slash regex defects discovered during the build were corrected.
4. CI path filters now include mobile, LIVE agent, infrastructure, docs, Render configuration and Node version configuration.
5. CI now includes a separate Expo dependency install and typecheck, Python syntax/unit checks, LIVE agent Docker build, and Compose configuration validation.
6. Node runtime is pinned to the Node 22 line to avoid Render silently selecting a newer major runtime.

## CI coverage

The workflow `.github/workflows/api-ci.yml` now intends to validate:

- Frozen root pnpm install.
- Prisma schema validation and client generation.
- Media worker syntax and Docker image build.
- API and web typechecks, API tests, API build and web build.
- Mobile dependency installation and TypeScript typecheck.
- LIVE agent Python compilation and unit tests.
- LIVE agent Docker image build.
- Docker Compose configuration for the infrastructure stacks.

A workflow definition is not proof that all jobs passed. The current branch must receive a green GitHub Actions run before this checklist is marked verified.

## Implemented in source vs. proven in staging

| Area | Source status | Staging proof |
|---|---|---|
| Authentication and account security | Implemented foundations | Pending complete browser journey |
| Podcast discovery and playback | Implemented | Pending upload-to-playback E2E |
| Creator studio and publishing | Implemented foundations | Pending real object-storage flow |
| Communities and discussions | API, schema and web routes present | Pending API/browser integration tests |
| Reports and account blocking | API and moderation routes present | Pending role/authorization E2E |
| LIVE rooms | Web/API and mobile integration present | Pending multi-participant test |
| Payments and payout foundations | Code present; safety switches off | Real-money flows not verified |
| Expo mobile app | Runnable project scaffold present | Native/EAS/device builds pending |
| LIVE captions agent | Python implementation and Dockerfile present | Provider integration pending |
| CI | Expanded checks committed | Green run pending |

## Release safety

Keep these disabled until separately approved and verified:

- `PAYSTACK_TRANSFERS_ENABLED=false`
- `PAYSTACK_PAYOUT_EXECUTION_ENABLED=false`
- `SETTLEMENT_WORKER_ENABLED=false`
- `LIVEKIT_CAPTIONS_AGENT_ENABLED=false` until provider credentials and the agent deployment are tested.

Do not place credentials, database URLs, JWT secrets or provider tokens in Git. Configure them only through deployment secret settings.

## Remaining launch gates

1. Obtain a green CI run for the complete repository checks.
2. Confirm all Prisma migrations apply cleanly to an empty staging database.
3. Verify registration, email verification, login, refresh and logout in a browser.
4. Verify creator setup, upload, processing, publication and listener playback.
5. Verify community creation/join/post/comment, reporting, blocking and moderator actions with separate user roles.
6. Verify LIVE host/audience/stage transitions and reconnection with at least two real clients.
7. Verify mobile native builds and device behavior independently from the web build.
8. Verify payment provider sandbox flows and ledger invariants; keep payouts disabled.
9. Add automated browser E2E coverage before describing the product as release-ready.

A passing typecheck/build is necessary but does not establish production readiness or prove external services work.
