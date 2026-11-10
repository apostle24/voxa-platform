# VOXA financial operations and payout design

## Current release boundary

The current Paystack integration is a GHS-only, one-time monthly membership checkout foundation. It verifies signed webhooks and independently verifies transactions with Paystack before activating membership. It records gross membership value in a double-entry ledger.

It is not yet a payout-ready wallet:
- Creator receipts are currently recorded in a creator-pending account.
- There is no platform commission policy, settlement hold/release process, withdrawal request, beneficiary onboarding, payout execution, refund workflow, chargeback workflow, or financial reconciliation job.
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

1. **Platform commission:** product owner must approve the percentage and whether provider fees are absorbed by VOXA or passed through. Do not silently invent a fee.
2. **Settlement hold:** product owner must approve the hold period and any minimum payout threshold. Pending funds cannot become withdrawable merely because a webhook arrived.
3. **Double-entry ledger:** every collection, fee, reserve, release, refund, chargeback, and payout must post balanced immutable entries in one database transaction.
4. **Idempotency:** every provider webhook, payout request, and transfer must have a stable unique key. Replays must not move money twice.
5. **Server authority:** client-submitted balances, amounts, payout status, and beneficiary codes are never trusted.
6. **Beneficiary verification:** verify destination details through the provider where available; require step-up authentication for changes and withdrawals.
7. **Payout state machine:** requested -> under review -> submitted -> pending -> paid, or failed/reversed. Only a verified provider result can mark a transfer paid.
8. **Risk controls:** velocity limits, minimum/maximum thresholds, fraud review, account takeover controls, sanctions/compliance review where applicable, and a manual admin hold path.
9. **Reconciliation:** regularly compare local attempts, provider transactions, settlement balances, transfers, fees, refunds, and chargebacks. Unmatched entries must alert operators.
10. **Operational separation:** use test keys in development/staging and live keys only in production secrets. Never place secrets in the browser, source control, logs, or support tickets.

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
- `DATABASE_URL` — PostgreSQL connection string.
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LIVEKIT_URL` — server-side LiveKit credentials for live rooms.

Configure these in the deployment platform's server environment or GitHub Actions secrets for CI jobs that genuinely require them. Never prefix a secret with `NEXT_PUBLIC_`.
