---
slug: ticker-price-freshness-calendar-activity-revision
source: scope-grill
created: 2026-06-19
tickets: []
required_reading:
  - docs/notes/ticker-price-freshness/scope-todo-202606161500-ticker-price-freshness.md
  - apps/api/src/services/market-data/marketRegularSession.ts
  - apps/api/src/services/market-data/tradingCalendar.ts
  - apps/api/src/services/market-data/quoteSnapshotService.ts
  - apps/api/src/services/market-data/intradayDemandRefresh.ts
  - apps/api/src/services/market-data/intradayRefreshWorker.ts
  - apps/api/src/routes/adminRoutes.ts
  - apps/api/src/routes/registerRoutes.ts
  - apps/api/src/mcp/tools.ts
  - apps/web/app/admin/market-data/[marketCode]/[tab]/page.tsx
  - apps/web/components/admin/AdminMarketDataClient.tsx
  - apps/web/components/holdings/PriceStateChip.tsx
  - apps/web/features/price-state/priceState.ts
  - apps/web/components/dashboard/DashboardClient.tsx
  - apps/web/components/portfolio/PortfolioClient.tsx
superseded_by: null
---

# Todo: Ticker Price Freshness Calendar And Activity Revision

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Decisions

1. This revision supersedes `docs/notes/ticker-price-freshness/scope-todo-202606161500-ticker-price-freshness.md` for implementation work on ticker price freshness.
2. Runtime ticker freshness markets remain `TW`, `AU`, `KR`, and `US`. `JP` runtime support remains out of scope.
3. Yahoo Finance, FMP, and EODHD are not authoritative market-calendar sources.
4. Official exchange calendars are authoritative for market session truth and post-close close-refresh eligibility.
5. Daily bars remain data availability evidence. Do not use daily bars to infer whether a market should be open today.
6. Market calendar coverage is evaluated by `market + calendarYear`, not by one date at a time.
7. Required calendar horizon is current year plus next year for each supported market.
8. A confirmed market-year calendar stays healthy until superseded or explicitly invalidated. It does not expire by TTL during the year.
9. Next-year calendar health should warn after a configurable lead date, such as October 1.
10. If a supported market-year calendar is missing, stale, invalidated, or not confirmed, runtime treats the market as non-open.
11. Preserve `marketState: "closed"` for compatibility and add factual reason fields, for example `marketStateReason: "calendar_unknown"`.
12. UI copy must prefer the reason. When the reason is `calendar_unknown`, show `Calendar unknown`, not plain `Closed`.
13. When a calendar is unknown, do not enqueue Yahoo intraday refresh for that market.
14. Missing-calendar warnings should be grouped near the affected holdings price surface, not repeated on every row.
15. Missing-calendar warning copy should include the market-year and today's local market date as user context, for example: `TW market calendar for 2026 is missing. Today in Taipei is 2026-06-19. Seed it in Admin Market Data or with the admin MCP calendar tool.`
16. Price chip tooltips should include calendar reason and market-local date when relevant.
17. Admin Market Data calendar UI should be market-first, with years shown inside each market.
18. Calendar source configuration may be edited by both admin UI and admin-only MCP tools.
19. Source configuration edits must be guarded by allowlisted hosts, parser/source-type compatibility, preview-before-activation, and audit logging.
20. MCP must not fetch arbitrary URLs outside configured or allowlisted source rules.
21. Calendar import uses shared preview -> confirm flow across admin UI and MCP.
22. MCP calendar tools are admin-only. They are hidden or blocked unless the connector resolves to an admin user and the relevant admin/write policy is enabled.
23. MCP tools should support status, source listing, normalized payload preview, and normalized payload confirm.
24. MCP normalized import accepts a full annual payload for one `market + calendarYear`.
25. MCP payload can omit `source`; the server resolves the configured/default source for the market-year.
26. MCP normalized imports require `retrievedAt` and evidence at payload or row level.
27. Admin UI should also support paste-normalized JSON preview using the same schema, so admins are not forced to use MCP.
28. AI-assisted normalized payloads are allowed as `manual_ai_assisted` imports with explicit labeling, validation, evidence, and audit trail.
29. Keep a single active confirmed calendar version per `market + year`, with version history.
30. `official_parser` imports can replace `manual_ai_assisted` imports. `manual_ai_assisted` can replace `official_parser` only with explicit `replaceConfirmed=true` and reason.
31. Store early-close and lunch-break facts when present, but this PR uses only full-day closure vs open for runtime session behavior. Full early-close/lunch runtime session logic is out of scope.
32. Admin Market Data gains a Calendar panel for source status, year coverage, preview, paste JSON, confirm import, invalidate, and history.
33. Activity replaces Logs as the user-facing market diagnostics surface.
34. New route is `/admin/market-data/{marketCode}/activity`.
35. Retire `/admin/market-data/{marketCode}/logs`; it should not render or redirect after the new route lands.
36. Use the term `Activity` in UI and route names. Low-level persistence may keep legacy `provider_operation_logs` names if broad rename is not worth risk.
37. Activity is market-scoped and source-filtered. Source is a filter dimension, not a navigation level.
38. Activity source filter uses friendly source names: Yahoo chart, Official calendar, TWSE close, FinMind, and System where applicable.
39. Activity categories are `intraday_price`, `daily_close`, `calendar`, `provider_operation`, and `system`.
40. Activity results are `success`, `warning`, `error`, `skipped`, and `rate_limited`.
41. Activity should map raw worker/provider messages into stable event types and keep raw metadata only in details.
42. Activity default view is warnings and errors for the last 24 hours, with summary counts showing hidden successes.
43. Activity has a summary strip, friendly filter bar, data table, and details drawer.
44. Activity summary follows active filters and selected time range, with a subtle hidden-success hint when result filters exclude successes.
45. Activity includes provider operation milestones but does not replace the Operations page.
46. Activity is read-only. It may deep link to Operations, Calendar, or Settings, but does not mutate provider/calendar state inline.
47. Activity uses manual refresh plus pagination in this PR. No live auto-refresh.
48. Activity header should show retention policy and link to relevant Admin Settings.
49. Detailed intraday event retention defaults to short retention such as 7 days; aggregated daily counts default to longer retention such as 90 days; calendar import history defaults to long retention such as 2 years. Values must be configurable.
50. Activity search should cover ticker, provider symbol, operation id, job id, calendar year, source name/url host, and message text. Do not deep-search raw JSON by default.
51. Activity should include a clickable Yahoo chart status summary for intraday markets, such as `Yahoo chart - Last request 2m ago - 42 ok - 3 delayed bars - 1 429 - budget 38/120`.
52. Clicking the Yahoo chart summary applies filters for intraday price, Yahoo chart source, selected time range, and all results.
53. Activity rows are compact and factual on desktop and mobile, with details in a drawer.
54. Price chip popover should include intraday facts without becoming a log console.
55. Price chip popover intraday facts include basis, market state/reason, market-local bar timestamp, observed timestamp, Yahoo chart source, Yahoo symbol, delay, configured refresh cadence, latest refresh attempt/outcome when available, timezone, and calendar status.
56. Price chip popover should link or point to Activity for request history when activity evidence is available.
57. Price chip should not make a network call on hover or click just to populate the popover.
58. Chip latest-refresh facts should come from the price-state DTO or server-side quote resolution, not depend solely on retained Activity rows.
59. Dashboard and Portfolio authenticated holdings surfaces get a `Refresh prices` button.
60. `Refresh prices` is enrichment-only. It does not call `router.refresh()`, does not blank content, does not reload primary data, and does not call `POST /portfolio/refresh-closes`.
61. `Refresh prices` may enqueue intraday refresh through the normal backend read path when markets are open and overlays are stale or missing.
62. Existing `Refresh closes` remains separate for post-close daily close fallback.
63. Holdings table price-chip layout should be right-aligned on desktop and left-aligned on mobile across dashboard, portfolio, ticker/report holdings surfaces as applicable.
64. Existing silent polling remains via app API/enrichment payloads; no direct frontend Yahoo calls.
65. Public share remains daily-only and does not use intraday overlay, calendar seeding tools, or Activity polling.

## Out Of Scope

- JP runtime ticker freshness support.
- Full early-close, lunch-break, auction, pre-market, or after-hours runtime session logic.
- Arbitrary URL fetching/parsing by MCP.
- Using Yahoo, FMP, or EODHD as authoritative calendar providers.
- Activity live auto-refresh.
- Activity charts/analytics beyond summary counts.
- Public-share intraday behavior.
- Real-time streaming price updates.
- Merging multiple active calendar sources for one market-year.

## Implementation Steps

- [x] Add calendar version and row persistence for one active confirmed version per `market + calendarYear`, with version history, source metadata, source type, retrieved-at evidence, parser/source config, import operation id, and invalidation state.
- [x] Add calendar source config persistence for supported runtime markets `TW`, `AU`, `KR`, and `US`, including default official source entries, allowlisted hosts, source labels, and parser/source type metadata.
- [x] Add calendar import preview service that validates annual normalized payloads, resolves default source when omitted, enforces row/date/duplicate/source/evidence guardrails, compares against the active version, and returns a confirmable diff.
- [x] Add calendar import confirm service that writes the new active version, preserves old versions, supports guarded replacement, invalidates trading-calendar caches, and emits audit/activity events.
- [x] Add explicit calendar invalidation flow for admin/operator use.
- [x] Add admin API endpoints for calendar status, source config read/update, normalized JSON preview, confirm import, invalidate, and version/history reads.
- [x] Add admin MCP tools for calendar status, source listing/update, normalized payload preview, and confirm import, gated to admin users and admin/write policy.
- [x] Add normalized calendar payload schemas to shared/API validation. Require full annual payloads, `retrievedAt`, evidence, in-year dates, valid session states, and explicit replacement reasons when required.
- [x] Update `getRegularSessionState` and close-refresh eligibility to use confirmed official market-year calendars for `TW/AU/KR/US`.
- [x] Remove weekday fallback for supported runtime markets when official calendar data is missing or unconfirmed.
- [x] Add `marketStateReason` or equivalent factual reason to market-state and price-state DTOs while preserving `marketState: "closed"` compatibility.
- [x] Skip intraday enqueue for markets with `calendar_unknown`, and emit structured/activity events for calendar-unknown skips.
- [x] Add dashboard/portfolio/ticker/report UI handling for calendar unknown price state and tooltips.
- [x] Add grouped calendar warning near affected holdings price surfaces, including market-year and today's local market date.
- [x] Add Admin Market Data Calendar panel, market-first with year coverage, default source display/edit, paste normalized JSON, preview, diff, confirm, invalidate, and history/status.
- [x] Rename user-facing Market Data `Logs` tab to `Activity`, add `/admin/market-data/{marketCode}/activity`, remove `/logs` from valid user-facing tabs/routes, and update navigation/tests.
- [x] Add Activity API and DTOs with summary, available filters, query params, pagination, and row details.
- [x] Add activity/event persistence or equivalent query model that supports high-volume intraday events and filters by market, source, category, result, event type, ticker/symbol, operation/job id, time range, basis, chip state, and message.
- [x] Map existing provider operation milestones into Activity as `provider_operation` category events while keeping the Operations page separate.
- [x] Emit Activity events from intraday demand enqueue, intraday worker request lifecycle, Yahoo success/stale/no-bar/429/backoff/failure outcomes, close refresh/fallback outcomes, calendar preview/import/source-change/invalidation, and calendar unknown skips.
- [x] Add configurable retention for detailed intraday events, aggregated activity counts, and calendar import history.
- [x] Build the Activity UI with summary strip, source/category/result/time/search filters, compact responsive table, manual refresh, pagination, retention note, and details drawer.
- [x] Add a clickable Yahoo chart status summary that applies intraday/Yahoo filters and exposes last request, success/stale/429/error counts, and budget usage where available.
- [x] Update price-state DTO/server resolution to carry latest intraday refresh attempt/outcome facts needed by chip popovers without requiring hover-time network calls.
- [x] Update `PriceStateChip` tooltip content for intraday, delayed, open-previous-close, calendar-unknown, and closed daily states.
- [x] Add `Refresh prices` enrichment-only buttons to authenticated Dashboard and Portfolio holdings surfaces.
- [x] Ensure `Refresh prices` uses existing enrichment refresh paths only, does not trigger `router.refresh()`, does not reload primary data, and does not call close refresh.
- [x] Keep `Refresh closes` separate and ensure existing post-close daily close behavior still works.
- [x] Audit holdings table/card price-chip alignment across dashboard, portfolio, ticker/report holdings surfaces; right-align chip/text on desktop and left-align on mobile.
- [x] Add or update unit/API tests for calendar payload validation, version replacement, cache invalidation, market-state reason resolution, no weekday fallback, close-refresh eligibility, intraday enqueue skip, Activity query filters, taxonomy mapping, and retention.
- [x] Add or update web component tests for Activity filters/table/drawer, Calendar panel preview/confirm/paste flows, calendar warnings, price-chip popover intraday fields, and Refresh prices behavior.
- [x] Run `/aaa` or equivalent focused E2E updates for admin Calendar import, Activity filtering/Yahoo status, dashboard/portfolio refresh prices, and calendar-unknown warning/chip behavior.
- [ ] Update docs/notes evidence after implementation, including exact focused test commands, live validation notes, and any skipped full-suite gates.

## Open Items

- [x] Decide during implementation whether Activity needs a new `provider_event_logs` table or can meet filter/retention requirements through a narrower persistence adapter without technical debt. The acceptance criterion is the query/filter behavior above, not the table name.

Decision: use `market_data.market_calendar_activity` as the Activity query model and mirror provider-operation milestones into that model. This avoids a broad provider-log rename while still supporting Activity filters, summary counts, details, and Yahoo chart diagnostics.

## Evidence

- Preflight: worktree `/Users/lume/repos/tw-portfolio/.worktrees/codex/ticker-price-freshness`; branch `codex/ticker-price-freshness`; HEAD `4a8f53b309782dbd6730674632e93442a8aca20c`; last observed `origin/dev` `cfe3e27942628fa7a929f8d94a8a683c9c03e9d9`.
- Typecheck: `npm run typecheck` passed after the calendar/activity and ticker-details test expectation updates.
- API focused tests: `APP_CONFIG_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx vitest run apps/api/test/unit/admin-settings-price-freshness-dto.test.ts apps/api/test/unit/market-data/marketRegularSession.test.ts apps/api/test/unit/market-data/intradayDemandRefresh.test.ts apps/api/test/unit/market-data/marketCalendarActivity.test.ts apps/api/test/unit/market-data/marketCalendarService.test.ts apps/api/test/unit/market-data/intradayRefreshWorker.test.ts apps/api/test/unit/market-data/closeRefreshService.test.ts apps/api/test/integration/mcp.integration.test.ts` passed: 8 files, 49 tests.
- API quote/session regression tests: `APP_CONFIG_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npx vitest run apps/api/test/unit/quoteSnapshotService.test.ts apps/api/test/unit/tickerDetails.test.ts apps/api/test/integration/tradingCalendar.integration.test.ts apps/api/test/unit/services/market-data/tradingCalendar.test.ts` passed: 4 files, 53 tests, 4 skipped.
- Web focused tests: `npx vitest run test/app/admin/marketDataPage.test.tsx test/components/admin/AdminMarketDataClient.test.tsx test/components/holdings/PriceStateChip.test.tsx test/components/dashboard/DashboardClient.test.tsx test/components/portfolio/PortfolioClient.test.tsx` passed: 5 files, 45 tests.
- Web holdings/report tests: `npx vitest run test/components/portfolio/HoldingsTable.test.tsx test/components/reports/ReportsClient.test.tsx` passed: 2 files, 19 tests.
- Local focused validation found one obsolete expectation in `apps/api/test/unit/tickerDetails.test.ts`: the old test expected known-bar-date fallback to mark AU open. The locked scope removes weekday/known-bar fallback for supported markets, so the test now asserts the correct post-close `pending_today_close` state when an intraday overlay is used after the official session closes.
- Full gate 1: `npx eslint .` passed after removing an unused admin market-data DTO import.
- Full gate 2: `npm run typecheck` passed.
- Full gate 3: `npm run test --prefix apps/web` passed: 106 files, 705 tests.
- Full gate 4: `APP_CONFIG_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npm run test --prefix apps/api` passed after seeding the official TW 2026 calendar in the affected reports integration test: 170 files, 1,688 tests, 426 skipped.
- Full gate 5: `APP_CONFIG_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef npm run test:integration:full:host` passed: 90 files, 871 tests, 1 skipped.
- Full gate 6: `npm run test:e2e:bypass:mem --prefix apps/web` passed: 281 tests, 13 skipped. This included ticker price freshness dashboard/portfolio/ticker coverage and `mobile-ticker-price-chip-popover-aaa`.
- Full gate 7: `npm run test:e2e:oauth:mem --prefix apps/web` passed: 120 tests.
- Full gate 8: `npm run test:http --prefix apps/api` passed: 291 tests, 2 skipped.
- Full AGENTS.md gate pass is complete locally. Live Chrome validation on Vakwen Dev, final rebase/PR update, CI, and deployment remain pending for the main Codex phase.

## References

- Prior scope todo: `docs/notes/ticker-price-freshness/scope-todo-202606161500-ticker-price-freshness.md`
- UI mockups: `docs/notes/ticker-price-freshness/ui-mockups-20260619-calendar-activity/`
- Live validation notes: `docs/notes/ticker-price-freshness/live-validation-20260617/`
- Current admin market data UI: `apps/web/components/admin/AdminMarketDataClient.tsx`
- Current regular session helper: `apps/api/src/services/market-data/marketRegularSession.ts`
- Current price chip: `apps/web/components/holdings/PriceStateChip.tsx`
