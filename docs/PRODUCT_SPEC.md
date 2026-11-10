# VOXA Product Specification

## Vision

Build a global destination for listening, watching, creating, and participating in podcasts and live conversations. VOXA should connect creators and audiences across regions, languages, and devices.

## Primary user roles

- Listener / viewer
- Creator / host
- Co-host / guest speaker
- Community member / subscriber
- Moderator
- Platform operations / trust and safety
- Finance and creator-payout operator

A user may hold multiple roles. Permissions are scoped to a room, community, creator account, or platform function.

## Main product surfaces

1. Home and discovery: personalized and editorial collections, trending live rooms, categories, search, language and region filters.
2. Show and episode pages: metadata, player, transcript, chapters, comments, save/share, creator profile.
3. Creator studio: upload/publish, schedule, analytics, audience, memberships, moderation settings.
4. VOXA LIVE: live audio/video, multi-host stage, audience requests, moderated chat, reactions, polls, Q&A, recording and replay.
5. Community: creator-led spaces, posts/discussions, member-only events, announcements, and reporting.
6. VOXA Moments: short clips linked to source episodes or live replays, with creator approval and rights checks.
7. Wallet and monetization: transparent purchase history, gifts, tips, subscriptions, tickets, creator earnings and payout status.

## Live room lifecycle

- Draft → scheduled → live → ended → processing → replay available (where recording is enabled).
- Host can start/end the room, invite/remove speakers, appoint moderators, mute participants, close audience requests, slow/disable chat, and enable/disable gifts.
- Audience members can watch/listen, react, chat subject to room policy, request to join the stage, answer polls, and submit Q&A.
- Stage admission is always host/moderator controlled. A request is not automatic permission to speak.
- Room visibility: public, unlisted/private invitation, or eligible members-only. Exact entitlement enforcement is server-side.

## Gifts and creator economy

- Free reactions are distinct from paid virtual gifts.
- Paid gifts require a confirmed purchase and a server-side ledger debit before delivery is accepted.
- Creator earnings are a separate ledger from user coin balances; conversion rates, fees, holds, refunds, taxes, and payout eligibility are policy-controlled.
- No client action may directly increase wallet balance or mark a payment successful.
- Gift catalogue, pricing, regional availability, and payout methods are configurable, not hard-coded.

## Accessibility and internationalization

Support localization, captions/transcripts, keyboard and screen-reader navigation, reduced motion, accessible color contrast, low-bandwidth media modes, and clear network-state feedback. Launch globally only after country, language, legal, payment, and support readiness are verified.
