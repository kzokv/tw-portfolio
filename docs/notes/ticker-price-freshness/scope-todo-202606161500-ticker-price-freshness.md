---
slug: ticker-price-freshness
source: scope-grill
created: 2026-06-16
updated: 2026-06-17
tickets: []
required_reading:
  - apps/api/src/services/market-data/quoteSnapshotService.ts
  - apps/api/src/services/dashboard.ts
  - apps/api/src/services/dashboardReportingCurrency.ts
  - apps/api/src/services/valuationHealth.ts
  - apps/api/src/routes/adminRoutes.ts
  - apps/api/src/services/appConfig/bounds.ts
  - apps/web/lib/routeDtoCache.ts
superseded_by: null
---

# Todo: Ticker Price Freshness

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Decisions

- This revised scope supersedes the original post-close-only scope in this file.
- Supported MVP markets are `TW`, `US`, `AU`, and `KR`; `JP`, EODHD, and additional market providers remain out of scope.
- The feature is hybrid: intraday market-hours price overlay plus the existing post-close daily close refresh flow.
- During regular market hours, authenticated dashboard, portfolio, ticker detail, and current valuation surfaces use the intraday overlay when available.
- Snapshot generation, historical trend charts, and daily-bar history remain daily-bar based and must not ingest intraday overlay prices.
- Valuation health remains a daily-bar/snapshot reconciliation feature. It must not raise repair actions solely because authenticated current valuation is using intraday overlay while performance snapshots remain daily-bar based.
- Valuation health should compare against a daily-bar-compatible current value, or otherwise suppress/annotate intraday-overlay-only deltas using `priceState`, so intraday price movement does not look like stale snapshot damage.
- Intraday refresh is demand-triggered: authenticated dashboard, portfolio, or ticker reads enqueue stale or missing held ticker-market pairs while their market is open.
- Intraday refresh scope is held tickers only, globally deduped by `ticker + market`; search-only, catalog-only, watchlist-only, and public-share traffic do not enqueue intraday refresh.
- The frontend polls the app API/enrichment payloads, not Yahoo Finance directly.
- Redis stores the latest intraday overlay per `ticker + market`; pg-boss owns the background refresh queue with singleton keys per `ticker + market`.
- Memory-mode tests/dev may use in-memory overlay and no-op queue fallbacks; production Redis or pg-boss unavailability degrades to daily-bar pricing and structured logs.
- Yahoo chart intraday default request is `range=1d`, `interval=1m`, `includePrePost=false`.
- Yahoo chart `range` and `interval` are admin-configurable with constrained options; `includePrePost=false` is fixed for MVP.
- The worker selects the latest same-market-date non-null close from Yahoo intraday bars and uses that bar timestamp as the factual quote timestamp.
- Market-open detection is regular cash-market session only, using the existing trading calendar plus market time zones; half-days, auctions, pre-market, after-hours, and special sessions are out of scope.
- Fresh intraday means the Yahoo bar timestamp is within `intradayFreshnessToleranceMinutes`; default tolerance is `max(2 * intradayRefreshIntervalMinutes, 20 minutes)`.
- Same-day stale Yahoo bars still drive current price, but render as delayed; previous close is used during market hours only when no valid same-day Yahoo bar exists.
- Price chip states are green, amber, and gray:
  - Green: market open, same-day intraday bar is fresh.
  - Amber: market open with delayed same-day intraday bar, or market open using previous close because no same-day intraday bar exists.
  - Gray: market closed and using close or previous close data.
- The chip belongs in the price cell, not beside the ticker, to avoid confusing market state with ticker status.
- The chip shows a relative label such as `Updated 10m ago` or `Delayed 35m ago`; tooltips show the exact Yahoo bar timestamp, observed-at timestamp, source, and delay facts.
- The API must not send localized or relative chip labels. The frontend derives display text from factual DTO fields.
- Add `PriceStateDto` and make it the source of truth for price chips and price data-health. It replaces the old `freshness` and `freshnessTooltip` DTO fields; no compatibility alias is kept.
- Keep `quoteStatus` for quote availability/provisional/missing semantics, but remove price-bearing DTO reliance on the old `freshness` enum.
- `PriceStateDto` includes factual fields: `basis`, `chipState`, `marketState`, `source`, `sourceKind`, `asOfDate`, `asOfTimestamp`, `observedAt`, `delaySeconds`, `marketTimeZone`, and daily-bar `quality`.
- `PriceStateDto` fields that do not apply to a basis are nullable, not omitted. `quality` is nullable for intraday, previous-close-only, and missing states; `asOfTimestamp` is nullable for date-only daily bars.
- `sourceKind` is a coarse stable enum for UI/tool semantics; `source` carries the specific provider id. MVP source kinds are `primary_daily`, `intraday_yahoo_chart`, `twse_stock_day_close`, `yahoo_chart_close`, and `missing`.
- `basis` covers `intraday`, `delayed_intraday`, `previous_close`, `today_close`, `pending_today_close`, `stale_close`, and `missing`.
- `chipState` covers `open_fresh`, `open_delayed`, `open_previous_close`, `closed`, `stale`, and `missing`.
- Reports/data-health rename stale quote counting to `nonCurrentPriceCount`, derived from `priceState`.
- Report diagnostics and dashboard performance gap reasons should also stop exposing legacy `stale_quote` naming where the condition is now broader than stale daily bars; use non-current price terminology for new DTOs/copy.
- Dashboard gets a held-markets-only market-state summary, sorted `TW`, `US`, `AU`, `KR`, using the same regular-session logic as `priceState`.
- The market-state summary is dashboard-only. Portfolio, ticker, reports, and public share use row-level price state only.
- The dashboard market-state summary is separate from the latest-dev valuation-health market freshness table. The valuation-health table remains about daily-bar and snapshot repair status; copy/DTO naming must avoid conflating it with market open/closed or `priceState`.
- Dashboard/report aggregate valuation fields can be composed from mixed price bases. Existing date-only `summary.asOf` / report `asOf` remains the request or daily valuation date; price freshness for aggregate values must come from row `priceState` rollups or market-state/non-current counts, not a single aggregate quote timestamp.
- Public share views do not use intraday overlay or enqueue intraday refresh. They may expose daily-only `priceState` if needed, but remain stable read-only share snapshots.
- Standalone quote reads without authenticated held-portfolio context stay daily-bar-only and must not enqueue intraday work.
- MCP price-bearing outputs are in scope. They must return `priceState`/non-current price facts instead of legacy `freshness` / `freshnessTooltip`; tool copy should stop promising old freshness fields.
- Post-close refresh continues to reuse `market_data.daily_bars`; add `quality = full_bar | close_only`.
- Close-only fallback rows use synthetic OHLCV: `open = high = low = close`, `volume = 0`.
- Full bars overwrite close-only rows; close-only rows never overwrite full bars. A later full-bar fetch updates `quality` to `full_bar`.
- Post-close TW fallback order is primary daily provider, TWSE `STOCK_DAY` close-only, then Yahoo chart close fallback.
- Post-close US fallback order is primary daily provider, then Yahoo chart close fallback.
- Post-close AU/KR use their existing Yahoo daily-bar providers before any close fallback behavior.
- The authenticated `POST /portfolio/refresh-closes` endpoint remains no-body; the server derives eligible held tickers and markets.
- Manual close refresh is synchronous up to the configured cap and queued beyond the cap; queued-large responses return per-ticker `queued` statuses only.
- Intraday refresh has no manual button in MVP. The existing post-close `Refresh closes` action remains only on authenticated dashboard/portfolio holdings surfaces.
- Manual post-close refresh must invalidate or bypass cached dashboard/portfolio route data so refreshed closes are visible immediately.
- Intraday polling must not be masked by session route DTO cache. While relevant markets are open, dashboard/portfolio/ticker polling must bypass, refresh, or cap cached price-bearing DTOs so the configured polling interval is the effective visible update cadence.
- Existing daily change semantics remain current-price versus previous close where a current price is available; historical chart semantics remain unchanged.
- Admin settings expose one grouped ticker-price-freshness config at the service/UI boundary. It includes close-refresh and intraday-refresh settings together.
- Persistence, PATCH schema, bounds, cache, and audit plumbing may remain flat fields to match the current admin-settings architecture; the grouped object is the resolver/DTO/UI shape, not a requirement to nest DB storage.
- The grouped config includes close grace minutes, intraday enablement, intraday refresh interval, freshness tolerance, Yahoo request limit, queue concurrency, max tickers per refresh cycle, supported markets, regular-session-only flag, Yahoo chart range, Yahoo chart interval, refresh endpoint rate limits, and sync ticker cap.
- Enum/list config fields such as supported markets and Yahoo chart interval/range need explicit constrained schemas and select/segmented admin controls, not numeric override rows.
- The new Yahoo chart request budget is separate from existing AU/KR daily-provider Yahoo budgets and must be enforced at the queue/worker level. The existing in-memory `RateLimiter` is not sufficient by itself if more than one worker/process can make Yahoo chart requests.
- Background jobs and provider failures use structured logs for start/completion, queue depth, rate limits, Yahoo 429s, stale overlays, fallback failures, and close-only rows later corrected by full bars.
- No new admin history UI, polling/history UI for queued refreshes, half-day support, pre/post-market support, snapshot regeneration, EODHD, or JP support in MVP.

## Implementation Steps

- [x] Add a `quality` column to `market_data.daily_bars` with `full_bar` default and a `full_bar | close_only` constraint; update baseline schema, migrations, memory persistence, Postgres persistence, and migration tests.
- [x] Update daily-bar upsert types and `upsertDailyBars` to accept quality and enforce conflict rules: full bars overwrite close-only rows, close-only rows do not overwrite full bars, and full-bar correction updates `quality`.
- [x] Add flat app-config storage/PATCH/bounds/cache/audit fields plus a grouped ticker-price-freshness resolver/DTO and admin settings UI for close grace, intraday enablement, intraday interval, intraday tolerance, Yahoo request limit, queue concurrency, cycle cap, supported markets, Yahoo chart interval/range, refresh endpoint limits, and sync ticker cap.
- [x] Add regular-session market-state helpers for `TW`, `US`, `AU`, and `KR` using the existing trading calendar, market time zones, and regular session windows.
- [x] Add shared `PriceStateDto` types and remove `freshness` / `freshnessTooltip` from price-bearing shared DTOs, app DTO builders, frontend types, tests, and fixtures.
- [x] Define `PriceStateDto` nullability and source-kind enums in shared types, then thread them through domain `QuoteSnapshot` / API DTO conversion without relying on localized strings.
- [x] Rename report/data-health stale quote counting to `nonCurrentPriceCount` and derive it from `priceState` instead of the old freshness enum.
- [x] Update report and dashboard data-health filters/sorts/presets/diagnostics to use `priceState` / `nonCurrentPriceCount`, replacing old `freshness` ranking, `staleQuoteCount`, `stale_quote`, and labels where semantics changed.
- [x] Update MCP portfolio read outputs and tool descriptions/tests so holdings and quote diagnostics expose `priceState` facts instead of `freshness` / `freshnessTooltip`.
- [x] Implement a Redis-backed latest-price overlay cache keyed by `market + ticker`, with a memory fallback for memory-mode tests/dev.
- [x] Implement a Yahoo intraday chart provider using configurable `range` and `interval`, fixed `includePrePost=false`, market-specific symbol mapping, and latest same-day non-null close extraction.
- [x] Add an intraday refresh pg-boss queue and worker with singleton keys per `ticker + market`, configurable concurrency, queue-level Yahoo request budget, 429/backoff handling, stale overlay logs, and no user-visible page failures.
- [x] Add a demand-trigger enqueue service that derives held ticker-market pairs, filters to open regular-session markets, checks overlay age, respects max tickers per cycle, and enqueues only missing or stale overlays.
- [x] Update quote snapshot / price resolution to merge daily bars and intraday overlay into one displayed price: open fresh intraday, open delayed intraday, open previous close, closed today close, closed pending close, stale close, or missing.
- [x] Ensure intraday overlay affects authenticated current holdings valuation, market value, and current P&L, but does not write daily bars, snapshots, trend charts, or historical series.
- [x] Add aggregate price-state rollups for dashboard/report summary values that use mixed row price bases; keep existing date-only `asOf` fields for request/daily valuation semantics.
- [x] Make valuation health intraday-aware: use a daily-bar-compatible current valuation or suppress/annotate intraday-overlay-only deltas so repair actions still represent daily-bar/snapshot problems.
- [x] Reconcile valuation-health `marketFreshness` DTO/copy with the new dashboard `marketStates` summary so daily-bar repair status and market open/closed price state remain visually and semantically distinct.
- [x] Build the post-close close refresh service: derive held ticker-market pairs, filter by market close plus grace, check existing daily bars, call primary daily providers first, and invoke TWSE `STOCK_DAY` / Yahoo close fallback only when needed.
- [x] Add TWSE `STOCK_DAY` close-only fallback for TW and Yahoo chart close fallback for TW/US as scoped; keep EODHD and JP out of scope.
- [x] Add or update `POST /portfolio/refresh-closes` with no body, authenticated user scope, refresh-specific user/IP rate limiting, synchronous execution up to the configured cap, and queued response mode above the cap.
- [x] Add/extend the market-close refresh queue and worker for scheduled runs and large manual close-refresh requests, globally deduped across held ticker-market pairs.
- [x] Ensure manual close refresh invalidates targeted dashboard/portfolio route cache entries or uses a cache-busting/refetch path so users see refreshed closes immediately.
- [x] Add frontend polling for authenticated dashboard, portfolio, and ticker enrichment at the configured intraday interval while relevant held markets are open; polling reads app API data only and bypasses/refreshes route DTO cache when price-bearing data is open-market sensitive.
- [x] Add a reusable `PriceStateChip` component with green/amber/gray dot, relative frontend-derived labels, exact timestamp tooltip, source, quality, observed-at, delay, and timezone details.
- [x] Wire `PriceStateChip` into authenticated price-bearing surfaces: dashboard holdings, portfolio holdings, ticker detail quote/position areas, and reports current holdings.
- [x] Keep public share daily-only: do not poll, do not enqueue intraday refresh, and do not use intraday overlay in public share valuation.
- [x] Add dashboard-only held-market state summary using server-derived `marketStates`, sorted by `TW`, `US`, `AU`, `KR`.
- [x] Replace old data-health freshness badges and ticker freshness rendering with `priceState`-based UI, while keeping `quoteStatus` badges for availability/provisional/missing.
- [x] Keep the `Refresh closes` action only on authenticated dashboard/portfolio holdings surfaces; refetch relevant data after success or queued close-refresh response.
- [x] Keep daily-change rendering compatible with existing semantics and ensure current price, previous close, change, and changePercent remain coherent when intraday overlay is used.
- [x] Add structured logs for intraday enqueue/worker lifecycle, Yahoo success/stale/429/failure outcomes, post-close refresh summaries, fallback failures, and close-only rows later corrected by full bars.
- [x] Add tests for daily-bar quality migration/schema, guarded upsert semantics, app config bounds/resolution/admin fixtures including enum/list controls, market-state helpers, Yahoo intraday parsing, Redis overlay cache, pg-boss enqueue dedupe, queue-level rate-limit/backoff behavior, price-state resolution and aggregate rollups, valuation-health intraday false-positive avoidance, close-refresh provider order, manual close-refresh API contract, route cache refresh behavior, dashboard market summary, MCP price-state output, UI chips, and report/data-health metric renames.
- [x] Run `/aaa` to add or update E2E tests covering visible intraday price chips, delayed/previous-close states, dashboard market-state summary, and the post-close refresh workflow.

## Open Items

- [x] Confirm whether the TW close-only fallback must cover TPEx-listed instruments too, or whether TWSE `STOCK_DAY` best-effort fallback behind the primary daily provider is enough for MVP. Decision: TWSE `STOCK_DAY` best-effort behind the primary daily provider is enough for MVP; no TPEx-specific fallback.

## Evidence

- Latest dev base confirmed after fetch: `HEAD` and `origin/dev` both `cfe3e27942628fa7a929f8d94a8a683c9c03e9d9`.
- Focused post-gap E2E: `npm run test:e2e:bypass:mem --prefix apps/web -- --project=chromium apps/web/tests/e2e/specs/ticker-price-freshness-aaa.spec.ts` passed, 2 tests.
- Final full repo gates after the final E2E addition and latest-dev confirmation:
  - `npx eslint .` passed.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: first phase `47` files / `270` tests; second phase `57` files / `398` tests.
  - `npm run test --prefix apps/api` passed: `167` files passed, `44` skipped; `1643` tests passed, `425` skipped.
  - `npm run test:integration:full:host` passed: `89` files / `861` tests passed, `1` skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: `280` tests passed, `12` skipped, including ticker-price-freshness dashboard/portfolio/ticker close-refresh coverage.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: `120` tests passed.
  - `npm run test:http --prefix apps/api` passed: `291` tests passed, `2` skipped.
- Scope audit searches: no unchecked todo boxes remained, and no `freshnessTooltip`, `staleQuoteCount`, or `stale_quote` references remained in `libs/shared-types/src`, `apps/api/src`, or `apps/web`.
- Post-Codex-review fixes:
  - Close refresh now resolves the latest eligible prior trading close when today is not yet eligible or is not a trading day.
  - `tickerPriceRegularSessionOnly=false` no longer disables intraday overlays during an open regular session.
  - Focused verification passed: `npx vitest run apps/api/test/unit/market-data/marketRegularSession.test.ts apps/api/test/unit/quoteSnapshotService.test.ts` (`2` files / `19` tests).
  - Focused ESLint passed for touched market-session, quote-snapshot, and unit-test files.
  - Broader post-fix verification passed: `npm run typecheck`; `npm run test --prefix apps/api` (`167` files passed, `44` skipped; `1646` tests passed, `425` skipped).
- Deploy hardening:
  - Dev deploy run `27670119887` timed out in migration `078_ticker_price_freshness_daily_bar_quality.sql` after rewriting `7,713,382` existing `daily_bars` rows to `full_bar`.
  - Migration `078` was revised to use Postgres' fast `ADD COLUMN quality TEXT NOT NULL DEFAULT 'full_bar'` path for fresh deployments, while keeping an idempotent repair branch for environments where the column already exists nullable.
- CI after deploy hardening commit `fa758abe` passed on PR #225: `pr-gate`, `lint`, `build-and-typecheck`, `unit-tests`, `integration-tests`, `deploy-config-validation`, `docker-build-validation`, `e2e-bypass`, and `e2e-oauth`.
- Dev deploy run `27672052644` succeeded for branch `codex/ticker-price-freshness` at commit `fa758abe`: branch validation passed and remote deploy completed in `13m20s`.
- Chrome live validation on Vakwen Dev as `mmckchuang@gmail.com` / `mmc_kchuang` at `2026-06-17 15:34 CST`:
  - Dashboard loaded in `6783ms` and rendered dashboard-only held-market state summary for the live account's held markets: `TW Closed`, `US Closed`, `KR Closed`; no AU holding exists in the live account, so AU was correctly absent from the held-market-only summary.
  - Dashboard and portfolio rendered row-level price-state chips for held tickers including `2330.TW`, `3714.TW`, `000660.KR`, and `AVGO.US`; the live portfolio's unresolved quote state rendered as `Unavailable` where no usable quote existed.
  - Ticker detail `/tickers/2330` loaded in `4341ms` and rendered `ticker-price-state-chip` for `台積電 (2330)`.
  - Reports portfolio tab rendered `Non-current prices 0` and `reports-price-state-*` chips with `Closed` state for `2330.TW`, `AVGO.US`, `000660.KR`, and `3714.TW`.
  - Admin settings `/admin/settings` loaded in `1142ms` and rendered the grouped `Ticker price freshness` surface with close grace, sync cap, intraday interval/tolerance, Yahoo request limit, queue concurrency, cycle cap, refresh endpoint rate limits, Yahoo chart range/interval, intraday toggle, regular-session-only toggle, and supported markets `TW`, `US`, `AU`, `KR`.
  - Dashboard `Refresh closes` action was clicked once; the button re-enabled after `6330ms` and no inline refresh error rendered.
  - Public-share daily-only behavior was validated with an approved temporary public read-only link at `2026-06-17 15:41 CST`; the link was revoked immediately after validation and Sharing returned to `Anonymous links (0)`.
  - The public share page loaded in `5937ms`, rendered a read-only snapshot with `prices as of Jun 17, 2026`, and showed holdings for `000660.KR`, `2330.TW`, `3714.TW`, and `AVGO.US`.
  - The public share page rendered `0` price-state chips, `0` market-state summary elements, `0` refresh-closes buttons, and no open-market polling/freshness words such as `Updated`, `Delayed`, `Previous close`, `Refresh closes`, or `Held markets`.
- Chrome mobile live validation on Vakwen Dev as `mmckchuang@gmail.com` / `mmc_kchuang` at `2026-06-17 16:08 CST`:
  - A user-visible Chrome dashboard tab was resized and verified from inside the page at the iPhone 12 Pro CSS viewport: `window.innerWidth=390`, `window.innerHeight=844`, `devicePixelRatio=2`.
  - Dashboard rendered the held-market state summary for the live account's held markets: `TW Closed`, `US Closed`, `KR Closed`; no AU holding exists in the live account, so AU remained absent from the held-market-only summary.
  - Dashboard rendered `4` dashboard row-level price-state chips: `dashboard-price-state-2330-TW`, `dashboard-price-state-AVGO-US`, `dashboard-price-state-000660-KR`, and `dashboard-price-state-3714-TW`, all with `Closed`.
  - Dashboard `Refresh closes` action was clicked once in the mobile viewport; the button re-enabled after `7095ms`, no inline refresh error rendered, and the dashboard still rendered `4` price-state chips. This was the only mobile post-close refresh click to avoid unnecessary rate-limit pressure.
  - Portfolio `/portfolio` rendered `10` holdings price-state chips in the mobile holdings surface, including group and account-level chips for `000660.KR`, `2330.TW`, `3714.TW`, and `AVGO.US`; the live portfolio route rendered `Unavailable` chip state where no usable route quote was available.
  - Ticker detail `/tickers/2330` loaded in `5676ms` and rendered `ticker-price-state-chip` for `台積電 (2330)`.
  - Reports `/reports` loaded in `2777ms`, rendered `Non-current prices 0`, and rendered `reports-price-state-*` chips with `Closed` for `2330.TW`, `AVGO.US`, `000660.KR`, and `3714.TW`.
  - Mobile price chip tooltip was validated by focusing/clicking `reports-price-state-2330-TW`; the tooltip opened and showed `Price translation`, `Reporting currency is TWD.`, `Reporting price (TWD) NT$2,385.00`, and `Quote status Current`.
  - Admin settings `/admin/settings` rendered the grouped `Ticker price freshness` surface with close grace, sync cap, intraday interval/tolerance, Yahoo request limit, queue concurrency, cycle cap, refresh endpoint rate limits, Yahoo chart range/interval, intraday toggle, regular-session-only toggle, save button, and supported markets `TW`, `US`, `AU`, `KR`.
  - Public-share daily-only behavior was validated with an approved temporary public read-only link created from the mobile sharing UI; the public share page loaded in `4275ms`, rendered `Read-only · expires Jul 17, 2026 · prices as of Jun 17, 2026`, showed holdings for `000660.KR`, `2330.TW`, `3714.TW`, and `AVGO.US`, rendered `0` price-state chips, `0` market-state summary elements, `0` refresh-closes buttons, and no open-market polling/freshness words such as `Updated`, `Delayed`, `Previous close`, `Refresh closes`, or `Held markets`.
  - The temporary public link was revoked immediately after mobile validation; Sharing showed the row as `Revoked`, no revoke button remained for that row, and the tab returned to `Anonymous links (0)`.
- Additional Codex-review fixes after final audit:
  - Admin `Ticker price freshness` save now sends only strict-schema patch fields and excludes read-only/effective fields, `options`, and `bounds`.
  - `POST /portfolio/refresh-closes` is now guarded as a writer/shared-context write route so viewer-role sessions and shared-context grantees cannot consume provider budget or enqueue/write owner refresh work directly.
  - Focused verification passed: `npx vitest run apps/api/test/integration/role-enforcement.integration.test.ts apps/api/test/integration/shared-context-delegated-capabilities.integration.test.ts` (`2` files / `27` tests).
  - Web verification passed via `npm run test --prefix apps/web -- AdminSettingsClient-tabs.test.tsx`; the command ran both web test phases and passed `47` files / `271` tests, then `58` files / `406` tests, including the new admin freshness save-payload regression.
  - Focused ESLint passed for the touched admin settings, route guard, and regression-test files.
  - `npm run typecheck` passed after the review fixes.

## References

- Scope debate note: none.
- Linear tickets: none.
