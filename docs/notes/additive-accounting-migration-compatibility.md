# Additive Accounting Migration Compatibility

Use this pattern when adding new accounting fields or columns without completing the larger rename or normalization project in the same run.

## Why

Managed Postgres integration can fail even when route validation and migrations look correct, because tests and store-level persistence paths may still construct older object shapes directly.

## Required pattern

- Add the new column with a default or a safe backfill path.
- Backfill existing rows before enforcing `NOT NULL` or stricter checks.
- Normalize legacy serialized snapshots on read.
- Coalesce missing new fields to safe defaults on write when persistence accepts older in-memory objects.
- Keep the broader normalization or rename work in a separate scoped ticket if the blast radius is large.
- Run managed Postgres integration after unit and package-level checks.

## Current examples

- `fee_profiles.board_commission_rate`
- `fee_profiles.commission_charge_mode`
- `dividend_events.cash_dividend_currency`
- dividend-related cash ledger writes that still need `currency = 'TWD'` when older objects omit it

## Implication for follow-on work

`KZO-55` should assume that additive compatibility handling is needed during transition, not just migration SQL and route defaults.
