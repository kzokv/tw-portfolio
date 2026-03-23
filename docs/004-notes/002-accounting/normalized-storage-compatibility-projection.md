# Normalized Storage With Compatibility Projection

Use this pattern when the repository needs a more extensible internal model, but existing settings or API contracts should remain temporarily stable.

## Why

Some schema changes are worth doing internally before the user-facing contract is ready to become fully generic.

This repository now has a concrete example in `KZO-59`:

- tax policy is stored in normalized rows
- booked trade tax details are stored as immutable snapshot component rows
- the existing Taiwan-facing fee-profile contract is still projected as four compatibility fields

## Required pattern

- normalize the source-of-truth storage first
- keep immutable booked facts independent from mutable reference rows
- project normalized rows back into the old contract shape at the API and settings boundary when compatibility matters
- keep compatibility projection logic explicit and centralized
- add migration parity tests for both numbered migrations and baseline bootstrap
- verify that the compatibility projection still round-trips existing defaults and historical reads

## Current example

- runtime tax rules: `fee_profile_tax_rules`
- immutable booked tax snapshot rows: `trade_fee_policy_snapshot_tax_components`
- compatibility projection: `stockSellTaxRateBps`, `stockDayTradeTaxRateBps`, `etfSellTaxRateBps`, `bondEtfSellTaxRateBps`

## Boundary

This pattern is transitional. Once the user-facing contract is ready for the normalized shape, remove the compatibility projection instead of letting both models live forever.
