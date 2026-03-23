# Latest Handoff

## Completed
- Implemented `KZO-59` normalized fee-profile tax modeling across domain logic, Postgres persistence, migrations, and migration parity tests.
- Added normalized runtime tax storage in `fee_profile_tax_rules` and immutable booked tax component snapshots in `trade_fee_policy_snapshot_tax_components`.
- Propagated `market_code` through symbols, fee-profile overrides, and trade facts so normalized tax rules have explicit market identity.
- Kept the current Taiwan-facing settings and API contracts stable by projecting normalized tax rows back into the existing compatibility fields.
- Updated canonical accounting documentation and migration coverage to reflect the normalized tax-policy model.
- Opened PR `#52`: https://github.com/kzokv/tw-portfolio/pull/52
- Verified on March 12, 2026:
  - `npm run build -w libs/domain`
  - `npm run test -w libs/domain`
  - `npm run build -w apps/api`
  - `npm run test -w apps/api`
  - `npm run test:integration:ci:host`

## Remaining work
- Address review feedback on PR `#52`.
- Pick the next ranked Wave 2 Linear ticket after `KZO-59` review status changes or a reviewer identifies follow-up work.

## Risks or blockers
- Multi-market tax editing is still backend-first. The current UI and API remain Taiwan-shaped by design and will need a later ticket for fully generic tax-rule editing.
- Legacy compatibility columns still exist in `fee_profiles` and `trade_fee_policy_snapshots`; the runtime now prefers normalized tax rows/components underneath them.

## Open questions
- Which ranked Wave 2 ticket should follow `KZO-59` once review feedback is resolved.

## Relevant files
- `db/migrations/011_fee_profile_tax_rule_normalization.sql`
- `db/migrations/012_market_code_on_symbols_bindings_and_trades.sql`
- `db/migrations/baseline_current_schema.sql`
- `apps/api/src/persistence/postgres.ts`
- `apps/api/src/services/portfolio.ts`
- `apps/api/src/services/recompute.ts`
- `apps/api/test/integration/postgres-migrations.integration.test.ts`
- `libs/domain/src/fee.ts`
- `docs/001-architecture/canonical-accounting-model.md`
