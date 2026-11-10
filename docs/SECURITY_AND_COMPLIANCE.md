# Security, Trust & Compliance Baseline

This is an engineering checklist, not legal advice or a declaration of compliance.

## Identity and access
- Secure password/session flows, MFA for privileged roles, device/session revocation.
- Least-privilege RBAC with resource-scoped permissions.
- Short-lived signed media URLs and live-room tokens.
- Creator verification and payout identity checks appropriate to each market.

## Financial integrity
- Append-only, auditable double-entry ledger.
- Server-side payment provider webhook signature verification.
- Idempotent checkout, gift, refund, chargeback, and payout operations.
- Reconciliation against payment-provider settlement reports.
- Separate user spendable balance, pending balance, creator payable, and paid-out amounts.
- Risk limits, velocity checks, suspicious activity review, and documented refund rules.

## Content and user safety
- Reporting, blocking, moderation queues, appeals, and documented enforcement.
- Copyright complaint, takedown, counter-notice, and repeat-infringer workflows.
- Live-room emergency controls and recording consent notices.
- Age-appropriate access controls and safeguards for minors.
- Transparency about AI-generated or AI-modified content where required.

## Privacy and operations
- Data minimization, purpose limitation, retention/deletion schedules, export and deletion workflows.
- Encryption in transit and at rest; secrets manager for credentials.
- Audit logs for sensitive operations; do not log secrets or payment credentials.
- Incident response, breach notification process, backups, restore tests, and disaster recovery.
- Threat modeling and independent penetration testing before public launch.

## Global readiness
Before opening a market, verify local consumer, privacy, tax, payments, digital-content, age, accessibility, sanctions, and app-store requirements. Confirm merchant onboarding, creator payout rails, currency support, refunds, and chargeback handling in each country. Ghana-based platform ownership does not imply that every global payment or payout product is available to every account.


## Initial administrator provisioning

VOXA does not expose a public endpoint for assigning the ADMIN role. Create the first administrator through the API package's one-time operational script after the production database has been migrated:

1. Set `DATABASE_URL`, `VOXA_BOOTSTRAP_ADMIN_EMAIL`, and `VOXA_BOOTSTRAP_ADMIN_PASSWORD` in a secure operator shell or deployment secret environment. Use a unique email and a password of at least 14 characters.
2. From `apps/api`, run `pnpm admin:bootstrap`.
3. The script creates a new ADMIN user with a bcrypt-hashed password. It refuses to promote or overwrite an account if the email already exists.
4. Remove the bootstrap password from the shell/session and rotate it through the normal credential process after first login.

Never expose these variables in browser configuration, commit them to Git, or add a public role-assignment route. This script has not been run against a production database as part of the repository audit.
