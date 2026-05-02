# Transition Note: KZO-170 — US Market Data Ingestion

**Date:** 2026-05-02  
**Ticket:** KZO-170  
**Related:** KZO-163 (provider registry), KZO-164 (Frankfurter FX), KZO-169 (composite PK), KZO-186 (splits follow-up), KZO-187 (US dividend ingestion)

---

## What shipped

KZO-170 plugged the US market data provider (`FinMindUsStockMarketDataProvider`) into the registry slot built by KZO-163. Key additions:

- **Price ingestion** via FinMind `USStockPrice` dataset (`Close` column, unadjusted). AAPL/MSFT/VOO/BND are the E2E-reserved tickers.
- **Catalog ingestion** via FinMind `USStockInfo` dataset. `Subsector` field carries free-text exchange classification; a hand-curated allow-list maps VOO/BND to ETF/BOND_ETF, with STOCK as the default fallback.
- **Required `marketCode` param** on `/market-data/price`. The old `resolveMarketCode()` stub that always returned `"TW"` is deleted. Clients must pin the market explicitly.
- **Per-market catalog sync reschedule** — `registerCatalogSyncWorker.ts` now supports `{ pendingMarkets }` on the `catalog-sync` queue so a mid-sweep `RateLimitedError` only replays the incomplete markets.
- **`HISTORY_START_BY_MARKET`** map — US history start is `2019-06-01`; trade dates predating that are silently truncated to the provider start.
- **D1/D1b currency fix** — `upsertDividendEvents()` previously hardcoded `'TWD'` for `cash_dividend_currency` on every row regardless of market. Fixed to derive from `currencyFor(ev.marketCode)`. Same fix applied to the `dividends.ts:593` DIVIDEND_INCOME source-line auto-fill. This is the day-one gate that makes KZO-187's US dividend ingestion correct on first commit.

---

## (a) Splits limitation — AAPL 2020-08-31 4-for-1

**KZO-170 does NOT handle stock splits.** Lot allocation and cost-basis calculations use the raw per-share prices returned by the provider without any adjustment for historical splits.

**Worked example — AAPL 4-for-1 split, 2020-08-31:**

| Date | Pre-split shares | Post-split shares | Pre-split price | Post-split price |
|------|-----------------|------------------|-----------------|------------------|
| 2020-08-28 (day before) | 10 | — | $500/share = $5,000 basis | — |
| 2020-08-31 (split day) | — | 40 | — | $125/share = $5,000 basis |

Without split adjustment, a user who bought 10 AAPL at $500 in 2020 will see their position as 10 shares × ~$125 (post-split market price) = $1,250 instead of the correct $5,000 cost-basis. The variance is visible immediately in the unrealized P&L column.

**KZO-186 owns the fix.** That ticket will ship:
- Split event ingestion from a provider (TBD — FinMind has `USStockSplitDividend`, Yahoo Finance is an option)
- Replay invariant 6: split-aware lot adjustment that retroactively adjusts all pre-split lot entries for the split ratio
- The AAPL 2020-08-31 4-for-1 split as the reference regression case

Until KZO-186 ships, US stocks with post-KZO-170 trade-entry dates (≥ 2024-01-01 per the mock fixture boundary) are not affected by historical splits — they buy at current post-split prices. Only historical trades entered retroactively cross a split date.

---

## (b) FinMind 600/hr shared budget + per-market reschedule mitigation

FinMind's v4 API enforces a **600-request-per-hour** rate limit shared across all calls made with the same API token, regardless of dataset or endpoint. The TW provider (daily bars, dividends, catalog) and the US provider (daily bars, catalog) share this single budget.

**Mitigation shipped in KZO-170 (D12):**

The `catalog-sync` cron job payload schema now supports `{ pendingMarkets?: ("TW" | "US" | "AU")[] }`. When the shared-budget rate limit fires mid-sweep:

1. The handler catches `RateLimitedError` and records which markets completed before the error.
2. It re-enqueues the job with `pendingMarkets = remaining` (only markets NOT yet completed).
3. The re-enqueued job starts after `retryAfterSeconds` from the error.
4. Completed markets' tickers get their daily-refresh enqueue immediately (they don't have to wait for the rescheduled job).

The cron still sends `{}` (empty payload) — back-compat unchanged.

**Operator levers:**
- `FINMIND_RATE_LIMIT_PER_HOUR` env var overrides the 600/hr default if FinMind raises the limit for higher tiers.
- Catalog-sync is `policy: "singleton"` — duplicate cron fires are deduplicated by pg-boss.

---

## (c) Pre-provider trade-date truncation

`backfillWorker.ts` enforces per-market history start dates:

| Market | `historyStartFor(market)` | Notes |
|--------|--------------------------|-------|
| TW | `1994-10-01` | TWSE listing date |
| US | `2019-06-01` | FinMind `USStockPrice` dataset availability |
| AU | `1994-10-01` | Placeholder; **TODO(KZO-171): pin AU history start** |

**Worked example:**

A user enters an AAPL trade dated `2018-01-15` (pre-2019-06-01). The backfill worker receives `startDate = "2018-01-15"`.

- `effectiveStartDate = max("2018-01-15", historyStartFor("US")) = "2019-06-01"`
- Worker logs: `{ level: "info", ticker: "AAPL", requestedStartDate: "2018-01-15", providerStartDate: "2019-06-01" }` with message `"pre_provider_history_truncated"`
- The backfill request to FinMind uses `from: "2019-06-01"`, not `"2018-01-15"`

**User-observable effect:** the portfolio chart for AAPL will be empty before 2019-06-01, even if the user entered a trade date predating that. The trade itself is accepted and persisted normally — only the historical bar data starts from the provider's earliest availability.

This is a **silent truncation** (no 4xx, no UI error message). KZO-177's provider health UI may surface this as a "data starts from [date]" indicator in a future ticket.

---

## (d) USD commission currency caveat for fee profiles

KZO-170 does not ship default US fee profile templates. Users adding USD-denominated accounts need to:

1. Create a fee profile with `commission_currency = "USD"` (not the TW default `"TWD"`).
2. Assign the fee profile to their USD brokerage account.

Without this, commission estimates on the transaction form will show TWD-denominated estimates for US trades. A TBD ticket will add default fee profile templates per market as a quality-of-life improvement.

---

## (e) `industry_category_raw` carrying US exchange string verbatim

FinMind's `USStockInfo` returns `Subsector` as a free-text string (e.g. `"Computer Manufacturing"`, `"Investment Trusts/Mutual Funds"`, `"Blank Checks"`). KZO-170 stores this verbatim in the `market_data.instruments.industry_category_raw` column — no structured schema change.

The `classifyInstrument()` function in `libs/domain/src/classifyInstrument.ts` uses a hand-curated allow-list keyed on `(subsector, ticker)` to derive `InstrumentType`. The allow-list seeds VOO and other `"Investment Trusts/Mutual Funds"` entries as ETF; BND as BOND_ETF; AAPL/MSFT and unknown subsectors as STOCK.

If a downstream consumer needs structured exchange sub-classification (exchange code, sector enum, etc.), it should add an `exchange_subcode` column or equivalent — the first consumer owns the schema addition.

---

## (f) FinMind US dataset gap — dividends and delistings

FinMind v4 does **not** have `USStockDividend` or `USStockDelisting` datasets. Verified 2026-05-02 via curl:

- `https://api.finmindtrade.com/api/v4/data?dataset=USStockDividend` → HTTP 422 (`"dataset does not exist in enum"`)
- `https://api.finmindtrade.com/api/v4/data?dataset=USStockDelisting` → HTTP 422 (`"dataset does not exist in enum"`)

As a result:
- `FinMindUsStockMarketDataProvider.fetchDividends()` returns `[]` — intentional empty implementation.
- `FinMindUsStockMarketDataProvider.fetchDelistingHistory()` returns `[]` — intentional empty implementation.
- `MockFinMindUsStockMarketDataProvider` mirrors this exact shape (no mock dividends, no mock delistings).

**KZO-187** owns US dividend ingestion via an alternate provider (Yahoo Finance / Alpha Vantage / manual entry). KZO-187 inherits the AAPL ≥4 quarterly dividend acceptance criterion originally on KZO-170.

**The D1/D1b `cash_dividend_currency` fix is the critical prerequisite:** it ensures that when KZO-187 first lands US dividends via `upsertDividendEvents()`, every row will correctly stamp `cash_dividend_currency = 'USD'` rather than the old hardcoded `'TWD'`. KZO-187 requires no schema or persistence-layer changes to be correct on its first commit — the fix is already in `main` via this PR.

US delisting detection is deferred; may fold into KZO-187 as a Phase 2 or open a separate ticket later.

---

## What's next

| Ticket | What |
|--------|------|
| **KZO-186** | Stock splits ingestion + replay invariant 6 (lot adjustment). Priority: unblocked. |
| **KZO-187** | US dividend ingestion via alternate provider (Yahoo / Alpha Vantage / manual). Prerequisite D1/D1b fix is in this PR. |
| **KZO-171** | AU market data provider (skeleton wired, `historyStartFor("AU")` has `// TODO(KZO-171)` placeholder). |
| **KZO-177** | Per-provider health UI + stale-data badges. The `provider.providerId` interface field ships in this PR as groundwork. |
