## Problem

KZO-183 changes the fee-profile ownership model from user-scoped sharing to account-scoped ownership. The current model allows one fee profile to be shared across unrelated accounts and does not prevent trades or dividends from being booked into an account whose derived market does not match the event market. The settings UI also still treats fee profiles as a global tab instead of an account-local configuration surface.

## Solution

- rescope `fee_profiles` to `fee_profiles.account_id`
- keep `accounts.fee_profile_id` as the default profile pointer within one account
- keep `account_fee_profile_overrides` for symbol overrides, but drop `market_code` and enforce same-account ownership
- derive market from `accounts.default_currency` using the locked `TWD/TW`, `USD/US`, `AUD/AU` mapping
- reject market/account mismatches in trade and dividend flows
- move the settings UX to per-account expandable cards on the Accounts tab
- document the migration `042` dry-run gate and frozen mockup artifacts

## Testing

Evidence:
- `npx eslint . --max-warnings=0` — clean
- `npm run typecheck` — clean (6 tsconfigs)
- `npm run test --prefix apps/web` — 307 passed
- `npm run test --prefix apps/api` — 545 passed (api workspace) plus 102 + 109 passed across other library packages
- `npm run test:integration:full:host` — 566 passed / 1 skipped (50 test files)
- `npm run test:e2e:bypass:mem --prefix apps/web` — 186 passed
- `npm run test:e2e:oauth:mem --prefix apps/web` — 83 passed
- `npm run test:http --prefix apps/api` — 169 passed
- `bash scripts/migrate/042-dry-run.sh` — operator gate; run on the target database before each deploy

## Risk/Rollback

- migration `042` is destructive in the sense that it rewrites fee-profile ownership and does not ship a down migration
- rollback depends on the standard pre-migration Postgres backup, not on reversing SQL in place
- a failed dry-run gate is a stop-ship signal because it means existing rows already violate the new market or ownership invariants
- `trade_fee_policy_snapshots.profile_id_at_booking` remains as historical metadata and will not match newly fanned-out fee-profile ids after migration
