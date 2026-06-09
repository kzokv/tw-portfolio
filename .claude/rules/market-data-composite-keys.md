# Market Data Composite Keys

Any report, dashboard, quote, bar, freshness, or backfill path that identifies market data for a security must preserve `(ticker, marketCode)` as the identity when market code is available. Do not key historical bars, quotes, or in-memory collectors by bare `ticker` in multi-market code paths.

## Why

Cross-listed tickers can share the same `ticker` string across markets. For example, `BHP/AU` and `BHP/US` must resolve to different daily bars, providers, currencies, and valuation results. A bare-ticker map or persistence call can silently use the wrong market's close and produce incorrect Market Value or return numbers.

## Apply

- Prefer persistence methods that accept both ticker and market, such as `getDailyBarsForTickerMarket(ticker, marketCode, ...)`, when replaying or repairing performance series.
- Build map keys with a composite helper such as `quoteSnapshotKey(ticker, marketCode)` instead of `ticker`.
- When collecting unique securities from trades, holdings, snapshots, monitored tickers, or quote rows, dedupe by `(ticker, marketCode)`, not by ticker alone.
- Tests for synthetic or repaired historical performance should include a same-ticker cross-market case when the code reads bars or quotes.

## Check

Before submitting a market-data/reporting change, grep for new bare-ticker collectors or ticker-only historical bar calls in changed files:

```bash
rg -n "new Map|new Set|getDailyBarsForTickers|\\.set\\([^,]*ticker|\\[.*ticker.*\\]" apps/api/src apps/api/test
```

Bare-ticker usage is still valid only when the surrounding contract is explicitly single-market, the value is display-only, or the key is immediately paired with `marketCode` before any market-data lookup.

## Provenance

Promoted from the dashboard-reporting-ui PR review closure on 2026-06-09. The synthetic performance fallback originally loaded repaired daily bars by bare ticker, which could mix same-ticker AU/US closes. The fix changed the fallback to load bars by `(ticker, marketCode)` and added same-ticker cross-market regression coverage in `apps/api/test/unit/dashboardReportingCurrency.test.ts`; `apps/api/test/integration/reports.integration.test.ts` now asserts the market-aware daily-bar lookup is used.
