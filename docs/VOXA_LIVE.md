# VOXA LIVE — Advanced Live Audio & Video

## Room modes

- Audio-only live podcast / talk room
- Video live show
- Solo host, host + co-host, and multi-guest panel
- Scheduled premiere / live recording
- Public, unlisted invitation, and members-only access

## Stage and audience

- Audience can raise a hand / request to join.
- Host or authorized moderator approves, rejects, invites, removes, or mutes a speaker.
- Speaker roles: host, co-host, guest speaker, moderator, audience.
- Stage capacity is configurable per plan and infrastructure limits.
- Reconnection and network quality states must be visible.
- Hosts can lock the stage, disable requests, or switch to listen-only mode.

## Engagement

- Live chat with slow mode, blocked terms, rate limits, moderation queue, and pinned messages.
- Free reactions (heart, clap, laugh) with abuse throttling.
- Polls, Q&A, audience questions, and moderated call-ins.
- Co-host and moderator permissions are explicit and auditable.
- Shareable room links and live-start notifications.

## Virtual gifts

A gift catalogue can include simple items (for example stars, roses, applause, or premium animated gifts). Names, visuals, prices, and availability are configurable by market.

Gift transaction flow:
1. Client requests a gift purchase or send action with an idempotency key.
2. API checks identity, room eligibility, region, age/policy restrictions, available balance, and limits.
3. API records a pending transaction and performs the required wallet debit atomically.
4. Gift event is published only after the ledger transaction is committed.
5. Recipient and audience see the gift animation/event.
6. Creator earnings are calculated according to published policy and recorded separately.
7. Reconciliation, refund, chargeback, fraud review, and payout processes run independently.

Never implement gifts as a client-side balance decrement or a client-side earnings increment. All financial state is server-authoritative.

## Recording and replay

- Room host explicitly chooses whether recording is enabled.
- Participants receive clear recording notices and consent controls appropriate to jurisdiction.
- Recording is stored privately, processed, checked, and published only under creator permissions.
- Replays inherit content visibility and entitlement rules.
- Clips must link to the original recording and respect takedown and rights restrictions.

## Moderation and safety

- Report, block, mute, remove, ban, and appeal workflows.
- Room-level moderators and clear permission scopes.
- Emergency end-room and gift-disable controls.
- Spam, bot, harassment, impersonation, and suspicious gifting detection.
- Audit logs for stage admission, moderation, financial events, and role changes.
- Safety policies for minors and restricted content must be designed before enabling global live access.

## Technical integration

Recommended media layer: LiveKit / WebRTC SFU. API issues short-lived room tokens and applies room authorization. Application services own chat policy, stage approvals, gift ledger, room metadata, moderation, and replay entitlements. See https://docs.livekit.io/ for provider integration documentation.
