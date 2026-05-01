# Transition Note: KZO-169 — market_code selector + composite-PK migration

**Date:** 2026-05-01
**Migration:** `044_kzo169_composite_market_pk.sql`
**Tickets:** KZO-169 (delivered), KZO-184 (deferred), KZO-185 (follow-up)

---

## What changed

### Schema (migration 044)

- `market_data.instruments` — PK rewritten from `(ticker)` to `(ticker, market_code)`. The same ticker (e.g. BHP) can now exist as distinct rows for each market.
- `market_data.daily_bars` — PK rewritten from `(ticker, bar_date)` to `(ticker, market_code, bar_date)`. `market_code` column added as `NOT NULL DEFAULT 'TW'`.
- `market_data.dividend_events` — `market_code TEXT NOT NULL DEFAULT 'TW'` column added; CHECK constraint enforces `'TW' | 'US' | 'AU'`; index `(ticker, market_code)` added for lookups.
- `monitored_tickers` — `market_code TEXT NOT NULL DEFAULT 'TW'` column added; CHECK constraint applied; PK updated from `(user_id, ticker)` to `(user_id, ticker, market_code)`.
- Forward-only migration. Existing rows backfill implicitly via `DEFAULT 'TW'` at `ADD COLUMN` time. No data movement required.

### Persistence layer

- `getInstrument`, `getDailyBars`, `getDividendEvents`, `upsertInstruments` — all now require `(ticker, marketCode)` composite lookup.
- `listInstrumentsCatalog` — accepts optional `market_code` filter; unfiltered returns all markets.
- `bulkInsertDailyBars` — `marketCode` field tightened to required.
- `getMonitoredSet` — return shape adds `marketCode` per entry.
- `replaceManualSelections` — body items change from `string[]` to `{ ticker, marketCode }[]`.
- JOIN queries at `postgres.ts:6074, 6102` — now join on `(ticker, market_code)` composite key.
- `MemoryPersistence` mirrored; composite Map key is `` `${ticker}|${marketCode}` ``.
- All application-side `?? "TW"` fallbacks removed; routes now fail loudly via `routeError` when `marketCode` is absent. Only the SQL migration `DEFAULT 'TW'` backfill remains.

### API routes

- `GET /instruments` — new `market_code=TW|US|AU|ALL` query param (default `ALL`). Passing a specific market filters results server-side.
- `POST /portfolio/transactions` — `marketCode` field now required. Trade currency derived from `currencyFor(marketCode)`; server enforces `account.defaultCurrency === tradeCurrency` and rejects mismatches with `400 currency_mismatch`.
- `POST /portfolio/transactions/estimate` — `marketCode` now required; trade currency derived from instrument, not from the fee profile.
- `PUT /monitored-tickers` — request body changes from `{ tickers: string[] }` to `{ tickers: { ticker: string; marketCode: string }[] }`.
- Backfill job `singletonKey` changes from `body.ticker` to `` `${ticker}:${marketCode}` ``; pgboss handler accepts both old `{ ticker, userId }` and new `{ ticker, marketCode, userId }` payloads via Zod union (back-compat shim; removed in KZO-185).

### Shared types

- `MarketCode = "TW" | "US" | "AU"` union type added.
- `currencyFor(marketCode: MarketCode): string` helper — TW→TWD, US→USD, AU→AUD.
- `marketCodeFor(currency: string): MarketCode` reverse helper.
- `TransactionHistoryItemDto.marketCode` tightened from `string | null` to `string`.
- `MonitoredTickerDto` gains `marketCode: string`.

### Web UI

- `AddTransactionCard` — chip row added above existing fields (TW / US / AU / All). Default chip derived from the user's account currencies: TW-only users default to TW; multi-currency users default to All; zero-account edge case defaults to All.
- `InstrumentCombobox` — `marketCodeFilter` prop added; ALL-mode rows display `TICKER · MARKET` disambiguation suffix; specific-market mode suppresses suffix; `onSelect` emits both `ticker` and `marketCode`.
- Currency input locks to `currencyFor(chip + ticker)` once an instrument is committed; no user override.
- Account dropdown filters to currency-compatible accounts only. If no compatible account exists for the derived currency, an inline error renders: "No {currency} account available — [+ Create {currency} account]". The link opens the KZO-179 account creation flow with `defaultCurrency` prefilled.
- On account creation success: accounts list auto-refetches; newly created account auto-selected.
- `RecordTransactionDialog` — prop renamed `tickerReadOnly` → `instrumentReadOnly`.
- Settings monitored-tickers UI — rows display `TICKER · MARKET`; PUT body updated to `{ tickers: [{ ticker, marketCode }] }`.

---

## Behavioral deltas (intentional, not regressions)

These are deliberate changes that may surface in logs, alerts, or client behavior:

1. **`POST /portfolio/transactions` — `marketCode` is now required.** Any caller that omits `marketCode` receives `400` from the Zod schema guard. This affects bulk importers, API clients, and integration tests that were constructed before this ticket. All in-tree tests updated (G4 audit).

2. **`400 currency_mismatch` is now possible on `POST /portfolio/transactions`.** When the caller sends `marketCode: "US"` but the target account has `defaultCurrency: "TWD"`, the route rejects with `{ error: "currency_mismatch", message: "Trade currency USD does not match account currency TWD" }`. This is a new 400 path; previously any currency was accepted.

3. **`POST /portfolio/transactions/estimate` — `marketCode` now required.** Previously the estimate derived trade currency from the fee profile's `commissionCurrency`. It now derives from `currencyFor(marketCode)`. Callers that omit `marketCode` receive `400`.

4. **`PUT /monitored-tickers` body shape changed.** Old shape `{ tickers: ["AAPL", "2330"] }` now rejected. New shape required: `{ tickers: [{ ticker: "AAPL", marketCode: "US" }, { ticker: "2330", marketCode: "TW" }] }`.

5. **`GET /instruments` default is now `ALL` markets.** Callers that previously received only TW results (when the filter was absent) now receive all markets. The response shape is unchanged; rows now carry a non-null `marketCode`. Any UI that renders the instrument list without a suffix should add `TICKER · MARKET` display logic for multi-market rows.

6. **Backfill `singletonKey` changed from `ticker` to `ticker:marketCode`.** In-flight pgboss jobs queued before this deploy under the old key are handled by the back-compat Zod union in `backfillWorker.ts` (defaults to `marketCode = "TW"`). See KZO-185 for the shim removal schedule.

7. **`TransactionHistoryItemDto.marketCode` is now `string` (non-null).** Any client that branched on `null` to display a fallback label may show `"TW"` where it previously showed a default. For the in-tree web client this is transparent; external consumers should update their null-branch logic.

---

## Migration notes

Migration `044_kzo169_composite_market_pk.sql` is **forward-only** (no down migration).

**What the migration does:**

1. Drops the existing PK on `market_data.instruments(ticker)` and recreates it as `(ticker, market_code)`. Uses `DO $$` idempotency guard (same pattern as migration 039).
2. Adds `market_code TEXT NOT NULL DEFAULT 'TW'` to `market_data.daily_bars`; drops the existing PK `(ticker, bar_date)` and recreates as `(ticker, market_code, bar_date)`.
3. Adds `market_code TEXT NOT NULL DEFAULT 'TW'` + CHECK enum to `market_data.dividend_events`; adds index `(ticker, market_code)`.
4. Adds `market_code TEXT NOT NULL DEFAULT 'TW'` + CHECK enum to `monitored_tickers`; drops the existing PK `(user_id, ticker)` and recreates as `(user_id, ticker, market_code)`.

**Existing data:** All current rows are Taiwan-market rows (`market_code = 'TW'`). The `DEFAULT 'TW'` on each `ADD COLUMN` backfills them automatically at DDL time. No explicit `UPDATE` statement is required.

**Rollback:** Because this is a forward-only migration and involves PK rewrites, rollback requires both reverting the application code (all callers of updated persistence APIs) AND manually restoring the prior PK structures via a hand-crafted reversal migration. This is not automated. If a rollback is needed post-deploy, create a new migration that drops the composite PKs, re-adds `(ticker)` / `(ticker, bar_date)` / `(user_id, ticker)`, and drops the `market_code` columns — then redeploy the prior application version.

---

## Breaking changes for API consumers

| Endpoint | Change | Action required |
|---|---|---|
| `POST /portfolio/transactions` | `marketCode` field now required in request body | Add `marketCode` to all transaction payloads |
| `POST /portfolio/transactions/estimate` | `marketCode` field now required | Add `marketCode` to all estimate payloads |
| `PUT /monitored-tickers` | Body items changed from `string[]` to `{ ticker, marketCode }[]` | Update to new body shape |
| `GET /instruments` | Default `market_code=ALL` returns all markets; rows always carry non-null `marketCode` | Update display logic to handle multi-market rows |

**Renamed prop (web-internal):**

| Old | New |
|-----|-----|
| `tickerReadOnly` | `instrumentReadOnly` (on `AddTransactionCard` and `RecordTransactionDialog`) |

---

## Post-deploy checklist

After deploying this migration and the updated application:

1. **Run the migration.** Confirm `schema_migrations` contains `044_kzo169_composite_market_pk.sql`.
2. **Verify TW instruments load.** Spot-check `GET /instruments?market_code=TW` — should return the same rows as before, each now with `marketCode: "TW"`.
3. **Verify monitored tickers.** Spot-check `GET /user/monitored-tickers` — all rows should include `marketCode: "TW"`.
4. **Confirm transaction form chip renders.** Open the Add Transaction form; verify the market chip row (TW / US / AU / All) appears; verify TW-only users default to TW chip.
5. **Monitor error logs for `currency_mismatch`.** This is a new 400 code. A spike here indicates a client (e.g. bulk importer) sending transactions without the new `marketCode` field or sending a mismatched market-account pair.
6. **Monitor pgboss queue for in-flight backfill jobs.** Jobs queued before deploy carry the old `singletonKey` (bare ticker). The Zod union back-compat shim handles them and defaults to `marketCode = "TW"`. The queue should drain within 24h of deploy.
7. **Schedule KZO-185 cleanup.** Remove the Zod union back-compat shim from `backfillWorker.ts` after ≥24h queue drain confirmation. Do not merge KZO-185 until this window has passed.

---

## Out of scope (follow-up tickets)

- **KZO-184** — DIV / STOCK_DIV / SPLIT user-entry transaction types. Polymorphic form, new cash-ledger posting paths, reconciliation interaction. Requires scope-grill before implementation. Also needs to thread `marketCode` through `generateHoldingSnapshots`.
- **KZO-185** — pgboss back-compat Zod union removal. Merge ≥24h after KZO-169 production deploy and queue drain confirmation.
- **KZO-175** — Transaction history table and holdings table multi-market display. KZO-169 leaves existing tables untouched; `marketCode` is now non-null on all rows, giving KZO-175 clean material.
- **KZO-170** (US instrument ingestion) and **KZO-172** (AU instrument ingestion) — real US/AU instrument data from the FinMind/market-data provider. KZO-169 ships the schema and UI; ingestion can land independently without coordination.
- **KZO-178** — CSV importer for IBKR Activity Statements. Reads KZO-169 schema; no code coordination needed beyond this migration landing first.
