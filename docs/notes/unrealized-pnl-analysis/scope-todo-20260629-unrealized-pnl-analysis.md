---
slug: unrealized-pnl-analysis
source: scope-grill
created: 2026-06-29
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Unrealized P&L Analysis

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Add a top-level Analysis area with `/analysis` as a minimal index and `/analysis/unrealized-pnl` as the first workspace.
- Keep Reports as overview/discovery, not the deep analysis surface.
- Default the analysis workflow to portfolio-to-ticker decomposition.
- Use total unrealized P&L trend, ticker contribution/ranking, selected ticker comparison, and selected ticker detail.
- Support user-configurable comparison line count, default `5`, max `20`.
- Support filters for range/custom dates, daily/weekly/monthly/yearly granularity, markets, accounts, tickers, selection mode, ticker limit, holdings state, reporting currency, provisional rows, and instrument type when metadata supports it.
- Exclude advanced overlays from v1: sector/industry, benchmark, dividend-adjusted return, FX attribution, realized plus unrealized total return, and lot-level drilldown.
- Add MCP tool `get_unrealized_pnl_report`; do not add `get_price_bars` in v1.
- Use restrained motion plus focus scrub. Selected ticker lines stay prominent; unselected lines remain visible but muted.
- Default selected tickers to auto top drivers by absolute period unrealized P&L change.
- Treat unrealized P&L as point-in-time open-position P&L from `daily_holding_snapshots`.
- Define period change as `end unrealized P&L - start unrealized P&L`, with transaction and quantity context.
- Exclude full price-effect versus transaction-effect attribution from v1.
- Exclude sold-out tickers by default. When included, continue their series at `0` after full exit with muted/dashed styling.
- Never forward-fill missing prices for P&L calculation. Exclude provisional rows by default.
- Store deterministic analysis state in the URL and presentation defaults in user preferences.
- Use one shared backend service for UI and MCP: `buildUnrealizedPnlAnalysis(...)`.
- Enforce API bounds: daily/weekly/monthly max `5Y`, `ALL` only for yearly, ranking default `100`, ranking max `500`.
- Reuse the existing route DTO cache pattern for the analysis page.
- Show trade markers only: buy, partial sell, full exit, and aggregate same-date marker.
- Implement in three vertical slices: backend plus MCP, analysis UI, then Reports/Dashboard discovery links.

## Implementation Steps

- [x] Add shared DTO and query types for Unrealized P&L analysis in `libs/shared-types`.
- [x] Add parsing and validation for `/analysis/unrealized-pnl` query state, including API bounds and granularity rules.
- [x] Add persistence support to aggregate `daily_holding_snapshots` by date, market, ticker, account scope, and reporting currency.
- [x] Implement period-end bucketing for daily, weekly, monthly, and yearly snapshots.
- [x] Implement sold-out historical behavior: excluded by default, post-exit zero series with exit marker when included.
- [x] Implement transaction marker derivation for buy, partial sell, full exit, and aggregate same-date events.
- [x] Implement `buildUnrealizedPnlAnalysis(...)` as the shared backend service for API and MCP.
- [x] Add `GET /analysis/unrealized-pnl` API route.
- [x] Add MCP tool definition and handler for `get_unrealized_pnl_report`.
- [x] Ensure MCP output includes summary, portfolio series, ticker series, rankings, selected tickers, data health, diagnostics, resolved filters, and deterministic `deepLink`.
- [x] Add backend tests covering buy-only history, partial sells, full sells, current-only exclusion, multiple accounts same ticker, same ticker across markets, missing prices, provisional inclusion/exclusion, period-end bucketing, and MCP/API parity.
- [x] Add `/analysis` index page and top-level Analysis navigation item.
- [x] Add `/analysis/unrealized-pnl` page with deterministic URL state and route DTO cache reuse.
- [x] Add full v1 filter surface: date/range, granularity, markets, accounts, tickers, selection mode, ticker limit, holdings state, reporting currency, provisional toggle, and instrument type when available.
- [x] Add portfolio-to-ticker decomposition summary and chart.
- [x] Add purpose-built ranking table with selection controls and analysis columns.
- [x] Add selected ticker comparison chart with configurable line count, selected-line emphasis, and muted unselected lines.
- [x] Add focus scrub interaction with synchronized point detail.
- [x] Add selected ticker detail section with cost basis, market value, quantity, P&L, transaction context, and data health.
- [x] Add restrained chart/ranking transitions, stable loading skeletons, and reduced-motion handling.
- [x] Make mobile and narrow desktop usable with collapsed filters and table below chart.
- [x] Add compact Unrealized P&L drivers module in Reports.
- [x] Add deep links from Reports summary, holdings/top movers rows, and Dashboard unrealized KPI where route mapping is clean.
- [x] Ensure Reports/Dashboard links and MCP `deepLink` use the same route-state format.
- [x] Run `/aaa` to add or update E2E tests covering Analysis navigation, filters, chart selection, focus detail, and Reports deep links.

## Open Items

- [x] Finalize exact i18n labels and copy during UI implementation.
- [x] Confirm instrument type filter quality against available instrument metadata; degrade gracefully if incomplete.
- [x] Decide whether user preference persistence ships with the first UI slice or follows after the chart/table shell is stable.

## References

- Scope route decision: `/analysis/unrealized-pnl`
- Motion artifacts:
  - `/Users/lume/.codex/generated_images/unrealized-pnl-motion-examples/option-1-restrained.gif`
  - `/Users/lume/.codex/generated_images/unrealized-pnl-motion-examples/suggested-focus-scrub.gif`
