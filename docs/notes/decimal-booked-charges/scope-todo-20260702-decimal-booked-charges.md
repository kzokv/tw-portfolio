---
slug: decimal-booked-charges
source: scope-grill
created: 2026-07-02
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Decimal Booked Charges

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope
- Decimal booked charges apply to both `commissionAmount` and `taxAmount`.
- Persist booked charges as `NUMERIC(20, 4)` and reject values with more than 4 decimal places.
- Do not silently round user/source-provided booked charges.
- Include create, patch/edit, recompute, cash ledger/accounting, API readback, MCP, and AI ingestion paths.
- Include the AI transaction draft row patch API precision bound; if the web ChatGPT draft row editor is touched, keep its commission/tax edits decimal-compatible.
- Add a forward database migration and update `db/migrations/baseline_current_schema.sql`.
- Include `trade_fee_policy_snapshot_tax_components.booked_tax_amount` in the decimal-capable schema.
- Leave fee calculation formulas, fee profile defaults, and read-only currency display formatting unchanged.
- Update web create and edit override inputs to visibly allow decimal entry while preserving empty-input semantics.
- E2E is optional unless implementation expands the user-flow surface beyond input step changes.

## Implementation Steps
- [x] Add a shared booked-charge validator/helper for non-negative finite numbers with at most 4 decimal places.
- [x] Update API transaction create and patch schemas to accept decimal `commissionAmount` and `taxAmount` using the shared booked-charge rule.
- [x] Update portfolio service booked-charge guards and error messages from integer-only semantics to decimal-capable semantics.
- [x] Update MCP transaction candidate schemas, AI draft row patch schemas, and draft posting/normalization paths so commission/tax use the shared booked-charge rule. The AI draft row patch route already accepts decimals, but still needs the agreed 4-decimal precision bound.
- [x] Add a forward migration, likely the next migration after `099_ai_connector_claude_ai_and_history_visibility.sql`, converting `trade_events.commission_amount`, `trade_events.tax_amount`, `recompute_job_items.previous_commission_amount`, `recompute_job_items.previous_tax_amount`, `recompute_job_items.next_commission_amount`, `recompute_job_items.next_tax_amount`, and `trade_fee_policy_snapshot_tax_components.booked_tax_amount` to `NUMERIC(20, 4)` with non-negative checks preserved.
- [x] Update `db/migrations/baseline_current_schema.sql` to match the migrated schema for fresh databases.
- [x] Review Postgres persistence read/write mappings for the changed columns and preserve exact decimal values through save/load, update, recompute, and transaction history paths.
- [x] Update web commission/tax override inputs from integer semantics to decimal semantics, likely `step="0.0001"`, in both the create form (`AddTransactionCard`) and transaction edit form (`EditableTransactionRow`, desktop and mobile). Replace the edit form's integer-only input helper/input mode so decimal edits can be typed and submitted.
- [x] Add or update API coverage showing `POST /portfolio/transactions` accepts and returns decimal commission/tax values.
- [x] Add or update API patch coverage showing `PATCH /portfolio/transactions/:id` accepts and persists decimal commission/tax values.
- [x] Add or update Postgres integration/migration coverage proving decimal booked charges survive save/load and schema migration paths.
- [x] Add or update MCP/schema coverage proving source-provided decimal commission/tax values are accepted where transaction candidates are ingested.
- [x] Add or update AI draft row patch coverage proving decimal commission/tax values are accepted up to 4 decimal places and rejected beyond 4 decimal places.
- [x] Add or update web unit coverage proving create-form override inputs accept decimal values and submit exact numeric values.
- [x] Update `EditableTransactionRow` unit coverage that currently asserts integer-only fee controls so edit-form commission/tax decimal values are accepted and submitted exactly on both desktop and mobile variants.
- [x] Review the ChatGPT transaction draft row editor (`ChatGptTransactionDraftWidget`) and either keep its commission/tax edit fields decimal-compatible without extra changes or add focused coverage if implementation changes that UI.
- [x] Run the focused verification set first, then broader checks as needed: relevant API tests, Postgres integration coverage for the migration/persistence path, web unit tests for the input change, and typecheck/build if shared contracts or persistence types change.

## Evidence
- Focused API: `npx vitest run test/unit/bookedCharge.test.ts test/unit/mcpPortfolioMaintenanceTools.test.ts test/integration/portfolio.integration.test.ts test/integration/transaction-mutations.integration.test.ts test/integration/mcp.integration.test.ts` passed.
- Focused web: `npx vitest run test/features/portfolio/EditableTransactionRow.test.tsx test/features/portfolio/AddTransactionCard.test.tsx` passed.
- Typecheck: `npm run typecheck` passed.
- Managed Postgres full host: `npm run test:integration:full:host` passed 94 files / 957 tests, with 1 skipped.
- Review fix: restored the existing `020_decimal_prices.sql` comment unchanged and widened dependent settlement/cost columns (`cash_ledger_entries.amount`, `lots.total_cost_amount`, `lot_allocations.allocated_cost_amount`) to `NUMERIC(20, 4)` in migration 100 plus the baseline schema.
- Review fix verification: reran `npm run test:integration:full:host`; passed 94 files / 957 tests, with 1 skipped.
- Managed Postgres targeted: with the same CI Postgres/Redis stack env, `npx vitest run --no-file-parallelism test/integration/postgres-migrations.integration.test.ts` passed 39 tests.
- Full lint: `npx eslint .` passed with 6 existing Playwright `no-conditional-expect` warnings.
- Web package tests: `npm run test --prefix apps/web` passed 68 files / 457 tests.
- API package tests: `npm run test --prefix apps/api` passed 186 files / 1895 tests, with 44 files / 438 tests skipped.
- Bypass E2E: `npm run test:e2e:bypass:mem --prefix apps/web` passed 313 tests, with 17 skipped.
- OAuth E2E: `npm run test:e2e:oauth:mem --prefix apps/web` passed 121 tests.
- API HTTP: `npm run test:http --prefix apps/api` passed 301 tests, with 2 skipped.

## Open Items
- [ ] None.

## References
- Bug symptom: `POST /portfolio/transactions` rejects `commissionAmount: 1.38` with `Expected integer, received float`.
- Current create schema: `apps/api/src/routes/registerRoutes.ts`
- Current service guard: `apps/api/src/services/portfolio.ts`
- Current web override inputs: `apps/web/components/portfolio/AddTransactionCard.tsx`
- Current edit override inputs/tests: `apps/web/components/portfolio/EditableTransactionRow.tsx`, `apps/web/test/features/portfolio/EditableTransactionRow.test.tsx`
- Current MCP integer schema: `apps/api/src/mcp/tools.ts`
- Current AI draft patch schema: `apps/api/src/routes/registerRoutes.ts`
- Existing integer schema comment: `db/migrations/020_decimal_prices.sql`
