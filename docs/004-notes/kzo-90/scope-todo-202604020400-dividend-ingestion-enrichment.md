# KZO-90: Dividend Event Ingestion Enrichment — Scope TODO

**Date:** 2026-04-02
**Status:** Scope locked
**Ticket:** [KZO-90](https://linear.app/kzokv/issue/KZO-90)

## Context

Core dividend ingestion was implemented in KZO-126 (backfill worker). The existing pipeline captures 7 of 22 FinMind `TaiwanStockDividend` fields. This ticket enriches the schema to capture the full provider response, adds typed columns for high-value fields, and adds a permanent dividend-only re-ingestion capability.

## Decisions resolved during grill session

| # | Decision | Resolution |
|---|---|---|
| 1 | `record_date` (FinMind `date` / 權利分派基準日) | Dropped — `exDividendDate` sufficient for eligible-share calculation |
| 2 | `as_of` field | No separate column — satisfied by `announcement_date` (typed) + `ingested_at` (existing) |
| 3 | Storage strategy | Typed columns for high-value queryable fields + JSONB overflow for the rest |
| 4 | Which fields get typed columns | `fiscal_year_period`, `announcement_date`, `total_distribution_shares` |
| 5 | JSONB overflow contents | Employee comp (5 fields), capital increase (3 fields), directors' remuneration, announcement time |
| 6 | `FinMindDividendRow` approach | Keep typed interface for mapped fields, pass full raw row as `Record<string, unknown>` for JSONB |
| 7 | `DividendRecord` vs split type | Expand `DividendRecord` directly (no separate `DividendIngestionRecord`) |
| 8 | `DividendEvent` store type | Add 3 optional typed fields. No `rawProviderData` in store. |
| 9 | `ON CONFLICT` for `raw_provider_data` | Full replace (not JSONB merge) — FinMind is source of truth |
| 10 | Re-ingestion strategy | Dividend-only (no bars). Permanent capability. |
| 11 | Re-ingestion ticker set | `getAllMonitoredTickers()` — monitored + open positions |
| 12 | Manual creation path (`POST /dividend-events`) | All 4 new columns NULL. No schema/route changes. |
| 13 | Migration strategy | New migration file (018 already applied to QNAP) |

## Deliverables

- [ ] **Migration**: new file adding 4 nullable columns to `market_data.dividend_events` (`fiscal_year_period TEXT`, `announcement_date DATE`, `total_distribution_shares NUMERIC`, `raw_provider_data JSONB`)
- [ ] **`DividendRecord`** (types.ts): expand with `fiscalYearPeriod`, `announcementDate`, `totalDistributionShares`, `rawProviderData: Record<string, unknown>`
- [ ] **`DividendEvent`** (store.ts): add 3 optional typed fields
- [ ] **FinMind client mapper**: pass full raw row as `rawProviderData`, map 3 typed fields
- [ ] **`upsertDividendEvents()`** (upserts.ts): add 4 columns to INSERT + UPDATE SET, full replace for JSONB
- [ ] **`saveDividendEventTx()`** (postgres.ts): add 4 columns as NULL
- [ ] **`loadStore()`** (postgres.ts): map 3 new optional fields, skip `rawProviderData`
- [ ] **Dividend-only re-ingestion**: new pg-boss job type, `fetchDividendEvents()` only, `getAllMonitoredTickers()`, `HISTORY_START`, admin endpoint
- [ ] **Tests**: unit (client mapper, enqueue logic), integration (upsert, loadStore, re-ingestion cycle, migration)

## Out of scope

- UI changes
- Daily bars re-fetch

## FinMind `TaiwanStockDividend` field mapping reference

Cached sample: `data/finmind/TaiwanStockDividend-2330.json`

| FinMind field | Chinese name | Destination |
|---|---|---|
| `stock_id` | 股票代碼 | `ticker` (existing) |
| `CashEarningsDistribution` | 現金股利:盈餘轉增資配股 | summed → `cash_dividend_per_share` (existing) |
| `CashStatutorySurplus` | 現金股利:法定盈餘公積資本公積轉增資配股 | summed → `cash_dividend_per_share` (existing) |
| `StockEarningsDistribution` | 股票股利:盈餘轉增資配股 | summed → `stock_dividend_per_share` (existing) |
| `StockStatutorySurplus` | 股票股利:法定盈餘公積資本公積轉增資配股 | summed → `stock_dividend_per_share` (existing) |
| `CashExDividendTradingDate` | 除息交易日 | `ex_dividend_date` (existing, primary) |
| `StockExDividendTradingDate` | 除權交易日 | `ex_dividend_date` (existing, fallback) |
| `CashDividendPaymentDate` | 現金股利發放日 | `payment_date` (existing) |
| `date` | 權利分派基準日 | Dropped (record date) |
| `year` | 股利所屬年度 | **`fiscal_year_period`** (new typed column) |
| `AnnouncementDate` | 公告日期 | **`announcement_date`** (new typed column) |
| `ParticipateDistributionOfTotalShares` | 參加分派總股數 | **`total_distribution_shares`** (new typed column) |
| `AnnouncementTime` | 公告時間 | **`raw_provider_data`** JSONB |
| `TotalEmployeeStockDividend` | 員工配股 | **`raw_provider_data`** JSONB |
| `TotalEmployeeStockDividendAmount` | 員工配股金額 | **`raw_provider_data`** JSONB |
| `RatioOfEmployeeStockDividendOfTotal` | 配股總股數佔盈餘配股總股數之比例 | **`raw_provider_data`** JSONB |
| `RatioOfEmployeeStockDividend` | 員工紅利配股率 | **`raw_provider_data`** JSONB |
| `TotalEmployeeCashDividend` | 員工紅利總金額 | **`raw_provider_data`** JSONB |
| `TotalNumberOfCashCapitalIncrease` | 現金增資總股數 | **`raw_provider_data`** JSONB |
| `CashIncreaseSubscriptionRate` | 現金增資認股比率 | **`raw_provider_data`** JSONB |
| `CashIncreaseSubscriptionpRrice` | 現金增資認購價 | **`raw_provider_data`** JSONB |
| `RemunerationOfDirectorsAndSupervisors` | 董監酬勞 | **`raw_provider_data`** JSONB |
