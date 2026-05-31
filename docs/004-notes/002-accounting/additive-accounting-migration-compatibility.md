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
- `fee_profiles.commission_discount_percent`, with migration backfill from legacy `commission_discount_bps` and persistence-level normalization for legacy fee snapshots
- `dividend_events.cash_dividend_currency`
- dividend-related cash ledger writes that still need `currency = 'TWD'` when older objects omit it

## Boundary

This note applies when the repo is intentionally taking an additive transition path.

`KZO-55` is now the counterexample: because there was no live data to preserve, the repo took a hard currency-normalization cutover instead of keeping `*_ntd` compatibility aliases. That work still required a full update sweep across route contracts, persistence shapes, direct-SQL integration fixtures, and web consumers.
