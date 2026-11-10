# VOXA financial operations and payout design

## Current release boundary

The current Paystack integration is a GHS-only, one-time monthly membership checkout foundation. It verifies signed webhooks and independently verifies transactions with Paystack before activating membership. Membership revenue is allocated using a 1,500 basis-point (15%) VOXA platform commission snapshot on each payment attempt. The creator receives 85% of gross membership value before any provider fees; the platform commission is recorded as VOXA revenue. Paystack's verified transaction `fees` field is recorded as a separate platform processing expense and is not deducted from creator earnings.

It is not yet a payout-ready wallet:
- Creator net receipts (85% of gross) are recorded in a creator-pending account. VOXA's 15% commission is credited to a separate platform-revenue account.
- When Paystack returns a valid non-negative `fees` amount on its server-side transaction verification response, that cost is posted as a separate provider-processing-fee expense and reduces the platform-clearing account. It does not reduce the creator's recorded net earnings.
- Payout destination records and payout request records now exist in the schema. A gated API can register Ghanaian GHS Paystack recipients and stores only the provider recipient code and masked account number. Destinations are deliberately not marked verified yet.
- There is no settlement hold/release process, withdrawal execution, refund workflow, chargeback workflow, or financial reconciliation job. Payout destinations are only an onboarding foundation; no withdrawal can be requested or paid yet.
- A displayed pending ledger balance must not be described as cash available to withdraw.
- No live payment should be accepted until the merchant account, test flow, database migrations, webhook delivery, and operational controls have been verified.

## Provider findings for Ghana

### Paystack

Paystack's official transfer documentation lists feature availability for businesses in Ghana, Nigeria, South Africa, and Kenya. Its Ghana recipient types include bank transfers (GHS via `ghipss`) and mobile money (GHS via `mobile_money`). Transfers require a server-side secret key, a registered recipient, a unique transfer reference, and provider status handling.

Official references:
- https://paystack.com/docs/transfers/
- https://paystack.com/docs/transfers/creating-transfer-recipients/
- https://paystack.com/docs/transfers/single-transfers/
- https://paystack.com/docs/api/transfer/
- https://support.paystack.com/en/articles/2132866

Paystack's support guidance says its Transfers product is for registered businesses and has country-specific pricing and eligibility conditions. The business must confirm that its own account has Transfers enabled and that its compliance review is approved before VOXA enables creator withdrawals. The API must never assume that a successful collections integration automatically grants payout access.

### Flutterwave fallback evaluation

Flutterwave's official Ghana guides describe bank-account and mobile-money transfers in GHS. Their prerequisites include completed KYC, approved transaction access, IP whitelisting, Transfers API enablement, and sufficient wallet balance.

Official references:
- https://developer.flutterwave.com/docs/ghana-2
- https://developer.flutterwave.com/docs/ghana-3
- https://developer.flutterwave.com/docs/introduction-6

Flutterwave remains a possible provider adapter, not an assumed production fallback. Account eligibility, fees, settlement funding, supported networks, limits, and merchant terms must be confirmed for VOXA before implementation or activation.

## Required financial rules before creator withdrawals

1. **Platform commission:** proposed creator membership commission is 15% (1,500 bps), approved by the product owner on 2026-11-10. Each payment attempt snapshots the rate and amounts so future rate changes cannot rewrite past transactions. Provider fees remain separate platform expenses.
2. **Settlement hold:** product owner must approve the hold period and any minimum payout threshold. Pending funds cannot become withdrawable merely because a webhook arrived.
3. **Double-entry ledger:** every collection, fee, reserve, release, refund, chargeback, and payout must post balanced immutable entries in one database transaction.
4. **Idempotency:** every provider webhook, payout request, and transfer must have a stable unique key. Replays must not move money twice.
5. **Server authority:** client-submitted balances, amounts, payout status, and beneficiary codes are never trusted.
6. **Beneficiary verification:** verify destination details through the provider where available; require step-up authentication for changes and withdrawals.
7. **Payout state machine:** requested -> under review -> submitted -> pending -> paid, or failed/reversed. Only a verified provider result can mark a transfer paid.
8. **Risk controls:** velocity limits, minimum/maximum thresholds, fraud review, account takeover controls, sanctions/compliance review where applicable, and a manual admin hold path.
9. **Reconciliation:** regularly compare local attempts, provider transactions, settlement balances, transfers, fees, refunds, and chargebacks. Unmatched entries must alert operators.
10. **Operational separation:** use test keys in development/staging and live keys only in production secrets. Never place secrets in the browser, source control, logs, or support tickets.

## Implemented in this milestone

- Membership attempts snapshot a 15% platform fee and creator net amount.
- Successful payment ledger postings balance gross clearing debit against creator pending credit plus platform revenue credit.
- Paystack's verified `fees` amount, when returned as a valid integer, is posted through a separate provider-processing-fee ledger transaction.
- Creator earnings API and dashboard now show the creator's ledger impact rather than the gross transaction amount.
- Payout destination onboarding endpoint: `GET /v1/creators/me/payout-destinations`, `POST /v1/creators/me/payout-destinations`, and `PATCH /v1/creators/me/payout-destinations/:destinationId/default`. It is disabled unless `PAYSTACK_TRANSFERS_ENABLED=true`, only accepts Ghana GHS bank/mobile-money recipient types, sends account details directly to Paystack, and stores only a masked account number plus provider recipient code. New destinations are not treated as identity-verified.

## Implementation sequence

1. Harden and test checkout/webhook behavior, including ambiguous network outcomes and duplicate delivery.
2. Add explicit platform fee configuration only after the approved fee policy is supplied.
3. Add pending-to-available release rules only after the approved hold and reserve policy is supplied.
4. Add encrypted beneficiary records, provider recipient creation, step-up verification, and audit trail.
5. Add creator withdrawal requests and admin review with limits and idempotency.
6. Add provider transfer execution, signed webhook/status verification, failure/reversal handling, and reconciliation.
7. Only then build virtual gifts/tips on top of the same wallet and ledger controls.

## Secrets and environment

Keep all provider credentials on the API server:
- `PAYSTACK_SECRET_KEY` — use the Paystack test secret key in staging; live secret key only in production.
- `PAYSTACK_CALLBACK_URL` — the public web payment-return URL.
- `PAYSTACK_TRANSFERS_ENABLED=false` — keep false until Paystack approves VOXA's Transfers product and the staging payout flow is reviewed. Do not enable just because the API key exists.
- `DATABASE_URL` — PostgreSQL connection string.
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LIVEKIT_URL` — server-side LiveKit credentials for live rooms.

Configure these in the deployment platform's server environment or GitHub Actions secrets for CI jobs that genuinely require them. Never prefix a secret with `NEXT_PUBLIC_`.
