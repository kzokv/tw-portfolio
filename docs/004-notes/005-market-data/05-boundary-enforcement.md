---
step: 5 of 5
commit_name: "4: In-memory boundary enforcement + persistence split + validation"
depends_on: 04-canonical-types.md
ticket: KZO-82
---

# Step 05 — In-memory boundary enforcement + persistence split + validation update

**Depends on:** Step 04 (`InstrumentRef` type must exist for `MarketDataFacts.instruments`)

> **CRITICAL (MF-1):** This step merges the original Commits 4+5. The boundary enforcement and persistence split MUST be atomic — otherwise `registerRoutes.ts` would call `saveAccountingStore` which no longer persists dividend events, breaking the dividend create route.

## 5.1 — Store type changes

- [ ] `apps/api/src/types/store.ts`:
  - Define `MarketDataFacts`:
    ```ts
    export interface MarketDataFacts {
      dividendEvents: DividendEvent[];
      instruments: InstrumentRef[];
    }
    ```
  - Remove `dividendEvents` from `AccountingFacts`
  - Add `marketData: MarketDataFacts` to `Store`
  - Keep `symbols: SymbolDef[]` as `@deprecated` alias (phase 1 bridge)

## 5.2 — Store factory

- [ ] `apps/api/src/services/store.ts`:
  - Remove `dividendEvents: []` from `accounting.facts`
  - Add `marketData: { dividendEvents: [], instruments: [] }` to store initialization

## 5.3 — New `marketDataStore.ts`

- [ ] Create `apps/api/src/services/marketDataStore.ts`:
  - Move `upsertDividendEvent` from `accountingStore.ts` — reads/writes `store.marketData.dividendEvents`
  - Move `listDividendEvents` from `accountingStore.ts` — reads `store.marketData.dividendEvents`

## 5.4 — Clean up `accountingStore.ts`

- [ ] Remove `listDividendEvents`
- [ ] Remove `upsertDividendEvent`
- [ ] Remove `appendDividendEvent` (dead code — only `upsertDividendEvent` is used)

## 5.5 — Update service consumers

- [ ] `dividends.ts`:
  - Import `upsertDividendEvent` from `marketDataStore.ts` (not `accountingStore.ts`)
  - Access dividend events via `store.marketData.dividendEvents`
- [ ] `dashboard.ts`:
  - Access `store.marketData.dividendEvents` instead of `store.accounting.facts.dividendEvents`
- [ ] `registerRoutes.ts`:
  - Import `listDividendEvents` from `marketDataStore.ts`
  - Dividend event creation: call new `saveDividendEvent` persistence method (see 5.6)

## 5.6 — Persistence split

- [ ] `apps/api/src/persistence/postgres.ts`:
  - **`loadStore()`:** assign dividend events to `store.marketData.dividendEvents` (not `store.accounting.facts`)
  - **`saveAccountingStore()`:** remove dividend event write logic (no longer its responsibility)
  - **New `saveDividendEvent()` method** (or `saveMarketData()`): dedicated persistence for dividend events to `market_data.dividend_events`
  - **`assertAccountingInvariants()`:**
    - Remove dividend event validation (moved to market data validation)
    - Cross-reference check: `dividendLedgerEntry.dividendEventId` validated against `store.marketData.dividendEvents` (crosses the boundary explicitly)
  - **New `assertMarketDataInvariants()` function:** validates `verification_status` enum, `cash_dividend_currency` format, etc. Separate from accounting validation.
- [ ] `apps/api/src/persistence/memory.ts`:
  - Update `loadStore()` / `createStore()` — dividend events in `store.marketData`
  - `saveAccountingStore()` no longer handles dividend events
  - Add market data save path for in-memory persistence

## 5.7 — Integration test updates

- [ ] `dividends.integration.test.ts` — update access paths (`store.marketData.dividendEvents`)
- [ ] `postgres-migrations.integration.test.ts` — update access paths
- [ ] Any other integration test files that reference `store.accounting.facts.dividendEvents`

## 5.8 — Verify (full suite + Playwright MCP)

- [ ] `npx eslint .` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test --prefix apps/web` passes
- [ ] `npm run test:integration:full:host` passes
- [ ] `npm run test:e2e:bypass:mem --prefix apps/web` passes
- [ ] `npm run test:e2e:oauth:mem --prefix apps/web` passes
- [ ] **Playwright MCP — demo session:**
  - Navigate to dashboard → verify dividend section renders (data now via market data store)
  - Verify holdings and transactions still load correctly
- [ ] **Playwright MCP — dev_bypass session:**
  - Create a dividend event via the UI → verify it persists (new save path)
  - View dividend ledger entries → verify they still link to the event
  - Verify the dividend calendar/upcoming section works
  - Add a transaction → verify accounting store save still works (dividend events no longer bundled)
  - Navigate to `/tickers/{ticker}` → verify page loads with full data
