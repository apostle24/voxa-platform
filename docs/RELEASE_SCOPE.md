# VOXA Release Scope

Last reviewed: 11 November 2026  
Release target: staging validation, not public production launch.

## 1. Current build target

The current target is a **web/API staging MVP** that can be used to verify account access, podcast discovery, creator publishing, listening, community interactions and selected LIVE workflows. Mobile and the LIVE captions agent are part of the repository, but their native/provider-specific launch gates are separate.

## 2. Implemented in the current source branch

These capabilities have corresponding application code and should be treated as implemented in source, not automatically as production-verified:

- Authentication, email verification/recovery foundations, session controls and MFA foundations.
- Podcast discovery, show and episode pages, playback, bookmarks and listening history.
- Creator onboarding, studio, upload and publishing foundations, audience/analytics/earnings pages.
- LIVE room creation, discovery, host/audience permissions and stage workflows.
- Communities, membership, posts and comments.
- Reports, community moderation actions and user block/unblock/list operations.
- Notification inbox and notification-device registration.
- Payment and ledger foundations, with transfer/payout execution disabled.
- Expo mobile app scaffold and Python LIVE captions agent.

## 3. In progress — staging verification required

- End-to-end registration, verification, login, refresh and logout.
- Creator upload through object storage, media processing and listener playback.
- Community permissions, membership, posting, comments and moderation across separate accounts.
- LIVE multi-client stage, chat, reconnection and lifecycle behavior.
- Mobile Android/iOS builds, real-device permissions, push and LiveKit.
- LIVE captions agent deployment and real provider connectivity.
- Payment sandbox callbacks, idempotency and ledger reconciliation.
- CI coverage for every app and infrastructure component.

## 4. Not enabled for public launch

- Real payouts/transfers and automated settlement.
- LIVE captions agent until provider credentials and room lifecycle are verified.
- Any provider integration without configured secrets and a successful staging test.
- Public production onboarding before security, privacy, abuse handling, operational support and launch gates are complete.

## 5. Navigation policy

A route may appear in primary navigation only when:
1. the page exists in the web app;
2. the required API endpoint exists;
3. authentication/authorization is enforced where required; and
4. the user sees a clear unavailable state if an optional integration is not configured.

Current creator audience and admin community-moderation pages exist in the audited source tree. Do not remove them merely because they were absent from an earlier repository audit. Keep admin routes role-gated.

## 6. CI ownership

The root pnpm workspace validates API and web. The Expo app is installed and typechecked separately because it is not currently listed in `pnpm-workspace.yaml`. The Python LIVE agent is checked with `py_compile` and unit tests and its Docker image is built separately. Infrastructure Compose files are parsed in CI.

## 7. Production launch gate

Do not label VOXA production-ready until:
- all CI checks pass on the release candidate;
- database migrations apply cleanly;
- critical listener and creator browser journeys pass E2E;
- community/report/block authorization flows pass;
- LIVE behavior passes multi-client staging tests;
- external integrations are tested with sandbox or staging credentials;
- payment/payout controls remain disabled until separately approved;
- security, privacy, abuse response, backups, monitoring and support procedures are reviewed.
