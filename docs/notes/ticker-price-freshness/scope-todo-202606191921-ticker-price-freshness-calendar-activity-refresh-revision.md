---
slug: ticker-price-freshness-calendar-activity-refresh-revision
source: scope-grill
created: 2026-06-19
tickets: []
required_reading:
  - docs/notes/ticker-price-freshness/scope-todo-202606161500-ticker-price-freshness.md
  - docs/notes/ticker-price-freshness/scope-todo-202606191222-ticker-price-freshness-calendar-activity-revision.md
  - apps/api/src/services/market-data/marketRegularSession.ts
  - apps/api/src/services/market-data/tradingCalendar.ts
  - apps/api/src/services/market-data/marketCalendarService.ts
  - apps/api/src/services/market-data/quoteSnapshotService.ts
  - apps/api/src/services/market-data/intradayDemandRefresh.ts
  - apps/api/src/services/market-data/intradayRefreshWorker.ts
  - apps/api/src/services/market-data/closeRefreshService.ts
  - apps/api/src/routes/adminRoutes.ts
  - apps/api/src/routes/registerRoutes.ts
  - apps/api/src/mcp/tools.ts
  - apps/web/components/admin/AdminMarketDataClient.tsx
  - apps/web/components/dashboard/DashboardClient.tsx
  - apps/web/components/dashboard/DashboardHoldingsPreview.tsx
  - apps/web/components/portfolio/PortfolioClient.tsx
  - apps/web/components/portfolio/HoldingsTable.tsx
  - apps/web/components/holdings/PriceStateChip.tsx
  - apps/web/features/price-state/priceState.ts
  - apps/web/lib/i18n.ts
  - apps/web/features/dashboard/i18n.ts
  - apps/web/features/portfolio/i18n.ts
  - apps/web/features/settings/i18n.ts
  - apps/web/components/admin/admin-i18n.tsx
superseded_by: null
---

# Todo: Ticker Price Freshness Calendar, Activity, And Refresh Revision

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Decisions

1. This revision supersedes `docs/notes/ticker-price-freshness/scope-todo-202606191222-ticker-price-freshness-calendar-activity-revision.md` for remaining ticker price freshness work.
2. Runtime ticker freshness markets remain `TW`, `AU`, `KR`, and `US`. `JP` runtime support remains out of scope.
3. Official exchange calendars are authoritative for market session truth and post-close close-refresh eligibility. Yahoo Finance, FMP, and EODHD are not authoritative calendar sources.
4. Calendar imports are exceptions-only, not full annual date rows. Default rule: weekdays are trading days and weekends are non-trading days.
5. Calendar exceptions include weekday closures and weekend or special open days. Weekend-open exceptions are runtime-active and use the normal regular-session hours in this scope.
6. Calendar health requires an active confirmed market-year version. An empty `exceptions: []` calendar is valid only when explicitly confirmed for that market-year.
7. Missing, unconfirmed, or invalidated calendar years produce `calendar_unknown`; preserve `marketState: "closed"` for compatibility and expose factual reason fields such as `marketStateReason: "calendar_unknown"`.
8. When calendar is unknown, do not enqueue intraday Yahoo refreshes and do not run session-dependent post-close close-refresh eligibility for that market.
9. Daily bars remain data availability evidence, not session truth. If a daily bar exists while the calendar is unknown, the UI may display the latest daily price, but the chip and warning copy must prefer `Calendar unknown`.
10. The app ships default source URLs, schema, and examples only. It does not ship built-in annual calendars; admins or MCP tools seed the actual market-year calendars.
11. Remove the `official_parser` model, parser IDs, source-site scraping, UI adapters, and transformer/parser flows from this branch. The server must not fetch or parse arbitrary source pages for calendar import.
12. Calendar source config is minimal: `marketCode`, `label`, `sourceType: "official_source" | "manual_ai_assisted"`, `suggestedSourceUrl`, `enabled`, and `isDefault`.
13. Calendar versions store provenance: source label, source type, source URL, retrieved-at timestamp, coverage assertion, and normalized exceptions.
14. Source URL validation is provenance and format validation only. Do not keep per-market host allowlists because the server does not fetch source URLs.
15. Suggested source URLs:
    - TW: `https://www.twse.com.tw/en/trading/holiday.html`
    - US: `https://www.nasdaqtrader.com/trader.aspx?id=Calendar`
    - AU: `https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours/trading-calendar`
    - KR: `https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp`
16. Admin Calendar UI is JSON-paste only with schema examples and suggested source URL. Strongly encourage AI/MCP import for parsing source websites into the normalized exceptions format.
17. Replace separate MCP preview and confirm tools with one admin-only `manage_admin_market_calendar_import` tool using `mode: "preview" | "confirm"`. Preview accepts normalized payload and persists a token; confirm uses the preview token only.
18. MCP import uses the configured/default source URL as provenance when the user omits a source URL.
19. Calendar validation hard-fails invalid date, date outside year, duplicate exception, invalid status, missing name/evidence, missing full-year coverage assertion/evidence, `coverage.scope != "full_year"`, open weekday without override reason, and closed weekend without override reason.
20. Calendar validation warns on unusually low or high exception counts, weekend-open exceptions, redundant overrides, omitted source URL/default source application, and manual AI replacing an official-source version.
21. Preview diff is exception-level plus computed annual counts: added/removed/changed exceptions, trading day count, non-trading day count, weekday closed count, and weekend open count.
22. Replacement rules: `official_source` may replace `manual_ai_assisted`; `manual_ai_assisted` replacing `official_source` requires `replaceConfirmed`, replacement reason, preview warning, and audit/activity evidence. Replacing an active same-source-type version also requires explicit confirmation.
23. Do not migrate current full-year calendar data. Since this implementation is not live yet, reset or replace branch calendar migrations/schema/data as needed for the exceptions-only model.
24. Activity remains a market-scoped backend event stream. Every Activity row must belong to exactly one `marketCode`; intraday requests already carry market code from enqueue through worker emission.
25. Skip cross-market Activity aggregation design for now because Admin Market Data Activity is split by market.
26. Activity records backend events only. Do not write Activity rows for UI reads, render events, hovers, or polls unless backend work is enqueued or executed.
27. Add `sourceKind` and `sourceId` instead of relying on one closed source enum. `sourceKind` groups sources such as `yahoo_chart`, `official_calendar`, `twse_close`, `finmind`, `provider`, and `system`; `sourceId` stores provider/source identifiers when available.
28. Activity categories include `intraday_price`, `daily_close`, `calendar`, `provider_operation`, `provider_error`, `instrument`, and `system`.
29. Activity default filters are all results for the last 24 hours. Provide a `Problems only` quick filter instead of hiding successes by default.
30. Activity rows use typed details in the drawer; raw metadata is secondary/collapsed.
31. Keep Market Data tabs as `Overview`, `Calendar`, `Instruments`, `Backfill`, `Operations`, `Activity`, and `Purge`. Retire the `/logs` route.
32. Operations remains the detailed provider-operation surface. Activity is the cross-cutting event feed. Do not remove raw operation-log visibility.
33. Operations detail should use a split panel or drawer with URL focus by `operationId` and sections for Summary, Progress, Logs, Outcomes, and Related Activity.
34. Raw provider operation logs and Activity use separate retention. If raw logs are purged, Operations must show that detailed logs were purged after the configured retention.
35. Provider operation log writers should populate first-class columns going forward: provider id, market code, action/event kind, batch id, job id, counts, detail, and raw context.
36. Activity idempotency uses nullable `dedupe_key` where natural keys exist, for example provider log id, intraday job id plus event type, calendar operation id, close-refresh job and ticker, or instrument operation id.
37. For live validation only, recent provider logs may be manually mirrored into Activity from the DB container with an identifiable marker. Do not add startup/code backfill logic for this.
38. Dashboard should replace scattered calendar warnings with one combined `Market context` card. The card groups each held market with local date, timezone, session state, held count, and market-specific calendar suggestions or warnings.
39. Calendar-unknown warning text belongs inside the affected held-market section. The displayed date is today's local market date as user context, not proof that only that date is missing.
40. Portfolio shows compact per-market calendar warnings near holdings only when needed. Ticker detail and reports expose calendar facts through row chips and popovers only. Admin Market Data owns full calendar management.
41. Price chip tooltip shows factual intraday diagnostics for all users: basis, market state/reason, local market date, source, Yahoo symbol when applicable, as-of timestamp, observed-at timestamp, delay, refresh cadence, latest refresh outcome, timezone, and calendar status.
42. Admin users also get a compact Activity drill-down hint/link from the chip to the filtered market Activity tab. The chip must not fetch data on hover/click just to populate the tooltip.
43. Dashboard and Portfolio `Refresh prices` use one silent async refresh contract for both timer and manual refresh.
44. `Refresh prices` must not reload the page, call `router.refresh()`, remount the table/cards, resort, refilter, repage, or jump the user's scroll/table position.
45. The server derives the active page refresh scope from authenticated holdings and page context. Do not trust the client to send arbitrary ticker lists as the source of truth.
46. Refresh scope is all holdings in the active server-side page scope, not only visible rows and not only the limited dashboard holdings preview.
47. Refresh considers all eligible held ticker-market pairs, enqueues stale/missing pairs within configured caps, returns quickly with cached/recomputed state and `refreshPending` facts, then later polls update the UI as workers finish.
48. Manual refresh must not bypass Yahoo/provider caps. Large portfolios refresh incrementally across intervals.
49. Admin ticker freshness settings control provider cadence, budgets, supported markets, per-cycle caps, and retention. User `quotePollIntervalSeconds` controls UI polling only and cannot force provider calls faster than admin cadence.
50. When refreshed prices change, update price cells, chips, row/card metrics, page totals, rollups, and market context in place. Trend charts remain snapshot-backed and do not become live intraday charts.
51. Changed price/quote fields get a subtle flash or pulse for roughly one second, respecting `prefers-reduced-motion`. Do not use noisy count-up/count-down number animation.
52. `Refresh prices` remains separate from `Refresh closes` and must not call `POST /portfolio/refresh-closes`.
53. Holdings table/card price chip icon and text should be right-aligned on desktop and left-aligned on mobile across dashboard, portfolio, ticker/report holdings surfaces where applicable.
54. All new or changed UI copy in this scope must include English and zh-TW translations through the existing app i18n surfaces. Do not leave new dashboard, portfolio, admin, Activity, Operations, Calendar, refresh, or price-chip text hardcoded in English-only components.
55. Public share remains daily-only and does not use intraday overlays, calendar seeding tools, Activity polling, or refresh-price behavior.

## Out Of Scope

- JP runtime ticker freshness support.
- Full early-close, lunch-break, auction, pre-market, or after-hours runtime session logic.
- Server-side scraping/parsing of official calendar websites.
- UI calendar source adapters/transformers/parsers.
- Using Yahoo, FMP, or EODHD as authoritative calendar providers.
- Cross-market Activity aggregation UI.
- Activity live auto-refresh beyond manual refresh and normal page interaction.
- Turning price-chip tooltip into a full log console.
- Real-time streaming prices.
- Public-share intraday behavior.
- Live intraday trend charts or mutation of historical snapshot chart points.

## Implementation Steps

- [x] Replace calendar schema/migrations with exceptions-only versions, previews, and minimal source configs; remove full-year row payload storage, parser ids, and host allowlists.
- [x] Update shared/API calendar payload schemas for normalized exceptions, coverage assertion, evidence, source provenance, preview tokens, replacement confirmation, and strict validation/warning rules.
- [x] Update calendar services to compute weekday/weekend defaults plus exceptions, version health, annual counts, preview diffs, cache invalidation, replacement, invalidation, and history.
- [x] Update regular-session and close-refresh eligibility to depend on confirmed exceptions-only calendars and emit `calendar_unknown` reasons without weekday fallback.
- [x] Update admin Calendar APIs and UI to show suggested source URLs, JSON examples, preview/confirm, exception diffs, computed annual counts, replacement warnings, invalidation, and market/year history.
- [x] Replace MCP calendar preview/confirm tools with `manage_admin_market_calendar_import` using `mode: "preview" | "confirm"`; apply admin auth/write policy and default source URL provenance.
- [x] Update dashboard Market context card to group held markets with today's local market date, timezone, session state, held counts, and market-specific calendar warnings/suggestions.
- [x] Update Portfolio, Ticker, Reports, and price-state surfaces to show calendar-unknown facts in the agreed local context without duplicating noisy row warnings.
- [x] Extend Activity persistence/DTOs with `sourceKind`, `sourceId`, `dedupeKey`, new categories, all-results default filters, typed details, and market-scoped query behavior.
- [x] Update Activity UI filters, summary, table, details drawer, and Yahoo/intraday quick filters for rich but compact diagnostics.
- [x] Restore/enhance Operations raw log visibility with operation-focused detail drawer/panel, URL focus, first-class log columns, retention copy, and Related Activity links.
- [x] Update provider operation log writers to populate provider id, market code, action/event kind, batch id, job id, counts, detail, and raw context going forward.
- [x] Emit Activity events for intraday demand enqueue/skip, worker request lifecycle, Yahoo success/delay/no-bar/429/error, close refresh/fallback, calendar preview/import/source change/invalidation, instrument events, and provider errors with appropriate dedupe keys.
- [x] Update price-state DTO/server resolution to include source kind/id, Yahoo symbol, refresh cadence, latest refresh attempt/outcome, refresh pending facts, calendar status/reason, and admin Activity drill-down facts.
- [x] Update `PriceStateChip` tooltip for factual intraday diagnostics, admin Activity link, mobile/desktop popover behavior, and no hover-time network dependency.
- [x] Implement all-scope silent `Refresh prices` for Dashboard and Portfolio using server-derived authenticated page scope, async enqueue, fast return, caps, `refreshPending`, and in-place quote-state patching.
- [x] Ensure refresh polling updates current price, chip state, row/card metrics, totals, rollups, and market context without page reload, route refresh, remount, resort, refilter, repage, or scroll/table jump.
- [x] Add subtle changed-value flash/pulse animation for updated price/quote fields and chips, respecting `prefers-reduced-motion`.
- [x] Keep `Refresh prices` independent from `Refresh closes`; verify close refresh behavior still works after the calendar exceptions-only changes.
- [x] Audit and fix price chip alignment on dashboard, portfolio, ticker, and report holdings surfaces: right-aligned on desktop and left-aligned on mobile.
- [x] Add or update English and zh-TW i18n dictionary entries for all new/changed Calendar, Activity, Operations, Market context, Refresh prices, refresh-pending, changed-value animation, and price-chip tooltip copy.
- [x] Add focused API/unit tests for calendar exception validation, replacement, version health, session resolution, calendar unknown behavior, close refresh eligibility, intraday enqueue skip, Activity taxonomy/query/dedupe, and Operations log visibility.
- [x] Add focused web tests for Calendar JSON import UI, Market context card, Activity filters/details, Operations details, price-chip tooltip diagnostics/admin link, refresh-price no-reload behavior, in-place totals/row updates, animation classes, and alignment.
- [x] Run `/aaa` or equivalent E2E updates for admin Calendar import, Activity filtering, Operations log drill-down, dashboard/portfolio refresh prices, calendar-unknown market context, and mobile price-chip popover.
- [x] During validation, manually mirror recent 48h provider logs into Activity from the dev DB container only if needed for live validation, marking them clearly as manual validation data.
- [x] Update this todo with implementation evidence, focused test commands, live validation notes, rate-limit/performance observations, skipped gates, and any remaining risks.

## Implementation Evidence

- Calendar schema now stores minimal source configs with suggested source URLs plus preview/version `coverage`, `annual_counts`, and `exceptions`; parser IDs, host allowlists, and full-year row storage were removed from the branch migration.
- Calendar runtime now computes weekday/weekend defaults plus exceptions. Missing active confirmed market-years still return `calendar_unknown` and skip intraday enqueue / session-dependent close refresh.
- MCP calendar import uses one `manage_admin_market_calendar_import` tool with `mode: "preview" | "confirm"` and normalized exceptions-only payloads.
- Activity persistence and DTOs now use `sourceKind`, `sourceId`, and nullable `dedupeKey`; the Postgres path upserts natural duplicate events when a dedupe key is present.
- Provider operation logs gained first-class provider/market/event/job/count/detail/raw-context columns and continue to mirror provider milestones into market-scoped Activity.
- Dashboard uses a richer market-context card; price-state chips expose structured tooltip rows plus optional Activity drill-down and mobile-safe popovers; dashboard/portfolio refresh-price paths remain silent enrichment refreshes.
- Dashboard and Portfolio now return and display localized refresh-pending facts from the silent enrichment responses, including queued, capped, calendar-blocked, and idle outcomes.
- Yahoo intraday overlays now stamp canonical `sourceKind: "yahoo_chart"` plus the resolved provider/Yahoo symbol; quote price-state DTOs carry source id, provider symbol, Yahoo symbol, calendar facts, and refresh cadence when available.
- Overlay-backed price states now include latest refresh attempt/outcome facts. Admin-aware Dashboard, Portfolio, Reports, and Ticker detail chips generate filtered Market Data Activity drill-down links at render time without exposing admin URLs in shared quote DTOs.
- Provider-error trail inserts now mirror supported market errors into market-scoped Activity rows, and admin instrument support-state / delisting-override mutations emit instrument Activity rows with dedupe keys.
- Admin Market Data Activity and Calendar shell copy now uses the admin i18n provider with English and zh-TW entries for the revised Activity filters/details and Calendar import/status flows.
- Admin Market Data Calendar/Activity fallback labels, retention text, Yahoo detail text, raw metadata labels, and source/category/result labels now use English and zh-TW admin dictionaries. Price-state reason/outcome facts now use localized holding dictionary entries while preserving English fallbacks for partial test dictionaries.
- Added append-only migration `db/migrations/082_market_calendar_activity_schema_reconcile.sql` after dev live validation found an already-applied older calendar/activity migration without the current `source_url`/exceptions-only columns. The reconcile migration upgrades older dev/prod-like schemas to the current Calendar and Activity contract without rewriting migration history.
- Applied migration 082 manually to the Vakwen Dev Postgres container during validation, then reran it successfully to verify idempotency. This fixed the live Admin Market Data Calendar/Activity `source_url` schema error before the branch deploy picks up the migration normally.
- Added append-only migration `db/migrations/083_market_calendar_activity_legacy_source_nullable.sql` after QNAP live validation found an older dev table still carrying legacy `market_calendar_activity.source TEXT NOT NULL`. New code writes `source_kind`; the legacy column now becomes nullable with default `system` only when it exists, and fresh installs remain unchanged.
- Applied migration 083 manually to the Vakwen Dev Postgres container and recorded it in `schema_migrations`. Afterward, Dashboard `Refresh prices` stayed on `/dashboard`, preserved scroll position, returned `5 blocked by calendar`, and wrote four fresh `official_calendar` skipped Activity rows instead of degrading with the prior `null value in column "source"` error.

## Live Validation

- PR head `7a9490e4` passed GitHub CI (`27839368443`) and PR Gate (`27839396020`) before the live pass; dev deploy `27839753130` completed successfully for that head.
- QNAP dev containers were healthy after deploy: `vakwen-dev-web`, `vakwen-dev-api`, `vakwen-dev-redis`, and `vakwen-dev-postgres` all reported healthy/up.
- Admin Calendar live validation on TW showed JSON-paste import UI, suggested official source URL, missing 2026/2027 calendar warnings with today's local reference date, Preview and Confirm import controls, and no alerts.
- Admin Activity live validation showed TW market-scoped daily-close/calendar skip rows with all-results default filters and Problems-only quick filter. AU and KR Activity showed Yahoo chart summary cards, source-kind/source-id/category/result/time filters, and marked `codex-qnap-investigation-20260619` intraday validation rows from the recent 48h DB seed. No additional manual Activity rows were inserted in this pass.
- Activity detail drawer live validation opened a KR row and showed typed Summary/Progress/Outcomes sections plus collapsed Raw metadata.
- Admin Operations live validation showed KR resolver operation history with Operation inspector and Open activity link; AU generic Operations showed provider filters, operation rows, detail content, raw-log retention copy, and Related Activity link.
- Dashboard live validation showed the Market context card for TW/US/AU/KR, `Refresh prices`, unchanged URL/scroll after manual refresh, calendar-blocked refresh status, and closed price chips. Earlier Chrome validation on this deployed SHA also verified Dashboard, Portfolio, and Ticker price-chip popovers include basis, market date, cadence, timezone/calendar facts, and admin Activity links.
- QNAP API logs after migration 083 showed clean `/dashboard/enrichment` read-path timings and no fresh `market_calendar_activity.source` NOT NULL failures. QNAP Activity query for the last 10 minutes showed one `official_calendar`/`calendar`/`skipped` row each for TW, US, AU, and KR at `2026-06-19 17:51:27 UTC`.

## Focused Validation

- Passed: `npm run build -w @vakwen/api`
- Passed: `npm run typecheck`
- Passed: `npx vitest run apps/api/test/unit/market-data/marketCalendarService.test.ts apps/api/test/unit/market-data/marketCalendarActivity.test.ts apps/api/test/unit/market-data/marketRegularSession.test.ts apps/api/test/unit/market-data/intradayDemandRefresh.test.ts apps/api/test/unit/market-data/closeRefreshService.test.ts`
- Passed: `npx vitest run apps/api/test/unit/market-data/yahooFinanceIntradayProvider.test.ts apps/api/test/unit/quoteSnapshotService.test.ts apps/api/test/unit/market-data/intradayRefreshWorker.test.ts apps/api/test/unit/market-data/marketCalendarActivity.test.ts`
- Passed: `npm run build -w @vakwen/api`
- Passed: `npx vitest run apps/api/test/unit/market-data/marketCalendarActivity.test.ts`
- Passed: `npm run test:http --prefix apps/api -- test/http/specs/admin-instruments-aaa.http.spec.ts`
- Passed: `npx tsc --noEmit -p apps/web/tsconfig.json`
- Passed: `cd apps/web && npx vitest run test/app/admin/marketDataPage.test.tsx test/components/admin/AdminMarketDataClient.test.tsx test/components/holdings/PriceStateChip.test.tsx`
- Passed: `cd apps/web && npx vitest run test/components/admin/AdminMarketDataClient.test.tsx`
- Passed: `cd apps/web && npx vitest run test/components/portfolio/PortfolioClient.test.tsx test/components/holdings/PriceStateChip.test.tsx`
- Passed: `cd apps/web && npx vitest run test/components/dashboard/DashboardClient.test.tsx test/components/reports/ReportsClient.test.tsx test/app/tickers/TickerHistoryClient.test.tsx`
- Passed: `cd apps/web && npx vitest run test/app/admin/marketDataPage.test.tsx test/components/admin/AdminMarketDataClient.test.tsx`
- Passed: `cd apps/web && npx vitest run test/components/holdings/PriceStateChip.test.tsx`
- Passed: `npm run typecheck`
- Passed: `git diff --check`
- Passed: `npx vitest run apps/api/test/unit/smooth-page-read-paths.test.ts`
- Passed: `npx vitest run apps/api/test/unit/market-data/marketCalendarActivity.test.ts apps/api/test/unit/market-data/intradayDemandRefresh.test.ts apps/api/test/unit/quoteSnapshotService.test.ts`
- Passed: `npm run typecheck`
- Passed: `npm run test --prefix apps/api` (170 files passed, 44 skipped; 1690 tests passed, 426 skipped)
- Passed: `npm run test --prefix apps/web` (48 files / 299 tests passed in the first Vitest batch; 58 files / 408 tests passed in the second Vitest batch)
- Passed: `npx eslint .`
- Passed: `npm run test:integration:full:host` (90 files passed; 871 tests passed, 1 skipped)
- Passed: `npm run test:e2e:bypass:mem --prefix apps/web` (281 passed, 13 skipped)
- Passed: `npm run test:e2e:oauth:mem --prefix apps/web` (120 passed)
- Passed: `npm run test:http --prefix apps/api` (291 passed, 2 skipped)
- Passed: `cd apps/web && npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/specs/ticker-price-freshness-aaa.spec.ts tests/e2e/specs/mobile-ticker-price-chip-popover-aaa.spec.ts` (focused freshness and mobile popover paths passed)
- Passed: `cd apps/web && npx vitest run test/components/holdings/PriceStateChip.test.tsx` (10 tests passed after the fixed-position portal popover update)
- Passed: `npx eslint apps/api/test/integration/postgres-migrations.integration.test.ts`
- Passed: `VAKWEN_MANAGED_CI_STACK=1 RUN_POSTGRES_INTEGRATION=1 POSTGRES_CONNECTION_TIMEOUT_MS=10000 REDIS_CONNECTION_TIMEOUT_MS=10000 POSTGRES_PERSISTENCE_SKIP_REDIS_INIT=1 POSTGRES_TEST_DB_URL='postgres://app:app@192.168.64.1:15432/vakwen_ci?connect_timeout=10' POSTGRES_TEST_REDIS_URL='redis://192.168.64.1:16379' npm run test:integration:full -w apps/api -- test/integration/postgres-migrations.integration.test.ts -t 'keeps the baseline schema in parity with the numbered upgrade path'` (1 passed, 871 skipped) after adding calendar/activity schema assertions.
- Passed: `npm run test:integration:full:host` after migration 082 and the parity assertion update (90 files passed; 871 tests passed, 1 skipped; duration 1278.16s).
- Passed: `VAKWEN_MANAGED_CI_STACK=1 RUN_POSTGRES_INTEGRATION=1 POSTGRES_CONNECTION_TIMEOUT_MS=10000 REDIS_CONNECTION_TIMEOUT_MS=10000 POSTGRES_PERSISTENCE_SKIP_REDIS_INIT=1 POSTGRES_TEST_DB_URL='postgres://app:app@192.168.64.1:15432/vakwen_ci?connect_timeout=10' POSTGRES_TEST_REDIS_URL='redis://192.168.64.1:16379' npm run test:integration:full -w apps/api -- test/integration/postgres-migrations.integration.test.ts -t 'keeps the baseline schema in parity with the numbered upgrade path'` after migration 083 (1 passed, 871 skipped). The first selective attempt against `localhost:15432` failed with `ECONNREFUSED`; rerunning against the repo's detected Docker host `192.168.64.1` passed.
- Fetched `origin/dev`; current branch already contains the fetched dev tip (`git rev-list --left-right --count HEAD...origin/dev` => `63 0`), so no rebase was required in this pass.
- Ran SI memory review for durable lessons; no promotion was made because existing repo memory/rules already cover the reusable route-enrichment and market-data identity patterns, and the new notes are scope-specific implementation evidence.
- Local AGENTS.md validation: all eight required suites passed before the migration-083 follow-up. After migration 083, focused migration parity and live QNAP validation passed; full-suite rerun remains for CI after push.

## Remaining Risks

- Final browser/live validation after the next dev deploy is still pending for the migration-083 commit. Migration 083 was manually applied on Vakwen Dev and validated against live Dashboard refresh/QNAP logs, but the branch still needs CI, deploy, and a post-deploy smoke pass at the new head.
- Focused web suites pass with existing noisy React test-environment/chart sizing/key warnings; no focused test failures were observed.
- Admin Market Data still contains English-heavy strings in legacy-adjacent Instruments/Backfill/Purge surfaces outside this refresh revision; the scoped Calendar, Activity, Operations, Market context, Refresh prices, refresh-pending, and price-chip tooltip copy now have English and zh-TW coverage.
- Price-state admin Activity drill-down is render-gated by admin-aware web surfaces instead of embedded in shared quote DTOs; this avoids exposing admin URLs to non-admin/public contexts and passed local component/e2e coverage, with final browser validation still pending.
- Activity emission now covers provider-operation, calendar, intraday, close-refresh, instrument mutation, and provider-error trail paths in focused tests/code paths. Live Activity visibility was validated for TW/AU/KR after the migration-082 deploy and for fresh calendar-skip Activity after applying migration 083 manually.

## Open Items

- [x] No unresolved scope decisions remain. Reopen this section only if implementation discovers a contradiction with existing repo contracts.

## References

- Superseded revision todo: `docs/notes/ticker-price-freshness/scope-todo-202606191222-ticker-price-freshness-calendar-activity-revision.md`
- Original ticker freshness todo: `docs/notes/ticker-price-freshness/scope-todo-202606161500-ticker-price-freshness.md`
- Prior UI mockups: `docs/notes/ticker-price-freshness/ui-mockups-20260619-calendar-activity/`
- Prior live validation notes: `docs/notes/ticker-price-freshness/live-validation-20260617/`
