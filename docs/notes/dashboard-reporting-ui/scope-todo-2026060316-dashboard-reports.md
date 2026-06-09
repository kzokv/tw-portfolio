---
slug: dashboard-reporting-ui
source: scope-grill
created: 2026-06-03
updated: 2026-06-09
tickets: []
required_reading:
  - docs/notes/performance-smooth-pages/scope-todo-20260601-performance-smooth-pages.md
  - docs/notes/dashboard-reporting-ui/mockups/reports-mockup.html
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/dashboard-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/dashboard-mobile.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/holding-focus-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/holding-focus-mobile.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/daily-review-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/daily-review-mobile.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-report-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-report-mobile.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/market-report-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/market-report-mobile.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-loading-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-loading-mobile.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/ticker-detail-desktop.png
  - docs/notes/dashboard-reporting-ui/mockups/screenshots/ticker-detail-mobile.png
superseded_by: null
---

# Todo: Dashboard Reporting UI

> For agents starting a fresh session: read all files listed in `required_reading` before starting implementation.

## Locked Scope

1. Create one coordinated release/PR on this branch, implemented as phased vertical commits.
2. Use the waiver path for git and PR metadata because there is no Linear ticket.
3. PR waiver block:
   ```md
   ## Waiver
   Reason: Product/reporting scope exploration approved without Linear ticket
   Approved-by: @kzokv
   Scope: both
   ```
4. Dashboard is the daily command surface; `/reports` is the structured analysis surface.
5. The release is foundation-first: correctness and performance must be addressed before report UI polish.
6. All report, dashboard, portfolio, and ticker numbers are server-authoritative. Client code formats and displays values, but must not recompute accounting semantics from raw transactions.
7. Quantity, current holdings, cost basis, average cost, realized P&L, unrealized P&L, market value, daily change, and FX/reporting values come from server projections, read models, or report DTOs.
8. Historical chart values come from server snapshots/read models. If a chart cannot be calculated correctly yet, show a limited/empty state instead of an approximate client-calculated line.
9. Regression fixtures must cover buy, sell, partial sell, fees, realized P&L, unrealized P&L, average cost, and FX conversion.
10. Client-side accounting fallbacks, including ticker fallback chart/cost-basis reconstruction from transactions, must be removed, replaced, or quarantined outside formal reporting surfaces.
11. Review SQL/query/read-path costs for dashboard, portfolio, ticker, and report endpoints. Prefer targeted read-model optimization over a full accounting rewrite.
12. Heavy pages use the performance pattern from the prior smooth-page work: server-provided route-primary DTO, client-side secondary/enrichment fetch, no blanking existing content during refresh, and visible freshness/loading state.
13. Bounded stale-while-revalidate localStorage caching is in scope for primary DTOs: dashboard primary, portfolio primary, report summaries, and ticker primary.
14. Cache keys include route/report, portfolio context owner/user id, scope, currency mode, effective/reporting currency, range where relevant, ticker/market/account where relevant, and schema version.
15. Cache TTL is short, around 2-5 minutes. Manual refresh bypasses cache.
16. Cache invalidates after trade mutation, recompute, currency preference change, shared context switch, account changes, and fee-profile/binding changes.
17. Refresh UX includes page-level refresh plus section-level refresh for independent secondary data such as performance charts, report charts, ticker chart, and quote/freshness.
18. Refreshes must not blank existing content. Existing rows/cards stay mounted with local pending states.
19. Route audit decisions are locked: `/portfolio` and `/transactions` currently passing `initialPrimaryData={null}` is a regression/mismatch and must be fixed.
20. `/dashboard` is partially aligned already, but still needs DTO cache, freshness labels, and refresh controls.
21. `/tickers/[ticker]` is in scope because ticker navigation is part of the dashboard/portfolio back-navigation pain.
22. `/tickers/[ticker]` gets a primary/enrichment split. Primary includes identity, position summary, transaction history preview, account breakdown, and basic quote/status. Enrichment includes chart series, fundamentals, dividends, quote freshness, and provider/backfill metadata.
23. `/tickers/[ticker]` primary data is cache-restored on return navigation and refreshed silently.
24. `/dividends`, `/cash-ledger`, and `/settings/accounts` are acknowledged slow/mismatched routes but are deferred, except for report API data dependencies.
25. Dashboard hero shows active global reporting currency, FX status, and a section settings currency switcher.
26. Dashboard hero currency switcher updates the global reporting currency preference.
27. Dashboard hero includes a compact per-market value strip using the active dashboard reporting currency.
28. Dashboard command modules are `Today`, `Market Pulse`, and `Portfolio Health`.
29. Dashboard should prune or compress duplicate summary/report sections and keep only priority daily-review data.
30. Reports live on a dedicated `/reports` page and are URL-addressable.
31. Report tabs are `Daily Review`, `Portfolio Report`, and `Market Report`; no standalone Currency Report in v1.
32. FX/currency conversion health is integrated across all reports because exchange rate is the major factor for multi-market portfolio reporting.
33. Shared report controls are `scope`, `currencyMode`, `currency`, and range where relevant.
34. `scope = all | TW | US | AU | KR`.
35. `currencyMode = auto | specified`.
36. `currency = TWD | USD | AUD | KRW` when specified.
37. Auto currency behavior: whole portfolio uses user reporting currency; single-market scope uses native market currency via `currencyFor(market)`.
38. Specified currency behavior: all report values convert to the selected currency.
39. Report state is encoded in URL query params with validation and predictable fallbacks.
40. Reports use shadcn-style composition: tabs, cards, badges, controls, drawer/sheet patterns, tables, and charts.
41. Mobile reports use stacked cards and tap-to-detail drawer/sheet patterns instead of forcing table scanning.
42. Desktop reports use charts and tables; wide comparison tables use sticky headers and sticky first columns when applicable.
43. Large money display uses compact units (`K`, `M`, `B`) in hero strips, dashboard compact cards, chart axes, small chart labels, and tight mobile cards.
44. Precise full currency display remains for holdings tables, transaction rows, report detail tables, drawer/sheet detail rows, exports/MCP data, and chart tooltips where exact values matter.
45. Compact money labels include currency code, for example `AUD 1.2M`.
46. `Portfolio Report` is a comprehensive fixed report, not a custom builder.
47. `Portfolio Report` sections: summary, performance trend, allocation, concentration, income, data health, holdings detail.
48. `Market Report` is a full report with scoped performance support.
49. `Market Report` sections: market summary, native/reporting currency handling, performance comparison, top holdings, concentration, data health, detail drilldown.
50. `Daily Review` suggestions are deterministic rule-based suggestions derived from report/dashboard data.
51. Add dedicated MCP report read tools under existing `portfolio:mcp_read`, mirroring the UI report DTOs.
52. MCP tool wording must stay descriptive and avoid investment, tax, suitability, target-price, buy/sell/hold, or rebalancing advice claims.
53. Report endpoints return complete summaries/aggregates plus bounded detail rows with pagination/detail controls.

## Locked Scope Addendum - 2026-06-09

This addendum was locked after follow-up investigation of dashboard cost drift, missing chart data after 2026-05-29, Holding Focus UX, scoped report failures, MCP visibility, and remaining Codex review work. It extends the existing PR scope and should be implemented as separate vertical-slice commits.

1. Finish the remaining Codex review fixes in this PR rather than deferring them.
2. All-market synthetic portfolio/report performance must load and use quote snapshots; scoped and all-scope report paths need regression coverage.
3. Dashboard/report `Book Cost` is stable reporting-currency cost derived from transaction/lot history using transaction-date FX.
4. Current cost-basis method remains weighted average. Buy cost converts on trade date; sells reduce Book Cost using weighted-average reporting cost per share.
5. `FX-Translated Cost` remains a separate analytics value translated using valuation-date FX.
6. Missing transaction-date FX makes the affected holding Book Cost incomplete. Portfolio/market aggregate Book Cost is marked `Incomplete` with affected holding/trade counts; do not display partial aggregates as normal totals.
7. Dashboard performance uses a read-time corrected formula first; no new daily snapshot fields, migrations, or backfill jobs in this PR.
8. Hybrid performance read path is locked: snapshots may supply reliable dated Market Value; stable Book Cost, realized P&L, and dividends are derived by date in reporting currency.
9. Snapshot `totalCostBasis` or equivalent FX-moving cost must not be displayed as dashboard/report Book Cost.
10. Market Value for each date is open quantity as of that date multiplied by historical close for that date and valuation-date FX into the selected reporting currency.
11. Return Amount is `Market Value + realized P&L + dividends - Book Cost`.
12. Return % is `Return Amount / Book Cost`.
13. Portfolio Trend plots Market Value plus Book Cost by default.
14. Return card plots Return % from the same corrected performance points.
15. FX movement affects Market Value and FX-Translated Cost, but not Book Cost.
16. Charts stop/truncate at the last reliable valuation date when required market data is stale or missing; no blind carry-forward to today.
17. For all-market charts, use a composite calendar: include dates where at least one held market is open; carry forward prior close/FX only for markets that are normally closed; mark incomplete/stale when a market should be open but data is missing.
18. Chart headers and cards show `As of {date}` and stale-data messaging such as `Market data stale since {date}` when the selected date/range extends beyond the last reliable valuation date.
19. Refresh buttons on expensive chart/report sections attempt quote/bar refresh or silent refetch without blanking mounted content.
20. Dashboard remains review-first: hero totals, Book Cost, P&L, return, per-market chips, FX/as-of state, Portfolio Trend, Return, Holding Focus, Top Movers/Risk Alerts, and Suggestions/AI-ready context.
21. Dashboard must not duplicate full report tables, transaction/cost ledger views, the full currency report, or custom report-builder behavior.
22. Use labels: `Market Value`, `Book Cost`, `FX-Translated Cost`, `Unrealized P&L`, `Total Return`, `Return %`, `Price P&L`, `FX P&L`, `As of {date}`, `Missing FX for Book Cost`, and `Market data stale since {date}`.
23. Tooltips define Book Cost, FX-Translated Cost, Market Value, and Return % with the locked formulas.
24. Holding Focus restores account-level visibility.
25. Holding Focus desktop keeps a holdings-first table with sticky header, sticky ticker/name column where applicable, search, market filter, account filter, sorting, preset chips, and expandable account-level rows.
26. Holding Focus mobile keeps cards as the primary layout; tapping opens a detail sheet with Summary, Accounts, Cost/P&L, and FX/Price sections.
27. Holding Focus detail content includes per-account quantity, market value, Book Cost, FX-Translated Cost, unrealized P&L, native price, reporting-currency price, FX rate when converted, portfolio allocation, market allocation, average cost, latest price, ticker link, and optional lot count. Full lot lists remain out of dashboard scope.
28. Holding Focus preset chips ship with defaults: `Largest`, `Worst P&L`, `Best P&L`, `FX exposure`, and `Stale quotes`.
29. Users can configure visibility/order of known Holding Focus preset chips in the Holding Focus card UI. No custom query/formula builder in this PR.
30. Holding Focus chip preferences persist via existing backend `user_preferences.preferences`, not localStorage and not a new table.
31. The preference key is `dashboardHoldingFocus` with `presetOrder`, `hiddenPresets`, and `selectedPreset`.
32. Chip configuration lives inside the Holding Focus card via settings icon and shadcn popover/sheet; do not add a Settings page section in this PR.
33. Native price/value disclosure uses explicit affordances only when reporting currency differs from native currency. Desktop uses popover/click disclosure; mobile uses sheet or inline expansion. Do not make the amount itself a hidden toggle.
34. Daily Review, Portfolio Report, and Market Report must work for `scope=TW` and other single-market scopes. Treat scoped failure as a correctness bug first, performance bug second.
35. Scoped reports must consistently filter holdings, trades, quotes, bars, dividends, and performance contributors by market.
36. Report responses should include diagnostics: selected scope, reporting currency, last valuation date, stale/missing quote indicators, missing FX counts, and row counts sufficient to explain incomplete charts.
37. MCP/ChatGPT report context should expose advice-ready semantic payloads rather than raw UI DTO dumps where appropriate: reporting currency, market scope, FX rates, as-of/stale metadata, totals, Book Cost, FX-Translated Cost, P&L/return, market breakdown, top holdings/movers, risk/concentration alerts, suggestions context, and data-quality warnings.
38. AI Connectors settings must show available MCP tools grouped by purpose, including tool name, description, required scope, availability, and why unavailable.
39. Read-only report/advice tools are visible and enabled when connector read policy allows them; write/admin tools remain visibly locked unless policy allows them.
40. Cache-first performance behavior remains in scope: Dashboard, Portfolio, Reports, and Ticker routes render cached/primary DTOs first when available, refresh silently, expose explicit refresh controls, and avoid full blocking reloads on back navigation.
41. Ticker links remain normal internal navigation unless an explicit external/new-tab case is introduced later.
42. Review SQL/query/read paths only where current evidence shows the calculation or fetch path is heavy; do not start a broad accounting rewrite.
43. This PR uses behavior-based vertical-slice commits: Codex review/report quote fix, Book Cost/FX cost model, stale-data/as-of charts, Holding Focus UX, cache-first performance polish, MCP/tool catalog visibility, and tests/todo/mockup updates.
44. Scope boundary: no custom Holding Focus preset builder, no full lot-level dashboard ledger, no TWR/MWR metrics, no new daily snapshot fields/backfill, no separate Currency Report, and no new schema migrations except preference validation/API shape if needed.

## Implementation Steps

- [x] Commit 1: add shared correctness/performance foundation.
- [x] Commit 1: add or update accounting/report regression fixtures for buy, sell, partial sell, fees, realized/unrealized P&L, average cost, and FX conversion. Existing portfolio, cash-ledger, snapshot, and FX wallet suites cover the accounting matrix; this branch adds report scope/currency and ticker-split coverage.
- [x] Commit 1: add shared report scope/currency parsing and resolver utilities.
- [x] Commit 1: add shared typed report DTOs for Daily Review, Portfolio Report, Market Report, and report data-health/fx status.
- [x] Commit 1: add compact currency formatting helper with exact-tooltip/full-detail usage rules.
- [x] Commit 1: add bounded DTO cache utility with schema version, TTL, cache-key parts, manual-refresh bypass, and invalidation hooks.
- [x] Commit 1: add route regression tests/guards proving heavy pages with primary endpoints do not pass null primary data.
- [x] Commit 1: review and document current SQL/read-path hotspots for dashboard, portfolio, ticker, and report endpoints.
- [x] Commit 2: align dashboard, portfolio, and transactions loading behavior.
- [x] Commit 2: keep dashboard server-seeded primary data and add local DTO cache/freshness state/page refresh/section refresh controls.
- [x] Commit 2: server-fetch `fetchPortfolioPrimaryData()` in `/portfolio/page.tsx` and pass it to `PortfolioClient`.
- [x] Commit 2: seed AppShell portfolio config from portfolio primary data.
- [x] Commit 2: restore `/transactions` server seeding via `fetchTransactionsPrimaryData()` and pass the payload to `TransactionsClient`.
- [x] Commit 2: use transaction primary portfolio config to avoid duplicate shell config bootstrap where possible.
- [x] Commit 2: add portfolio primary DTO cache restore and silent refresh without blanking holdings/cards.
- [x] Commit 2: add dashboard/portfolio/transactions tests for server seeding, cached restore, manual refresh, and mutation/context invalidation.
- [x] Commit 3: add report API and scope/currency engine.
- [x] Commit 3: add `GET /reports/daily-review` with bounded detail and deterministic suggestions.
- [x] Commit 3: add `GET /reports/portfolio` with comprehensive portfolio sections.
- [x] Commit 3: add `GET /reports/market` with market summaries and scoped market performance.
- [x] Commit 3: implement scoped performance support for all-market and single-market report scopes.
- [x] Commit 3: ensure report values are server-authoritative and include `fxStatus`/data-health metadata.
- [x] Commit 3: add API validation and report service tests for scope/currency resolution, FX conversion, and bounded detail.
- [x] Commit 4: add `/reports` UI.
- [x] Commit 4: add `/reports` page with URL-backed tab/scope/currency/range state.
- [x] Commit 4: build report controls using shadcn-style tabs, controls, badges, cards, charts, and tables.
- [x] Commit 4: implement mobile card layouts and tap-to-detail drawer/sheet behavior.
- [x] Commit 4: implement desktop report tables with sticky header and conditional sticky first column.
- [x] Commit 4: add report page cache restore, silent refresh, page-level refresh, and section-level refresh.
- [x] Commit 4: add web tests for URL fallback, tab switching, report controls, responsive detail behavior, cache restore, and refresh states.
- [x] Commit 5: polish dashboard as command surface.
- [x] Commit 5: add dashboard hero reporting currency indicator, FX status, and section settings currency switcher.
- [x] Commit 5: add dashboard hero market strip with links into `/reports?tab=market&scope=...`.
- [x] Commit 5: add `Today`, `Market Pulse`, and `Portfolio Health` command cards.
- [x] Commit 5: prune or compress duplicate dashboard summary/report sections.
- [x] Commit 5: apply compact currency formatting to hero strip, compact cards, chart axes, and tight mobile cards.
- [x] Commit 5: add dashboard tests for currency switch refresh, report deep links, market strip currency, and duplicate-content pruning.
- [x] Commit 6: optimize ticker detail navigation.
- [x] Commit 6: split `/tickers/[ticker]` into primary and enrichment DTOs/endpoints or equivalent route-owned primary/enrichment fetches.
- [x] Commit 6: make ticker primary include identity, position summary, transaction history preview, account breakdown, and basic quote/status.
- [x] Commit 6: make ticker enrichment include chart series, fundamentals, dividends, quote freshness, and provider/backfill metadata.
- [ ] Commit 6: add ticker primary DTO cache restore and silent refresh for return navigation. Deferred: the API split exists, but the web ticker route still server-seeds the existing details model and fetches enrichment into that model.
- [x] Commit 6: remove or quarantine client-side ticker accounting/chart fallback reconstruction from formal reporting paths. Formal reports use server report DTOs; legacy ticker fallback remains outside `/reports` and is documented as follow-up work.
- [ ] Commit 6: add ticker tests for primary/enrichment split, cached restore, and server-authoritative chart/position values. Partial: split endpoint tests exist; cache-restore route tests remain pending with the deferred web ticker adoption.
- [x] Commit 7: add MCP report tools.
- [x] Commit 7: add MCP tools `get_daily_review_report`, `get_portfolio_report`, and `get_market_report`.
- [x] Commit 7: map MCP tools to the same typed report DTOs and bounded detail controls.
- [x] Commit 7: update MCP tool schemas, discovery, policy mapping, and integration tests.
- [x] Commit 7: enforce descriptive-only wording with no investment, tax, suitability, target-price, buy/sell/hold, or rebalancing advice claims.
- [x] Commit 8: add documentation and final targeted test evidence.
- [x] Commit 8: update this todo with implemented checkboxes and note any deferred route tuning.
- [x] Commit 8: run API unit/integration coverage for report endpoints, query validation, scope/currency resolution, FX conversion, scoped performance, and ticker split.
- [x] Commit 8: run web unit/component coverage for report controls, URL query fallback, mobile drawer behavior, dashboard hero currency switcher, cache restore, refresh controls, and route seeding.
- [ ] Commit 8: run E2E smoke for dashboard currency switching, dashboard market chip report links, report URL restoration, portfolio cached return, transactions primary restoration, and ticker return navigation. Full PR gate is green, but dedicated `/reports` URL restoration and ticker return-cache E2E coverage is still pending with the deferred ticker web adoption.
- [x] Commit 8: run MCP integration tests for all three report tools and schema exposure.

## Implementation Steps - Addendum 2026-06-09

- [x] Commit A: finish remaining Codex review fixes for all-scope synthetic report performance by loading quote snapshots for all-market Portfolio Report and Market Report paths.
- [x] Commit A: add focused API regression tests for all-scope synthetic quote usage in both portfolio and market report performance, plus scoped `scope=TW` equivalents.
- [x] Commit A: keep explicit `null` reporting amounts as incomplete data in web grouping/holding DTO consumers; do not fall back to native values unless the field is absent and native currency equals reporting currency.
- [x] Commit A: add focused web regression tests for explicit-null reporting amount preservation and dashboard holding/report native-vs-reporting amount display.
- [ ] Commit B: add a server-side read-time performance calculation service that derives stable Book Cost from weighted-average transaction/lot history using transaction-date FX.
- [ ] Commit B: derive FX-Translated Cost separately using valuation-date FX.
- [ ] Commit B: compute daily Market Value from open quantity, historical close, and valuation-date FX.
- [ ] Commit B: compute Return Amount and Return % from Market Value, realized P&L, dividends, and stable Book Cost.
- [ ] Commit B: mark holding and aggregate Book Cost incomplete when transaction-date FX is missing; surface affected holding/trade counts.
- [ ] Commit B: add API unit/integration tests for buy, sell, partial sell, fees, weighted-average sell reduction, transaction-date FX, missing FX, realized P&L, dividends, Market Value, Return Amount, and Return %.
- [ ] Commit C: implement hybrid dashboard/report performance read path that may use reliable snapshot Market Value but never uses FX-moving snapshot cost as Book Cost.
- [ ] Commit C: implement stale-data valuation boundaries and composite-calendar behavior for multi-market charts.
- [ ] Commit C: truncate dashboard/report charts at the last reliable valuation date when data is stale/missing, with `As of {date}` and stale-data metadata. Partial: dashboard/report performance DTOs now include `requestedAsOf`, `lastReliableDate`, and `marketDataStaleSince`; dashboard Portfolio Trend, Return %, and report performance charts show `As of {date}` plus `Market data stale since {date}`; report charts no longer connect null-valued gaps. Composite-calendar truncation remains pending.
- [ ] Commit C: update dashboard Portfolio Trend to plot Market Value + Book Cost by default and expose FX-Translated Cost only in details/settings/report surfaces. Partial: dashboard and report performance chart labels now use `Book Cost` instead of `Total Cost`/`Cost basis`; explicit FX-Translated Cost detail surfacing remains pending.
- [ ] Commit C: update Return card to plot Return % from corrected daily performance points.
- [ ] Commit C: add tests for May 29 stale-data cutoff, no post-cutoff fake points, normal market-closure carry-forward, and open-market missing-data truncation.
- [x] Commit D: redesign Holding Focus desktop with shadcn-friendly toolbar, preset chips, search, market/account filters, sort controls, sticky table header, sticky ticker/name column, expandable account-level rows, and ticker links.
- [x] Commit D: redesign Holding Focus mobile cards with detail sheet sections for Summary, Accounts, Cost/P&L, and FX/Price.
- [ ] Commit D: add Holding Focus account-level detail metrics: quantity, market value, Book Cost, FX-Translated Cost, unrealized P&L, native/reporting price, FX rate, portfolio/market allocation, average cost, latest price, ticker link, and optional lot count. Partial: desktop account rows and mobile/detail-sheet sections shipped; current focused coverage verifies Book Cost, portfolio allocation, average cost, latest price, and ticker navigation, while `FX-Translated Cost` and market-allocation detail remain deferred.
- [ ] Commit D: implement native price/value progressive disclosure for dashboard/report holding cards and rows when reporting currency differs from native currency.
- [ ] Commit D: add responsive unit/component tests and E2E coverage for desktop expansion, mobile detail sheet, account-level detail, ticker links, native disclosure, sorting, filtering, and sticky table behavior. Partial: dashboard component coverage now verifies presets/account filter, desktop account-row expansion, ticker links, and detail sheet sections; E2E and sticky-behavior browser checks remain pending.
- [x] Commit E: add backend validation and persistence for `dashboardHoldingFocus` user preference with `presetOrder`, `hiddenPresets`, and `selectedPreset`.
- [x] Commit E: implement Holding Focus preset management inside the card using settings icon plus shadcn popover/sheet; persist preference through `/user-preferences`.
- [x] Commit E: add API memory/Postgres tests and web tests for preference validation, merge semantics, selected preset persistence, show/hide, reorder, and reset/default behavior. API HTTP validation/round-trip coverage passes; memory parity and managed Postgres integration assertions cover full-object replace plus `null` clear; dashboard component coverage verifies hydration/PATCH, selected preset persistence, show/hide fallback, reorder, and reset/default behavior. `dashboardHoldingFocus` persists as a full object (`presetOrder`, `hiddenPresets`, `selectedPreset`) under the existing `user_preferences.preferences` JSON key with no migration, and `PATCH /user-preferences` keeps existing top-level merge semantics (`dashboardHoldingFocus: null` clears the key).
- [ ] Commit F: fix scoped report correctness for Daily Review, Portfolio Report, and Market Report with `scope=TW` and other single-market scopes.
- [ ] Commit F: ensure scoped reports filter holdings, trades, quotes, daily bars, dividends, and performance contributors consistently by market.
- [ ] Commit F: add report diagnostics for scope, reporting currency, last valuation date, stale/missing quotes, missing FX, and row counts.
- [ ] Commit F: add tests for `scope=all`, `scope=TW`, and at least one non-TW scope where fixtures allow it.
- [ ] Commit G: expose advice-ready MCP report context payloads and ensure MCP tool schemas accept/reflect reporting currency, scope, stale-data, Book Cost, FX-Translated Cost, P&L/return, market breakdown, top holdings/movers, risks, suggestions context, and data-quality warnings.
- [ ] Commit G: update AI Connectors settings to show grouped MCP tool catalog with availability, required scope, policy state, and unavailable reasons.
- [ ] Commit G: add API and web tests for tool catalog visibility, policy-disabled state, missing-scope/fresh-auth reasons, and read-report tool visibility.
- [ ] Commit H: complete cache-first navigation/performance polish for Dashboard, Portfolio, Reports, and Ticker pages using user/context-aware cache keys and no blanking during refresh.
- [ ] Commit H: review SQL/query/read-path timing for corrected dashboard/report performance and targeted heavy paths; add narrow query optimizations where evidence supports them.
- [ ] Commit H: add cache key/scope/range/report tests for `/reports`, dashboard, portfolio, and ticker back-navigation behavior.
- [ ] Commit I: update UI labels, tooltips, data-health copy, and i18n for Book Cost, FX-Translated Cost, Return %, stale data, and missing FX.
- [x] Commit I: refresh durable mockup screenshots only where the locked Holding Focus, stale-data, or Book Cost UI materially diverges from existing mockups. Holding Focus desktop/mobile screenshots were regenerated under `docs/notes/dashboard-reporting-ui/mockups/screenshots/`.
- [x] Commit I: update this todo by ticking delivered addendum items and leaving any explicitly deferred items unchecked with notes.
- [ ] Commit I: Run `/aaa` or the repo AAA workflow to add/update E2E tests covering the new user-facing flows, settings/persistence changes, report scope flows, and API endpoint behavior.
- [x] Commit I: run focused tests first, then the full eight-suite gate before pushing. Repeatedly completed during the 2026-06-09 follow-up passes; see Verification Log.
- [ ] Commit I: post `@codex review`, wait for feedback, fix all actionable review comments, rerun relevant gates, and push follow-up commits. Earlier base-PR `@codex review` completed at `8fe520f5`; a fresh rerun is not recorded after the later 2026-06-09 follow-up fixes.
- [ ] Commit I: wait for CI green, deploy the dev branch, then validate dashboard/report/Holding Focus performance, chart presentation, number correctness, and responsive UX through the Codex Chrome workflow. Earlier base-PR dev deploy/Chrome validation completed at `8fe520f5`; a fresh rerun is not recorded after the later 2026-06-09 follow-up fixes.

## Follow-up Issue Fixes — 2026-06-08

- [x] Dashboard holdings preview now shows reporting-currency prices/values as the primary read, uses compact K/M value labels where space is tight, surfaces FX rates for the visible holdings, and exposes native ticker price plus FX rate through tooltip/popover/sheet detail.
- [x] Dashboard holdings preview now uses a mobile card layout plus a richer desktop table with search, market filter, value/daily/P&L/ticker sorting, sticky header, sticky first column, ticker links, and detail actions.
- [x] Dashboard hero shows the active reporting currency and resolved FX conversion rows when mixed-market holdings require conversion.
- [x] Reports show resolved FX conversion rows from the report DTO, not only aggregate FX status.
- [x] Report cards and detail rows link tickers to `/tickers/{ticker}?marketCode={market}` so Top holdings, Market detail, and holding detail cards can open ticker pages.
- [x] Report holding rows now include explicit native currency price/value fields, reporting price fields, and row-level FX rate so report cards/tables can disclose original price when reporting currency differs.
- [x] Report gains/losses, daily changes, and P&L-style values use finance tone classes plus signed money/percent labels for positive/negative/neutral values.
- [x] Slow scoped report SSR no longer blocks first paint indefinitely. `/reports` now gives server seeding a bounded paint budget, aborts the underlying report fetch when the budget expires, and renders the client shell with cache/silent refresh when the active scoped report is slow.
- [x] AI Connector settings now renders the MCP report tool catalog from server policy/catalog metadata even when connection-level tool toggles are empty, and each connector shows inherited/default/override tool availability instead of hiding the catalog behind saved overrides.
- [x] TW/single-market scoped reports no longer fail after initial paint during client refresh due to scoped performance fanout. Scoped performance now aggregates all scoped `(accountId, ticker)` snapshot contributors in one persistence query via `getAggregatedSnapshotsInReportingCurrencyForScope()` instead of fanning out `getHoldingSnapshotsForTicker()` per holding.

## Follow-up Issue Fixes — 2026-06-09

- [x] Route DTO caches now partition by signed-in session user plus selected portfolio context owner, and the cache schema version was bumped to prevent stale cross-user/context reuse.
- [x] Route DTO caches are cleared on sign-out, API-driven 401 logout, and signed-in user changes inside the app shell.
- [x] Reports now use the effective dashboard/report range list from user/admin preferences instead of hard-coding `5Y`; unsupported URL ranges snap to the first effective range.
- [x] Report URL-backed state now stays synchronized with browser/client-side `/reports?...` URL changes and server-seeded data after context/range changes. Report client cache restore accepts refreshed matching server-seeded report DTOs instead of consuming `initialReport` only once.
- [x] MCP report inputs now treat `reportingCurrency` as a first-class alias for `currency` and infer `currencyMode=specified` when the alias is provided without an explicit mode.
- [x] Single-market scoped reports preserve upcoming dividend events even when there is no dividend ledger row yet, and report summaries expose upcoming dividend count/amount for the UI summary grid.
- [x] Focused regression coverage added for scoped no-snapshot performance fallback, scoped upcoming dividends, MCP `reportingCurrency`, report range snapping, report URL-state sync, route DTO session/context partitioning, refreshed report server seeds, and dashboard holdings FX visibility.
- [x] Dashboard holding-group DTOs now expose explicit server-translated `reportingCurrentUnitPrice` values for groups and children, and the Holdings preview prefers that field when it matches the active reporting currency.
- [x] Dashboard primary cache restore now validates cached DTO `summary.reportingCurrency` against the current expected reporting currency from `/dashboard/primary` or `/user-preferences`, so older cached dashboard payloads cannot relabel AUD/TWD/USD values after reporting-currency changes or return navigation.
- [x] Dashboard/report performance DTOs now carry stale-data metadata (`requestedAsOf`, `lastReliableDate`, `marketDataStaleSince`) based on the last reliable point, not the last emitted null-valued point.
- [x] Dashboard Portfolio Trend, dashboard Return %, and report performance charts now surface `As of {date}` and `Market data stale since {date}` when the selected as-of date extends beyond reliable market data.
- [x] Report performance charts no longer connect null-valued series gaps, so missing/stale data is not drawn as a continuous trend.
- [x] Dashboard/report performance chart copy now labels stable cost as `Book Cost`, matching the locked formula and avoiding the misleading FX-moving `Total Cost` label.

## Open Items

- [x] Final PR gate can run the full eight-suite matrix when preparing the PR, but phased implementation uses targeted coverage first. Completed locally before PR creation.
- [x] Native market currency mapping must remain centralized through `currencyFor(market)` and covered by tests.
- [x] Currency Report remains out of v1; add only if a future scope requires dedicated FX/currency exposure analysis.
- [x] Export/PDF/CSV and custom report builder remain out of v1.
- [x] `/dividends`, `/cash-ledger`, and `/settings/accounts` page-performance tuning remains out of this PR except for report data dependencies.
- [ ] `/settings/fee-config` still uses `loadUserStore`; optimize in a follow-up unless this release needs it to meet transaction/portfolio first-paint goals.
- [ ] `/dashboard/primary`, `/portfolio/primary`, and `/transactions/primary` may still need narrow Postgres projections after this scope stabilizes. Do targeted read-model optimization where feasible, but do not rewrite accounting projections wholesale in this PR.
- [x] Scoped report performance now has a narrow Postgres projection for report charts. Single-market scopes aggregate the requested `(accountId, ticker)` snapshot contributors in one FX-aware query and preserve memory/Postgres parity for missing FX and provisional rows.
- [ ] Broader report assembly still starts from `loadStore(userId)`. A narrower report-specific read model may still be needed after this report contract stabilizes, but the previous per-holding scoped performance fanout is no longer the active bottleneck.
- [x] Existing mockups remain durable. Regenerate screenshots only if implementation materially diverges from the locked UI structure.
- [x] Dashboard holdings preview now uses explicit server-provided `reportingCurrentUnitPrice` from the dashboard holding-group DTO when available, with `reportingMarketValueAmount / quantity` retained only as a backward-compatible fallback for older cached DTOs.
- [x] Dashboard holdings preview UX/test-selector refinements are validated. Focused web component coverage and affected dashboard/mobile E2E assertions passed from the main session after the preview-root selector, daily-change/no-market-data copy, native-price disclosure, and E2E page-object updates.

## Verification Log

- [x] Focused API coverage: `npx vitest run apps/api/test/unit/reportContext.test.ts apps/api/test/unit/mcpReportTools.test.ts apps/api/test/integration/reports.integration.test.ts`
- [x] Focused web coverage: `npx vitest run test/features/dashboard/components.test.tsx test/features/reports/reportState.test.ts test/features/reports/reportService.test.ts test/app/reports/reportsPage.test.tsx test/components/reports/ReportsClient.test.tsx test/lib/utils.test.ts test/lib/routeDtoCache.test.ts test/app/portfolio/portfolioPage.test.tsx test/app/transactions/transactionsPage.test.tsx test/app/tickers/tickerHistoryPage.test.tsx test/app/tickers/TickerHistoryClient.test.tsx test/features/dashboard/hooks/useDashboardPrimaryData.test.tsx test/features/portfolio/hooks/usePortfolioPrimaryData.test.tsx test/features/portfolio/hooks/useTransactionsPrimaryData.test.tsx test/features/portfolio/services/portfolioService.test.ts`
- [x] Targeted typechecks: `npx tsc -p apps/web/tsconfig.json --noEmit --pretty false`; `npx tsc --noEmit -p apps/api/tsconfig.json`; `npx tsc --noEmit -p apps/api/test/unit/tsconfig.json`; `npx tsc --noEmit -p apps/api/test/integration/tsconfig.json`
- [x] Pre-PR code review completed: `docs/004-notes/dashboard-reporting-ui/review-20260608-dashboard-reporting-ui.md`
- [x] Full eight-suite PR gate:
  - `npx eslint .`
  - `npm run typecheck`
  - `npm run test --prefix apps/web`
  - `npm run test --prefix apps/api`
  - `npm run test:integration:full:host`
  - `npm run test:e2e:bypass:mem --prefix apps/web`
  - `npm run test:e2e:oauth:mem --prefix apps/web`
  - `npm run test:http --prefix apps/api`
- [x] CI green on PR. GitHub Actions passed after the Codex review fix commit `8fe520f5`.
- [x] Base PR `@codex review` completed and feedback fixed at `8fe520f5`. Fixed the P2 invalid report range finding in `fix(reports): validate report ranges`; focused report integration coverage and targeted API typechecks passed before push.
- [x] Base PR dev deployment completed. `deploy-dev.yml` workflow run `27121484090` deployed `codex/dashboard-reporting-ui` at `8fe520f5`.
- [x] Base PR Chrome extension validation completed against the deployed dev branch at `8fe520f5`:
  - Dashboard hero showed active reporting currency, market strip, priority command cards, refresh strip, and report deep links.
  - Dashboard aggregate-row arithmetic passed in USD: market sums total `$985,381.62`; each visible aggregate P&L row had zero delta against `market value - total cost`.
  - Portfolio Report deep link restored URL state and rendered 3 chart SVGs, refresh controls, sticky table headers, and a sticky first column in the comparable desktop table.
  - Daily Review rendered summary, data health, Today deterministic observations, top movers, holdings detail, and FX-complete status.
  - Dashboard KR market chip navigated to `/reports?tab=market&scope=KR&currencyMode=specified&currency=USD&range=1Y`; the report rendered KR scope, USD currency, FX complete, and matching market value.
- [x] Follow-up Chrome validation surfaced a transient dashboard market-strip fallback that could label native primary/cached holding amounts as the selected reporting currency before enrichment refreshed. Fixed by rendering per-market hero values only from `reportingMarketValueAmount`; added regression coverage in `apps/web/test/features/dashboard/components.test.tsx`.
- [x] Follow-up local checks after the dashboard market-strip fix: `npm run test --prefix apps/web -- components.test.tsx`, `npx eslint .`, `npm run typecheck`.
- [x] Follow-up issue validation and fixes:
  - `npx vitest run test/integration/reports.integration.test.ts test/integration/dashboard.integration.test.ts test/unit/smooth-page-read-paths.test.ts` from `apps/api`
  - `npx vitest run test/features/dashboard/components.test.tsx test/components/reports/ReportsClient.test.tsx test/components/settings/AiConnectorsSettingsClient.test.tsx test/app/reports/reportsPage.test.tsx` from `apps/web`
  - `npm run typecheck`
  - `npx eslint .`
- [x] Follow-up issue validation after holdings/report-performance polish:
  - `npx vitest run test/integration/reports.integration.test.ts` from `apps/api`
  - `npx vitest run test/features/dashboard/components.test.tsx test/components/reports/ReportsClient.test.tsx` from `apps/web`
  - `npx eslint apps/api/src/services/reports.ts apps/api/test/integration/reports.integration.test.ts apps/web/components/dashboard/DashboardHoldingsPreview.tsx apps/web/components/reports/ReportsClient.tsx apps/web/test/components/reports/ReportsClient.test.tsx libs/test-e2e/src/assistants/dashboard/DashboardAssert.ts libs/test-e2e/src/pages/dashboard/DashboardPage.ts`
  - `npm run typecheck`
  - `npx playwright test --config=tests/e2e/playwright.config.ts tests/e2e/specs/dashboard-daily-change-aaa.spec.ts` from `apps/web`
  - `npx playwright test --config=tests/e2e/playwright.config.ts tests/e2e/specs/mobile-tables-aaa.spec.ts` from `apps/web`
- [x] Follow-up issue validation after native-price/report-connector polish:
  - `npx vitest run test/integration/reports.integration.test.ts` from `apps/api`
  - `npx vitest run test/components/reports/ReportsClient.test.tsx test/components/settings/AiConnectorsSettingsClient.test.tsx test/features/dashboard/components.test.tsx` from `apps/web`
  - `npx eslint apps/api/src/services/reports.ts apps/api/test/integration/reports.integration.test.ts libs/shared-types/src/index.ts apps/web/components/reports/ReportsClient.tsx apps/web/components/dashboard/DashboardHoldingsPreview.tsx apps/web/components/settings/AiConnectorsSettingsClient.tsx apps/web/test/components/reports/ReportsClient.test.tsx apps/web/test/components/settings/AiConnectorsSettingsClient.test.tsx apps/web/test/features/dashboard/components.test.tsx`
  - `npm run typecheck`
- [x] Follow-up code review/SI/doc pass:
  - `code-reviewer/scripts/pr_analyzer.py --base dev --json`; manually cleared test-only secret and client-link false positives.
  - Updated `docs/004-notes/dashboard-reporting-ui/review-20260608-dashboard-reporting-ui.md` with fixed follow-up review findings.
  - `/si-review` found the existing `reporting-server-authoritative-dtos.md` promotion covers the currency-labeling failure class; no new rule was warranted beyond the already-promoted 2026-06-08 addendum.
- [x] 2026-06-08 local full-gate rerun after native-price/report-connector polish:
  - `npx eslint .` passed.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: 514 tests.
  - `npm run test --prefix apps/api` passed: 1,476 tests, 410 skipped.
  - `npm run test:integration:full:host` passed: 799 tests, 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: 258 tests, 9 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: 119 tests.
  - `npm run test:http --prefix apps/api` passed: 284 tests, 2 skipped.
  - Process audits after the managed integration/e2e gates found no orphan app/test runners; only the expected local gateway and system Postgres listeners remained.
- [x] 2026-06-08 local full-gate rerun after scoped-report server-seed abort fix:
  - `npx eslint .` passed.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: 515 tests.
  - `npm run test --prefix apps/api` passed: 1,476 tests, 410 skipped.
  - `npm run test:integration:full:host` passed: 799 tests, 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: 257 tests, 9 skipped, 1 flaky retry that passed on retry.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: 119 tests.
  - `npm run test:http --prefix apps/api` passed: 284 tests, 2 skipped.
  - Process audits before the API HTTP gate found no orphan app/test runners.
- [x] 2026-06-08 local full-gate rerun after scoped-report single-query aggregate fix and duplicate-pair hardening:
  - `npx eslint .` passed.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: 515 tests.
  - `npm run test --prefix apps/api` passed: 1,476 tests, 412 skipped.
  - `npm run test:integration:full:host` passed: 801 tests, 1 skipped; includes Postgres scoped aggregate tests `INT-7` and `INT-8`, including duplicate scoped pair inputs that must not double-count report performance values.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: 258 tests, 9 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: 119 tests.
  - `npm run test:http --prefix apps/api` passed: 284 tests, 2 skipped.
  - Process audits before the long-running gates and after the final HTTP gate found no orphan app/test runners.
- [x] Follow-up validation after the scoped aggregate-query fix:
  - `npx vitest run test/integration/reports.integration.test.ts` from `apps/api`
  - Verified scoped portfolio/market reports call `getAggregatedSnapshotsInReportingCurrencyForScope()` and do not call `getHoldingSnapshotsForTicker()` per scoped pair.
  - Verified the Postgres scoped-pair CTE deduplicates account/ticker inputs before joining snapshot rows.
- [x] 2026-06-09 focused regression checks after route-cache/report/MCP fixes:
  - `npx vitest run test/lib/routeDtoCache.test.ts test/components/reports/ReportsClient.test.tsx test/features/reports/hooks/useReportData.test.tsx` from `apps/web` passed: 9 tests.
  - `npx vitest run test/unit/mcpReportTools.test.ts test/integration/reports.integration.test.ts --no-file-parallelism` from `apps/api` passed: 10 tests.
- [x] 2026-06-09 focused regression checks after scoped no-snapshot fallback, report URL sync, and dashboard holdings FX strip:
  - `npx vitest run test/unit/dashboardHoldingGroups.test.ts test/integration/reports.integration.test.ts --no-file-parallelism` from `apps/api` passed: 11 tests.
  - `npx vitest run test/features/dashboard/components.test.tsx test/components/reports/ReportsClient.test.tsx` from `apps/web` passed: 24 tests.
  - `npx eslint apps/api/src/services/dashboardReportingCurrency.ts apps/api/src/services/reports.ts apps/api/test/unit/dashboardHoldingGroups.test.ts apps/api/test/integration/reports.integration.test.ts apps/web/components/dashboard/DashboardHoldingsPreview.tsx apps/web/components/reports/ReportsClient.tsx apps/web/test/components/reports/ReportsClient.test.tsx apps/web/test/features/dashboard/components.test.tsx libs/shared-types/src/index.ts` passed.
  - `npm run typecheck` passed.
- [x] 2026-06-09 full local eight-suite gate after scoped no-snapshot fallback, report URL sync, and dashboard holdings FX strip:
  - `npx eslint .` passed.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: 193 + 331 tests across the split web package run.
  - `npm run test --prefix apps/api` passed: 1,478 tests, 412 skipped.
  - `npm run test:integration:full:host` passed: 802 tests, 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: 258 tests, 9 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: 119 tests.
  - `npm run test:http --prefix apps/api` passed: 284 tests, 2 skipped.
  - Process audit after the final HTTP gate found no orphan app/test runners; only the expected Homebrew Postgres service remained.
- [x] 2026-06-09 code-review/SI/doc pass:
  - `code-reviewer/scripts/pr_analyzer.py --base dev --json` rerun; manually cleared the known test-only secret, client-link, mockup-console, and todo-file false positives.
  - Updated `docs/004-notes/dashboard-reporting-ui/review-20260608-dashboard-reporting-ui.md` with the 2026-06-09 follow-up review findings.
  - `/si-review` identified a new durable cache-key rule; `/si-promote` added `.claude/rules/route-dto-cache-user-context.md`, later extended it with a mutable-dimension metadata validation guard, and updated `.claude/memory/MEMORY.md`.
- [x] 2026-06-09 full local eight-suite gate after route-cache/report/MCP fixes:
  - `npx eslint .` passed.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: 192 + 326 tests across the split web package run.
  - `npm run test --prefix apps/api` passed: 1,478 tests, 412 skipped.
  - `npm run test:integration:full:host` passed: 802 tests, 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: 258 tests, 9 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: 119 tests.
  - `npm run test:http --prefix apps/api` passed: 284 tests, 2 skipped.
  - Process audits before the long-running gates found no orphan app/test runners; after each E2E/API gate the app/test runners exited cleanly.
- [x] 2026-06-09 focused cache/MCP validation after dashboard reporting-currency cache hardening:
  - `npx vitest run test/features/dashboard/hooks/useDashboardPrimaryData.test.tsx test/components/settings/AiConnectorsSettingsClient.test.tsx` from `apps/web` passed: 12 tests.
  - `npx vitest run test/features/dashboard/components.test.tsx test/components/reports/ReportsClient.test.tsx test/features/dashboard/hooks/useDashboardPrimaryData.test.tsx test/components/settings/AiConnectorsSettingsClient.test.tsx` from `apps/web` passed: 37 tests.
- [x] 2026-06-09 final local eight-suite gate after dashboard reporting-currency cache hardening and semantic finance-token E2E assertion update:
  - Focused E2E rerun: `npm run test:e2e:bypass:mem --prefix apps/web -- tests/e2e/specs/dashboard-daily-change-aaa.spec.ts` passed: 5 tests.
  - `npx eslint .` passed.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: 193 + 333 tests across the split web package run.
  - `npm run test --prefix apps/api` passed: 1,479 tests, 412 skipped.
  - `npm run test:integration:full:host` passed: 803 tests, 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: 258 tests, 9 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: 119 tests.
  - `npm run test:http --prefix apps/api` passed: 284 tests, 2 skipped.
  - Process audits before and after the E2E/API HTTP gates found no orphan app/test runners; only the expected Homebrew Postgres service remained.
- [ ] Fresh post-2026-06-09 branch-tip CI green, dev deploy, and Chrome validation are not yet recorded in this doc. The last documented remote validation is the base-PR pass at `8fe520f5`; later follow-up fixes are locally gated only.
- [x] 2026-06-09 Chrome validation found the deployed `/reports?tab=market&scope=TW&currencyMode=specified&currency=TWD&range=1Y` shell could remain in a disabled refresh/loading state without report content after the server paint budget expired.
- [x] 2026-06-09 local follow-up fixed the report client refresh path by adding a 15s abort timeout and retryable `Report unavailable` state instead of leaving reports bootstrapped indefinitely.
- [x] 2026-06-09 focused validation for the report refresh-timeout fix:
  - `npx vitest run test/features/reports/hooks/useReportData.test.tsx test/components/reports/ReportsClient.test.tsx` from `apps/web` passed: 9 tests.
  - `npx eslint apps/web/features/reports/hooks/useReportData.ts apps/web/test/features/reports/hooks/useReportData.test.tsx apps/web/test/components/reports/ReportsClient.test.tsx docs/notes/dashboard-reporting-ui/implementation-notes-20260608.md docs/notes/dashboard-reporting-ui/scope-todo-2026060316-dashboard-reports.md` passed with expected ignored-file warnings for the Markdown docs.
  - `npx tsc --noEmit -p apps/web/tsconfig.json --pretty false` passed.
- [x] 2026-06-09 focused Commit A validation after all-scope synthetic quote and explicit-null reporting fixes:
  - Process audit before tests found no orphan app/test runners; only Playwright MCP helper processes were present.
  - `npx vitest run test/integration/reports.integration.test.ts --no-file-parallelism` from `apps/api` passed: 10 tests.
  - `npx vitest run test/features/portfolio/holdingGroups.test.ts test/features/dashboard/components.test.tsx` from `apps/web` passed: 24 tests.
  - `npx eslint apps/api/src/services/reports.ts apps/api/test/integration/reports.integration.test.ts apps/web/features/portfolio/holdingGroups.ts apps/web/test/features/dashboard/components.test.tsx apps/web/test/features/portfolio/holdingGroups.test.ts docs/notes/dashboard-reporting-ui/mockups/capture-report-screenshots.mjs` passed.
  - `git diff --check` passed.
  - Holding Focus mockups regenerated with `REPORTS=holding-focus node docs/notes/dashboard-reporting-ui/mockups/capture-report-screenshots.mjs` and visually checked for desktop/mobile layout.
- [x] 2026-06-09 focused Commit B/C foundation validation after dashboard/report performance overlay:
  - Added read-time dated finance overlay for performance points so snapshot-backed charts may use snapshot Market Value while Book Cost, realized P&L, dividends, Total Return, and Return % come from transaction-date FX when the loaded store is available.
  - Added focused unit regressions for stable transaction-date Book Cost overriding FX-moving snapshot cost, weighted-average partial-sell Book Cost/realized return with changing FX, same-ticker cross-market synthetic bar selection, and canonical lot-allocation/realized-P&L replay when allocated cost differs from running average cost.
  - Fixed Codex review findings on dated finance replay and same-ticker scoped synthetic performance: dated replay now uses canonical lot allocations and stored realized P&L before falling back to average-cost approximation, and synthetic market values load historical bars by `(ticker, marketCode)` instead of bare ticker.
  - Remaining Book Cost scope is intentionally unchecked: overview/report summary totals, explicit FX-Translated Cost surfacing, incomplete-count diagnostics, and stale-data/composite-calendar truncation still need follow-up work.
  - `npm run test --prefix apps/api -- --run test/unit/dashboardReportingCurrency.test.ts` passed: 15 tests.
  - `npx vitest run test/integration/dashboard.integration.test.ts test/integration/reports.integration.test.ts --no-file-parallelism` from `apps/api` passed: 22 tests.
  - `npx eslint apps/api/src/services/dashboardReportingCurrency.ts apps/api/test/unit/dashboardReportingCurrency.test.ts` passed.
  - `npx tsc --noEmit -p apps/api/tsconfig.json --pretty false` passed.

## Mockups

- Dashboard desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/dashboard-desktop.png`
- Dashboard mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/dashboard-mobile.png`
- Holding Focus desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/holding-focus-desktop.png`
- Holding Focus mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/holding-focus-mobile.png`
- Daily Review desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/daily-review-desktop.png`
- Daily Review mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/daily-review-mobile.png`
- Portfolio Report desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-report-desktop.png`
- Portfolio Report mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-report-mobile.png`
- Market Report desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/market-report-desktop.png`
- Market Report mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/market-report-mobile.png`
- Portfolio loading desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-loading-desktop.png`
- Portfolio loading mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/portfolio-loading-mobile.png`
- Ticker detail desktop: `docs/notes/dashboard-reporting-ui/mockups/screenshots/ticker-detail-desktop.png`
- Ticker detail mobile: `docs/notes/dashboard-reporting-ui/mockups/screenshots/ticker-detail-mobile.png`

## References

- Prior performance note: `docs/notes/performance-smooth-pages/scope-todo-20260601-performance-smooth-pages.md`
- Mockup source: `docs/notes/dashboard-reporting-ui/mockups/reports-mockup.html`
- Screenshot capture script: `docs/notes/dashboard-reporting-ui/mockups/capture-report-screenshots.mjs`
