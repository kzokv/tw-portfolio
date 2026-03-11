# Latest Handoff

## Completed
- Implemented most of `KZO-55` hard retirement of TWD/NTD-specific fields across domain types, shared types, API routes, services, persistence, migration SQL, and web consumers.
- Added `db/migrations/008_retire_twd_ntd_fields.sql` to rename `_ntd` columns to neutral amount names, add explicit currency columns, backfill them to `TWD`, and remove TWD-only dividend currency checks.
- Updated web transaction, settings, and holdings flows to use neutral amount fields plus explicit currency codes.
- Verified on March 11, 2026:
  - `npm run build -w @tw-portfolio/web`
  - `npm run test:unit -w apps/web`
  - `npx playwright test apps/web/tests/e2e/specs/transactions-weighted-average-buy-sell.spec.ts --config=apps/web/tests/e2e/playwright.config.ts`
  - `npx playwright test apps/web/tests/e2e/specs/settings-binding-affects-transaction-fees.spec.ts --config=apps/web/tests/e2e/playwright.config.ts`
  - `npm run build -w libs/domain -w libs/shared-types`
  - `npm run build -w @tw-portfolio/api`
  - `npm run test -w libs/domain`
  - `npm run test -w apps/api`

## Remaining work
- Update `apps/api/test/integration/postgres-migrations.integration.test.ts` for the hard-cutover schema and contracts:
  - rename direct SQL column references from legacy `_ntd` names
  - add explicit `price_currency`, `commission_currency`, `cash_dividend_currency`, `cost_currency`, and snapshot `currency` fields where fixtures bypass route defaults
  - update expectations to neutral amount names and explicit currency-bearing objects
- Re-run `npm run test:integration:ci:host` after the fixture and SQL updates.

## Risks or blockers
- `npm run test:integration:ci:host` still fails only in `apps/api/test/integration/postgres-migrations.integration.test.ts`.
- The web keeps `TWD` as the default currency for new transactions and fee profiles; this is intentional default data, not a legacy contract.
- Currency entry in the web UI is currently free-form 3-letter uppercase text. If product wants a constrained list or market-specific rules, that should be a follow-up ticket.
- Two Playwright specs currently need serial execution because parallel runs try to start duplicate local web and API servers on the same ports.

## Open questions
- Whether product wants currency entry to remain free-form 3-letter uppercase codes or move to a constrained currency list or market-specific rule set in a later ticket.

## Relevant files
- `db/migrations/008_retire_twd_ntd_fields.sql`
- `apps/api/src/persistence/postgres.ts`
- `apps/api/src/routes/registerRoutes.ts`
- `apps/api/src/services/portfolio.ts`
- `apps/api/src/services/dividends.ts`
- `apps/api/test/integration/postgres-migrations.integration.test.ts`
- `apps/web/components/portfolio/AddTransactionCard.tsx`
- `apps/web/features/settings/components/FeeProfilesSection.tsx`
