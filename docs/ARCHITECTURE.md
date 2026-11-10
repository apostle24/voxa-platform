# VOXA System Architecture

## High-level topology

```text
Expo / React Native apps + Web client
                |
          API Gateway / BFF
                |
  Identity | Catalog | Creator | Community
  Live Control | Chat | Gifts | Wallet
  Payments | Notifications | Moderation
                |
 PostgreSQL | Redis | Event Bus | Search
                |
 Object Storage + CDN | Media Processing
                |
 LiveKit / WebRTC SFU + Recording pipeline
```

## Services and boundaries

- **Identity:** registration, sessions, device management, account recovery, creator verification.
- **Catalog:** shows, episodes, metadata, publishing state, categories, transcripts, chapters.
- **Creator:** profiles, studio, upload workflows, analytics, memberships.
- **Live control plane:** room creation, authorization, stage requests, speaker grants, moderation commands, room lifecycle.
- **Media plane:** WebRTC SFU, TURN connectivity, recording, transcoding, replay packaging, CDN delivery.
- **Chat & interaction:** live messages, reactions, polls, Q&A, rate limits, moderation queues.
- **Commerce:** checkout orchestration, provider webhooks, virtual currency, gifts, subscriptions, tickets, refunds.
- **Ledger & payouts:** append-only double-entry financial records, reconciliation, creator balances, payout review.
- **Trust & safety:** reports, blocks, mutes, policy actions, age and content controls, audit trails.
- **Notifications:** push, email, in-app, live-start alerts, creator announcements.

## Live media approach

Use a managed or self-hosted WebRTC SFU such as LiveKit. The control plane issues short-lived, room-scoped tokens only after server-side authorization. Never embed API secrets in clients. Chat and gifts should use authenticated application services rather than relying on media-provider data channels as the system of record.

## Data and reliability

- PostgreSQL is the source of truth for accounts, content metadata, permissions, commerce, and ledger entries.
- Redis is for cache, rate limits, ephemeral presence, room coordination, and short-lived state; it is not the financial ledger.
- Object storage holds uploads, recordings, generated media, and approved assets.
- CDN serves public or entitlement-checked media using signed URLs where required.
- Use idempotency keys for purchases, gift delivery, webhook processing, and payouts.
- Use an outbox/event pattern for reliable cross-service events.
- Define SLOs for playback startup, live join success, chat delivery, API availability, and payment reconciliation before launch.

## Suggested first deployment topology

Start with a modular monolith API and clearly separated modules. Extract high-throughput services (live chat, media processing, notifications, analytics) only when measured load and team capacity justify it. Deploy regional media infrastructure close to audiences while keeping identity and financial data residency compliant.
