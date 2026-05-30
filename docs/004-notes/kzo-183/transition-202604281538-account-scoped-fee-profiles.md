# KZO-183 Transition Guide

Created: 2026-04-28 15:38 Asia/Taipei

This note summarizes the operator and reviewer-facing transition from user-scoped fee profiles to account-scoped fee profiles for KZO-183.

## What changes

- `fee_profiles` moves from user ownership to account ownership through `fee_profiles.account_id`.
- `accounts.fee_profile_id` remains, but its meaning narrows to "the default fee profile for this account."
- `account_fee_profile_overrides` stays in place for symbol-level routing inside one account, but drops `market_code` and can only point at fee profiles owned by the same account.
- account market is derived from `accounts.default_currency` through the locked mapping `TWD -> TW`, `USD -> US`, `AUD -> AU`.
- trade booking and dividend posting now reject market/account mismatches before persistence.
- the Settings drawer no longer treats fee profiles as a cross-account tab. The user-facing model becomes per-account expandable cards on the Accounts tab.

## Migration 042 impact

Migration `042_kzo183_account_scoped_fee_profiles.sql` is intentionally strict:

- it fans out a previously shared fee profile into one owned row per `(account, fee_profile)` pair
- it suffixes duplicated names as `"<original> (Account <name>)"` when a profile must be copied to additional accounts
- it duplicates `fee_profile_tax_rules` along the same old-to-new mapping
- it aborts if existing `trade_events` or `dividend_ledger_entries` would violate the new market-alignment rules
- it does not provide a down migration

The deploy gate is the dry-run script:

```bash
bash scripts/migrate/042-dry-run.sh
```

Treat any non-zero market mismatch count as blocking.

## Behavior changes to call out in review

- `GET /fee-profiles` stays flat, but each row now carries `accountId`.
- `PUT /settings/full` must validate that every account default profile and every symbol override points to a fee profile owned by the same account.
- `POST /accounts` stops accepting `feeProfileId`; the server auto-seeds a UUID-based default profile in the same transaction.
- `trade_fee_policy_snapshots.profile_id_at_booking` is left as historical metadata. It remains useful for audit display, but migration `042` does not rewrite it to the new account-owned ids.

## UI transition

- the existing mockup reference for the Accounts tab already exists in this folder:
  - `mockup-202604280300-accounts-tab.html`
  - `mockup-202604280300-accounts-tab.png`
- treat those files as frozen review artifacts for the per-account cards, top-level search, and market relabeling

## Review checklist

- confirm the dry-run gate was executed against the target database
- confirm the docs mention account-owned fee profiles and derived market binding instead of user-scoped sharing
- confirm the PR description includes a Testing section with an `Evidence:` block
- confirm the mockup files remain in the PR as frozen references
