# Route Analytics Roadmap: Grouped Holdings

Date: 2026-06-01
Scope: `portfolio-holdings-aggregation`

## Implemented In This Slice

- `/dashboard`
  - Uses aggregated holding groups for the allocation snapshot chart.
  - Uses aggregated holding groups for biggest movers so one ticker/market appears once even when held in multiple accounts.
  - Holdings table defaults to an expanded grouped view with parent ticker/market rows and account child rows.

- `/portfolio`
  - Uses the grouped holdings table with display modes for grouped, expanded, and account-only views.
  - Adds market, account, quote-status, column, and allocation-basis controls using shadcn-style primitives.
  - Allocation can be read by market value or cost basis; missing quotes are labeled when cost basis is used as fallback.

- `/tickers/[ticker]`
  - Supports market-scoped aggregate route state via `?marketCode=`.
  - Account child rows link to `?marketCode=...&accountId=...`.
  - API returns `holdingGroup` and `accountBreakdown` alongside the existing position, transactions, dividends, fundamentals, and chart payload.
  - Page-level chart data uses the aggregate average cost when the route is market-scoped rather than account-scoped.

- `/share/[token]`
  - Public payload includes aggregated `holdingGroups`.
  - Public UI renders ticker/market aggregate rows and account counts without exposing child account identities or cost basis.

## Recommended Next Charts

- `/portfolio`
  - Allocation by ticker/market: stacked or donut view using grouped market value by default.
  - Allocation by account: compare where grouped holdings sit across broker, bank, and wallet accounts.
  - Allocation by currency: useful for mixed TW/US/AU/KR portfolios and reporting-currency drift.
  - Quote coverage: current/provisional/missing grouped by market to show data quality.

- `/tickers/[ticker]`
  - Account contribution bar chart: child account market value or cost basis within the selected ticker/market.
  - Price vs average cost line/overlay: latest market price plus aggregate weighted average cost.
  - Dividend timeline: upcoming and posted events filtered to the selected ticker/market/account scope.

- `/transactions`
  - Realized P&L by ticker/market.
  - Fees and taxes by broker account and market.
  - Trade volume by market and currency.

- `/dividends`
  - Dividend income by ticker/market and account.
  - Upcoming dividend calendar heatmap by payment month.
  - Withholding/deduction trend by market.

- `/cash-ledger`
  - Cash balance by account/currency.
  - Deposit, withdrawal, dividend, and fee flows over time.
  - FX transfer flow between source and target currencies.

- `/settings/tickers`
  - Catalog coverage by market.
  - Provider backfill status by ticker and market.
  - Quote staleness and repair queue status.

- `/admin`
  - Provider health by market.
  - FX-rate coverage and stale-pair count.
  - User portfolio quote coverage distribution.

## Data Notes

- Group identity is ticker plus market code. Currency remains a native display and reporting-field concern.
- Authenticated grouped rows may include cost basis and average cost. Anonymous public share rows must not.
- Allocation basis is a user display preference. It should not change stored portfolio math.
- Missing quote fallback is allocation-only; it must not synthesize market value or unrealized P&L.

## Validation Notes

- Portfolio E2E covers grouped/expanded display, toolbar control presence, allocation-basis persistence, parent ticker navigation, and child account navigation.
- Public share E2E covers multi-account grouped rows and verifies cost basis stays hidden.
- API unit and HTTP coverage guard grouping math, reporting-currency translation, missing-quote fallback, preference persistence, and public DTO shape.
