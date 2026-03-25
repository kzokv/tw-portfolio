---
step: 1 of 5
commit_name: "1a: Backend glossary rename"
depends_on: null
ticket: KZO-82
---

# Step 01 — Backend glossary rename (`symbol` → `ticker`, `source_type` → `source`)

## 1.1 — SQL migration `017_rename_symbol_to_ticker_and_source.sql`

- [x] Column renames (`ALTER TABLE ... RENAME COLUMN`):
  - `trade_events.symbol` → `ticker`
  - `lots.symbol` → `ticker`
  - `corporate_actions.symbol` → `ticker`
  - `account_fee_profile_overrides.symbol` → `ticker`
  - `lot_allocations.symbol` → `ticker`
  - `dividend_events.symbol` → `ticker`
  - `trade_events.source_type` → `source`
  - `dividend_events.source_type` → `source`
  - `cash_ledger_entries.source_type` → `source`
  - `dividend_deduction_entries.source_type` → `source`
  - `reconciliation_records.source_type` → `source` (**SQL-only** — no TypeScript callers exist for this table)
- [x] Index drop + recreate (Postgres renames column OIDs but NOT index names — stale names cause confusion):
  - `idx_lots_account_symbol` → `idx_lots_account_ticker`
  - `ux_lots_account_symbol_opened_order` → `ux_lots_account_ticker_opened_order`
  - `idx_trade_events_account_symbol_trade_date` → `idx_trade_events_account_ticker_trade_date`
  - `idx_trade_events_account_market_symbol_trade_date` → `idx_trade_events_account_market_ticker_trade_date`
  - `idx_trade_events_account_symbol_booking_order` → `idx_trade_events_account_ticker_booking_order`
  - `idx_symbols_market_code_ticker` → (will be dropped with `public.symbols` in Step 03)
  - `idx_lot_allocations_account_symbol` → `idx_lot_allocations_account_ticker`
  - `idx_dividend_events_symbol_ex_dividend_date` → `idx_dividend_events_ticker_ex_dividend_date`
  - `ux_dividend_events_symbol_source_reference` → `ux_dividend_events_ticker_source_reference` (references BOTH renamed columns)
  - `idx_account_fee_profile_overrides_account_market_symbol` → `idx_account_fee_profile_overrides_account_market_ticker`

## 1.2 — Update `baseline_current_schema.sql`

- [x] Update ALL table definitions with renamed columns
- [x] Update ALL index definitions (both names and column references)
- [x] Verify no stale `symbol` or `source_type` references remain in the file

## 1.3 — TypeScript type renames (`symbol` → `ticker`)

- [x] `apps/api/src/types/store.ts`:
  - `BookedTradeEvent.symbol` → `ticker`
  - `CorporateAction.symbol` → `ticker`
  - `HoldingProjection.symbol` → `ticker`
  - `LotAllocationProjection.symbol` → `ticker`
  - `DividendEvent.symbol` → `ticker`
  - `FeeProfileBinding.symbol` → `ticker`
- [x] `libs/domain/src/types.ts`:
  - `Lot.symbol` → `Lot.ticker`

## 1.4 — TypeScript type renames (`sourceType` → `source`)

> **Wire-format breaking change.** This renames JSON field names in API request/response bodies. Safe because single-user monorepo with atomic frontend+backend deploy.

- [x] `apps/api/src/types/store.ts`:
  - `BookedTradeEvent.sourceType` → `source`
  - `BookedTradeEvent.sourceReference` stays (not renamed)
  - `CashLedgerEntry.sourceType` → `source`
  - `DividendEvent.sourceType` → `source`
  - `DividendDeductionEntry.sourceType` → `source`
- [x] Zod schemas in `registerRoutes.ts`:
  - Any Zod schema validating `sourceType` field → rename to `source`
  - `CreateDividendEventInput` (if it exists in `dividends.ts`) → rename field

## 1.5 — Shared types DTO renames

- [x] `libs/shared-types/src/index.ts` — rename `.symbol` → `.ticker` in ALL these interfaces:
  - `DashboardOverviewHoldingDto.symbol`
  - `DashboardOverviewUpcomingDividendDto.symbol`
  - `DashboardOverviewRecentDividendDto.symbol`
  - `TransactionHistoryItemDto.symbol`
  - `FeeProfileBindingDto.symbol`
  - `DeleteTransactionResponse.symbol`
  - `PatchTransactionResponse.symbol`
  - (Note: `SymbolOptionDto.ticker` is already correct)
- [x] `libs/shared-types/src/events.ts` — rename `.symbol` → `.ticker`:
  - `RecomputeCompleteEvent.symbol`
  - `RecomputeFailedEvent.symbol`
- [x] Rename `sourceType` → `source` in any shared DTO that exposes it

## 1.6 — Persistence layer SQL updates

- [x] `apps/api/src/persistence/postgres.ts`:
  - Find/replace `symbol` → `ticker` in ALL SQL query strings (~30 sites)
  - Find/replace `source_type` → `source` in ALL SQL query strings (~20 sites)
  - Update column mapping objects (JS property → SQL column)
- [x] `apps/api/src/persistence/memory.ts`:
  - Update any field references from `symbol` → `ticker`
  - Update `quoteCache` key references: `quote.symbol` → `quote.ticker`

## 1.7 — Service layer updates

- [x] `symbolRegistry.ts` — all `symbol` refs → `ticker` (~10 sites)
- [x] `dividends.ts` — field access + any `sourceType` refs
- [x] `dashboard.ts` — field access (~15 sites) + `Quote` consumer sites: `quote.symbol` → `quote.ticker` (2 sites)
- [x] `portfolio.ts` — field access (~14 sites)
- [x] `recompute.ts` — field access
- [x] `accountingStore.ts` — field access (~4 sites)
- [x] `store.ts` — factory/initializer
- [x] `demoData.ts` — fixture data (~15 sites)
- [x] `replayPositionHistory.ts` — field access (~8 sites)

## 1.8 — Routes and provider

- [x] `registerRoutes.ts` — field names in request/response bodies, Zod schemas (~28 sites). Also update `Quote` consumer sites (~2 sites)
- [x] `marketData.ts` — `Quote.symbol` → `Quote.ticker`, update mock providers

## 1.9 — Backend tests

- [x] `apps/api/test/helpers/fixtures.ts` — update ALL fixture factory functions (`symbol` → `ticker`, `sourceType` → `source`)
- [x] `apps/api/test/integration/dividends.integration.test.ts` — field renames
- [x] `apps/api/test/integration/postgres-migrations.integration.test.ts` — field renames
- [x] All other API test files referencing `symbol` or `sourceType`
- [x] `libs/domain/test/lot.test.ts` — `symbol` → `ticker`

## 1.10 — Verify

- [x] `npx eslint .` passes
- [x] `npm run typecheck` passes
- [x] `npm run test:integration:full:host` passes
- [x] `npm run test --prefix apps/web` passes
