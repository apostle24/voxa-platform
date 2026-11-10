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