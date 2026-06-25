# JP Market Support Integration Analysis

Generated: 2026-06-25 (Asia/Taipei workspace context)  
Worktree: `/Users/lume/repos/tw-portfolio/.worktrees/jp-market-support`  
Branch: `codex/jp-market-support`  
Base: `dev` at `2b2e39a07e96bf4d4e425cf6611b069133e16861`

Related spike: `docs/004-notes/jp-market-support/spike-20260625-jp-provider-feasibility.md`

## Locked Scope Update

Locked: 2026-06-25 via scope-grill.  
Implementation todo: `docs/004-notes/jp-market-support/scope-todo-20260625-jp-market-support.md`

This locked scope supersedes the earlier provider recommendation in this analysis. JP v1 uses at most two providers:

| Capability | Locked JP v1 source |
|---|---|
| Catalog | Twelve Data JP reference endpoints |
| Daily bars | Yahoo Finance JP `.T` chart |
| Dividends | Yahoo Finance JP `.T` chart events, basic cash dividends only |
| Intraday/close refresh | Yahoo Finance JP `.T` chart |
| Fundamentals | Existing Yahoo fundamentals path extended with `.T` normalization |
| Search/autocomplete | Persisted JP catalog first; Yahoo search only as best-effort fallback |
| Calendar | Existing admin calendar workflow using JPX Market Holidays |

Out of scope for JP v1: FinMind JP, J-Quants, KR-style mapping repair, multi-session/lunch-break precision, and new JP tax policy. Strict catalog inclusion is the default but is configurable in the JP admin market-data UI.

## Implementation Evidence Snapshot

Worktree state checked: 2026-06-25.

Verified implemented:

- Shared contracts and API/MCP validation now accept `JP` / `JPY`, including JP catalog app-config DTO fields and JP-aware test helpers.
- Migration `092_jp_market_support.sql` widens market/currency checks, adds JP app-config knobs, seeds JP provider-health rows, and seeds default source `official-jp` for market calendars.
- `buildMarketDataRegistry()` now registers `yahoo-finance-jp` for bars/dividends/metadata/search and `twelve-data-jp` for catalog sync.
- `YahooFinanceJpMarketDataProvider` implements bare-symbol persistence plus `.T` boundary normalization for bars, dividends, metadata, and search.
- `TwelveDataJpCatalogProvider` implements the locked strict filters (`JPY`, `JPX`, `XJPX`, symbol regex, allowed stock types) plus admin-relaxed inclusion controls.
- JP is wired through provider health, admin market-data routing, trading calendar support, `Asia/Tokyo` settlement, close refresh, intraday supported markets, FX storage, and account/reporting UI copy.

Proof now present:

- Dedicated JP provider tests exist for `YahooFinanceJpMarketDataProvider` and `TwelveDataJpCatalogProvider`.
- `apps/api/test/unit/jpContracts.test.ts` covers JP shared contracts, classifier behavior, and JPY fee defaults with no built-in JP sell-tax rules.
- `apps/api/test/unit/historyStartFor.test.ts` covers `HISTORY_START_BY_MARKET.JP = "2000-01-04"` and exact five-market coverage.
- `apps/api/test/unit/reportContext.test.ts` covers JP scope/native JPY handling.
- `apps/api/test/http/specs/market-data-search-aaa.http.spec.ts` covers JP catalog-first search before provider fallback.
- `apps/api/test/integration/provider-health.integration.test.ts` covers the JP provider-health seed rows.
- `apps/api/test/integration/kzo183-market-trigger-rejection.integration.test.ts` covers `currency_to_market('JPY') = 'JP'`.
- `apps/api/test/integration/catalogSync.integration.test.ts` covers market-scoped JP catalog persistence/search, backfill candidates, monitored ticker selections, unresolved rows for relaxed-but-unpriceable symbols, provider operations, and `official-jp` calendar source state.
- `apps/api/test/integration/tradingCalendar.integration.test.ts` passed in the full host suite after JP calendar wiring.
- `apps/web/tests/e2e/specs/transaction-form-market-code-aaa.spec.ts` covers JP account creation/selection, JP catalog-backed transaction selection, JPY price currency derivation, and the no-compatible-JPY-account create-account link.
- `apps/web/tests/e2e/specs/monitored-tickers-aaa.spec.ts` covers JP catalog filtering, monitored ticker persistence, and market-scoped backfill badges.
- `apps/web/tests/e2e/specs/instrument-catalog-sector-filter-aaa.spec.ts` covers the JP catalog chip showing JPX rows without sector narrowing.
- `apps/web/tests/e2e/specs-oauth/provider-health-aaa.spec.ts` covers the JP market-data landing tile and JP calendar import UI with the JPX official source URL.
- `apps/web/tests/e2e/specs-oauth/transaction-market-chip-aaa.spec.ts` covers the JP transaction market chip.
- Full local gates passed after the JP changes: lint, typecheck, web unit, API unit/integration, Postgres host integration, bypass E2E, OAuth E2E, and API HTTP.

Residual coverage note:

- Focused JP E2E now covers the requested JP user journeys directly. The full eight-suite gate must be rerun after the latest E2E spec additions before making final PR-readiness claims.
- Rebase check on 2026-06-25: `git fetch origin dev` found `HEAD`, `origin/dev`, and `FETCH_HEAD` identical. Explicit `git rebase origin/dev` reported the branch was already up to date; no rebase conflicts or new scope gaps arose.

## Executive Summary

JP support is a cross-cutting market onboarding, not a provider-only change. The current system has first-class TW, US, AU, and KR support. The closed set is encoded in shared DTO unions, database constraints, market-data provider registries, FX refresh, reporting validation, admin operations, web i18n, Playwright helpers, and evergreen docs.

The codebase-shaped path is to mirror the KR/AU architecture:

1. Add `JP` and `JPY` as strict shared constants.
2. Add a DB migration that widens every market/currency closed-set check.
3. Register JP market-data and catalog providers behind the existing `MarketDataRegistry`.
4. Add JP to FX/reporting, market calendars, intraday/price freshness, provider health/admin operations, and web market selectors.
5. Add focused parity tests for account currency guards, transaction market selection, catalog sync, backfill, reporting scope/currency, admin provider workspace, FX refresh, and E2E market chips.

Provider selection is locked for JP v1 after live probes and scope-grill: use Twelve Data for JP catalog and Yahoo Finance JP for bars/dividends/intraday/fundamentals. J-Quants remains a future official-provider upgrade path, not a v1 dependency.

## Review Scope

Reviewed:

- Repo policy and root `AGENTS.md`.
- Fresh retrieval catalog for this worktree: 2,008 documents, 13,561 chunks, 3,325 edges, session `dba64c17f89a`.
- Current source in `libs/shared-types`, `libs/domain`, `libs/config`, `apps/api`, `apps/web`, `libs/test-e2e`, `libs/test-api`, `db/migrations`.
- Evergreen docs, especially `docs/market-data-platform.md`, `docs/001-architecture/canonical-accounting-model.md`, KR/AU provider notes, provider-fixer notes, market-code selector notes, account currency/type notes, and operations runbooks.
- Current external primary/near-primary provider references:
  - JPX J-Quants API page, updated 2026-05-18.
  - JPX domestic stock trading rules page for current TSE cash-equity sessions.
  - JPX market holidays page for the 2026 holiday calendar.
  - JPX List of TSE-listed Issues page, updated 2026-06-03.
  - Twelve Data Tokyo Stock Exchange (`XJPX`) page.
  - Twelve Data support page for reference-data endpoints.

Retrieval note: the first query containing `hard-coded` hit a local SQLite FTS parser issue (`no such column: coded`). The follow-up query without the hyphen succeeded and returned the KR transition, KR migration, provider registry, account currency, market selector, and canonical accounting docs as the most relevant sources.

## Current Market Model

The current market/currency contract is strict and one-to-one:

| Currency | Market | Status |
|---|---|---|
| `TWD` | `TW` | Current production baseline |
| `USD` | `US` | Current supported market |
| `AUD` | `AU` | Yahoo bars/dividends/search + Twelve Data catalog |
| `KRW` | `KR` | Yahoo bars/dividends/search + Twelve Data catalog |
| `JPY` | `JP` | Not supported yet |

Evidence:

- `libs/shared-types/src/index.ts:487-532` defines `ACCOUNT_DEFAULT_CURRENCIES`, `MARKET_CODES`, `MARKET_CURRENCY_PAIRS`, `REPORT_SCOPES`, and reverse market-to-currency mapping without JP/JPY.
- `apps/api/src/services/market-data/registry.ts:151-258` registers TW, US, AU, and KR providers only.
- `apps/api/src/services/market-data/types.ts:25-30` defines `HISTORY_START_BY_MARKET` for TW, US, AU, and KR only.
- `apps/api/src/services/market-data/fxRefreshWorker.ts:24` stores FX quote currencies as `TWD`, `USD`, `AUD`, and `KRW` only.
- `apps/api/src/services/reportContext.ts:29-41` validates against shared constants but hard-codes the error copy to the current four markets/currencies.

## Market Integration Matrix

| Surface | Current pattern | JP required work | Discovered gap/risk | Primary files |
|---|---|---|---|---|
| Shared market/currency DTOs | `TW/US/AU/KR`, `TWD/USD/AUD/KRW` are strict `as const` unions. | Add `JP`, `JPY`, mappings, report scope, market filter. | Compile-time fallout is expected and useful, but some modules use local literal sets that will not be caught. | `libs/shared-types/src/index.ts` |
| Domain classifier | US curated allow-list, AU/KR provider-type mapping, TW legacy substring fallback. | Add JP branch based on chosen provider type taxonomy. | Need decide ETF/REIT/ETN/warrant filtering and whether JP REIT maps to `STOCK` like KR or needs a type extension later. | `libs/domain/src/classifyInstrument.ts` |
| DB account currency guard | Migration 062 widens `accounts.default_currency` to include KRW and `currency_to_market()` to KR. | New migration adds `JPY` and `JPY -> JP`. | Account/trade currency guard will reject JP trades until DB and shared-types change together. | `db/migrations/062_kr_market_support.sql`; new migration |
| DB market-code constraints | Provider/fixer/fundamentals/freshness constraints use `('TW','US','AU','KR')`. | Widen provider operations, unresolved items, outcomes, incidents, ticker fundamentals, ticker freshness config. | Missed constraints will surface only in Postgres integration/admin flows, not memory unit tests. | `db/migrations/064_*`, `065_*`, `066_*`, `068_*`, `079_ticker_price_freshness_app_config.sql`, `056_kzo201_ticker_fundamentals.sql` |
| Provider registry | FinMind TW/US, Yahoo AU/KR, Twelve Data AU/KR, Frankfurter FX. | Add JP data/catalog provider(s), mocks, provider budgets, boot logs, app-config/env keys. | Provider choice is unresolved; avoid encoding Yahoo-only as production truth without a policy decision. | `apps/api/src/services/market-data/registry.ts`; `libs/config/src/env-schema.ts`; providers folder |
| Provider operation/admin console | Admin workspaces list TW/US/AU/KR/FX with provider IDs and allowed actions. | Add JP workspace, provider IDs, action routing, queue dispatch, health/unresolved/activity/calendar pages. | Many literal checks live inside one large route file; missing JP can 404 admin pages even after provider works. | `apps/api/src/routes/adminRoutes.ts`; `apps/web/app/admin/market-data/...` |
| Catalog sync | AU/KR use Twelve Data bulk catalog providers; provider capability controls absence detection. | Add JP catalog sync and mock fixtures; decide absence-based delisting support. | JPX monthly Excel is useful but not enough for daily delisting freshness; J-Quants may be better if plan supports listed companies as of dates. | `apps/api/src/services/market-data/registerCatalogSyncWorker.ts`; provider classes |
| Daily bars/dividends | Providers normalize their upstream symbol format at boundary and persist bare canonical ticker. | Choose canonical JP ticker form and implement boundary conversion. | JP symbols often appear as four-digit TSE codes in UI/Yahoo (`7203.T`) while J-Quants APIs can use local security codes with an added trailing digit. Store a single canonical form and document it. | Provider classes; `market_data.instruments`; docs |
| History start | Per-market hardcoded provider floor. | Add `HISTORY_START_BY_MARKET.JP` after provider spike. | Wrong floor causes silent pre-history truncation or failed backfills. | `apps/api/src/services/market-data/types.ts` |
| Trading calendar/session | TW/US/AU/KR time zones and close times; regular session currently modeled as a single open-close interval. | Add `Asia/Tokyo`, JP close, latest-settled logic, calendar import/management support. | Tokyo has a lunch break. Current daily-bar settlement can use close time, but intraday "open" state may be too broad unless session breaks are modeled. | `apps/api/src/services/market-data/tradingCalendar.ts`; `marketRegularSession.ts` |
| Intraday price freshness | Defaults derive supported markets from `MARKET_CODES`, but regular-session helpers only accept TW/US/AU/KR. | Add JP regular session support and provider symbol conversion for intraday if enabled. | If using Yahoo intraday, add `.T` resolution; if using J-Quants only, validate minute/intraday availability and plan. | `apps/api/src/services/appConfig/tickerPriceFreshness.ts`; `providers/yahooFinanceIntraday.ts` |
| FX/reporting | Frankfurter stores TWD/USD/AUD/KRW pair matrix; report scopes/currencies are strict. | Add JPY to stored FX quotes and reporting UI/API. | `STORED_QUOTES` is not derived from `ACCOUNT_DEFAULT_CURRENCIES`; JP can be added to one and missed in the other. | `fxRefreshWorker.ts`; `reportContext.ts`; `mcpPortfolioRead.ts`; web display settings |
| Valuation health | Absolute thresholds exist for AUD/USD/TWD/KRW; minor-unit tolerance treats AUD/USD as decimal and others as integer. | Add JPY threshold field or explicitly reuse zero-decimal default. | DTO/app_config/admin UI will need a schema migration if thresholds are user-tunable per currency. | `apps/api/src/services/appConfig/valuationHealth.ts`; `apps/api/src/services/valuationHealth.ts`; shared DTOs |
| Account creation/list UI | Market labels/subtexts and badges have Taiwan, US, Australia, Korea. | Add Japan labels, subtext (`JPY · TSE/JPX`), badges/colors in both locales. | Local switches must be exhaustive after shared type addition, but i18n type fields must be added first. | `apps/web/features/settings/i18n.ts`; account components; `apps/web/lib/i18n/types.ts` |
| Instrument browser | Chips are `All/TW/US/AU/KR`; sector filter only TW/US/AU; live search AU/KR only. | Add JP chip; decide sector filter and live-search support. | JPX/J-Quants sector taxonomy must be mapped to the app's existing GICS-like UI or hidden for v1 like KR. | `InstrumentCatalogSheet.tsx`; settings i18n/tests |
| Transaction selector | Market chips derive from app state but test helpers lag behind. | Add JP to UI and test Page Objects. | `libs/test-e2e` still types transaction chips as `TW | US | AU | ALL`, missing KR already; JP work should fix this drift centrally. | `libs/test-e2e/src/pages/shared/TransactionFormComponent.ts` |
| MCP/API read tools | Shared constants validate markets, but error copy hard-codes currencies. | Include JPY in validation copy and any schema docs. | ChatGPT/MCP users can receive stale error messages after JP support unless copied strings are updated. | `apps/api/src/services/mcpPortfolioRead.ts`; API docs |
| Evergreen docs/runbooks | `docs/market-data-platform.md` documents AU/KR strategies and four FX currencies. | Add JP strategy and update FX/provider/admin docs. | Operations runbook already appears stale in one FX call-count section; use code as source of truth when updating docs. | `docs/market-data-platform.md`; `docs/002-operations/runbook.md`; env docs |

## Provider Decision Matrix

| Candidate | Fit for JP v1 | Advantages | Gaps/risks | Recommendation |
|---|---|---|---|---|
| J-Quants API | Strong production candidate | Official JPX/J-Quants channel. JPX documents historical OHLC, adjusted/unadjusted prices, listed-company data, dividends, financial information, and earnings schedules. This matches the app's bars/catalog/dividend needs better than an unofficial screen-scrape path. | Requires auth/key management, pricing/plan selection, API contract spike, rate-limit modeling, and likely symbol normalization between TSE display codes and provider security codes. Need verify cash dividend fields, delisting/listing history semantics, and plan entitlements. | Preferred production path after a short spike. Add app_config/env encrypted key support if selected. |
| Twelve Data catalog + Yahoo `.T` bars | Fastest KR-style prototype | Similar to existing AU/KR split-provider architecture. Twelve Data lists Tokyo Exchange (`XJPX`) and reference endpoints; Yahoo `.T` likely mirrors existing Yahoo AU/KR implementation pattern. | Twelve Data XJPX page marks JP access as paid tiers, so free-tier parity is unproven. Yahoo is unofficial and the codebase already treats Yahoo as a provider with commercial/coverage caveats. Dividends/splits/corporate actions may be incomplete. | Acceptable only for a prototype or behind explicit product/ToS acceptance. Do not make it the default production recommendation without approval. |
| Paid commercial provider such as EODHD/Refinitiv/etc. | Strong if tax/corporate-action fidelity matters | Can provide commercial terms and richer corporate-action coverage depending plan. | Cost, integration time, and vendor selection not yet scoped. | Keep as fallback if J-Quants plan limits or redistribution terms do not fit. |
| JPX monthly Listed Issues Excel only | Useful supplement | Official TSE listed issues file is updated monthly and can validate catalog names/sections. | Monthly cadence is insufficient for fresh daily catalog sync, delisting detection, and per-symbol metadata refresh by itself. JPX warns completeness is not guaranteed. | Use as secondary evidence or fallback, not the only catalog provider. |

External facts checked:

- JPX J-Quants page updated 2026-05-18 says J-Quants distributes historical stock prices and corporate financial information by API, and lists OHLC, listed companies, dividends, and earnings schedule datasets.
- JPX domestic stock trading rules define TSE auction trading as two sessions: 09:00-11:30 and 12:30-15:30.
- JPX market holidays page publishes the exchange holiday calendar, including 2026 New Year market holidays and Japanese national holidays.
- JPX TSE-listed issues page updated 2026-06-03 says the prior month-end list is available and updated around 9:00 a.m. on the third business day each month.
- Twelve Data `XJPX` page lists Tokyo Stock Exchange, MIC `XJPX`, timezone `Asia/Tokyo`, and trading hours including `09:00 - 11:30, 12:30 - 15:30 (JST)`.
- Twelve Data support says `/stocks` and `/etf` reference data endpoints can be filtered by exchange/country/type and are updated daily.

## Database Migration Matrix

| DB object | Current JP blocker | Required migration action | Notes |
|---|---|---|---|
| `public.accounts.default_currency` check | Allows `TWD`, `USD`, `AUD`, `KRW`. | Drop/recreate check with `JPY`. | Follow pattern in `062_kr_market_support.sql`. |
| `currency_to_market(currency TEXT)` | Maps TWD/US/AUD/KRW only. | Add `IF currency = 'JPY' THEN RETURN 'JP'; END IF;`. | This drives account-scoped fee/trade guards. |
| `market_data.ticker_fundamentals.market_code` | Recreated by KR migration as TW/US/AU/KR. | Recreate constraint with JP. | Needed if JP provider supplies fundamentals or metadata enrichment. |
| `market_data.provider_operations.market_code` | Check is TW/US/AU/KR. | Recreate constraint with JP. | Admin operations will fail inserts without this. |
| `market_data.provider_resolution_mappings.market_code` | Check is TW/US/AU/KR. | Recreate constraint with JP if JP has provider-specific symbol mappings. | Needed for Yahoo `.T` or J-Quants 4-digit/5-digit code mapping. |
| `market_data.provider_unresolved_items.market_code` | Check is TW/US/AU/KR. | Recreate constraint with JP. | Provider-fixer/unresolved rows need JP. |
| `market_data.provider_operation_outcomes.market_code` | Check is TW/US/AU/KR. | Recreate constraint with JP. | Required for durable operation summaries. |
| `market_data.provider_incidents.market_code` | Nullable check is TW/US/AU/KR. | Recreate nullable check with JP. | Required for health incidents and backfill aggregation. |
| Provider incident backfill case logic | Recognizes TW/US/AU/KR and provider suffixes. | Add JP provider ID inference if backfilling old trails. | Optional if no historical JP provider trails exist at rollout. |
| `public.app_config.ticker_price_supported_markets` | Array subset check is `['TW','US','AU','KR']`. | Recreate array subset check with JP. | Intraday/close refresh admin config depends on this. |
| `app_config` provider key/rate-limit fields | FinMind/Twelve/Yahoo AU/Yahoo KR/Frankfurter only. | Add fields only if selected JP provider needs keys/rate caps. | J-Quants likely needs encrypted API credential fields parallel to FinMind/Twelve. |
| Valuation thresholds | Shared/app_config DTO has absolute AUD/USD/TWD/KRW only. | Add `absoluteJpy` or document using integer fallback. | Prefer explicit field if admin UI exposes thresholds per currency. |

## Code And UI Gaps

### High Priority

- Shared constants do not include `JP`/`JPY`: `libs/shared-types/src/index.ts:487-532`.
- DB closed-set checks will reject JP in Postgres even if TypeScript compiles.
- Provider registry has no JP provider and no JP mocks: `apps/api/src/services/market-data/registry.ts:151-258`.
- `HISTORY_START_BY_MARKET` has no JP provider floor: `apps/api/src/services/market-data/types.ts:25-30`.
- `STORED_QUOTES` omits JPY and is not derived from the shared currency list: `apps/api/src/services/market-data/fxRefreshWorker.ts:24`.
- Report/MCP validation error strings still enumerate only the current four currencies/markets.
- Admin market-data routes and Next admin pages whitelist TW/US/AU/KR/FX, not JP.
- Trading calendar/session support is hardcoded to TW/US/AU/KR.

### Medium Priority

- Account UI switches and i18n dictionaries need Japan labels/subtexts/badges.
- Instrument catalog sheet needs a JP chip and a sector/live-search decision.
- Price freshness defaults derive from `MARKET_CODES`, but regular-session helpers and Yahoo intraday symbol resolution are still four-market-specific.
- Valuation health thresholds need an explicit JP stance.
- Provider operation action names and labels are KR/AU-specific in several places.
- Docs should get a JP provider strategy section like AU/KR.

### Test And Fixture Drift

- `libs/test-e2e/src/pages/shared/TransactionFormComponent.ts:12-13` only types market chips as `TW | US | AU | ALL`, so the helper is already stale for KR. JP work should fix this by importing `MarketCode` or by centralizing the supported test-market type.
- E2E env config currently has AU/KR provider mocks only. Add JP provider/catalog mock flags if JP has provider mocks.
- OAuth and API test helpers define literal market/currency unions in places. These should be audited with `rg '"TW" \\| "US" \\| "AU"'` and `rg 'TWD.*USD.*AUD'`.
- "Full tests pass" in this repo requires all eight suites from root `AGENTS.md`; JP rollout should at minimum include the Postgres integration suite because DB constraints are central.

## Proposed JP Architecture

### Canonical Market Contract

- Market code: `JP`.
- Default/reporting currency: `JPY`.
- Canonical stored ticker: use the user-facing TSE code, probably four digits such as `7203`, unless the provider spike proves this loses required uniqueness.
- Provider-specific symbol mapping: keep at the provider boundary. Examples:
  - Yahoo route would serialize `7203` to `7203.T`.
  - J-Quants route may map display code `7203` to provider local code if the API requires a five-character security code.

This matches the KR precedent: app boundaries store bare KRX codes, and providers resolve `.KS/.KQ` internally.

### Provider Shape

Preferred shape if J-Quants is selected:

- `JQuantsMarketDataProvider` implements daily bars, dividends, metadata/search if supported.
- `JQuantsCatalogProvider` may be the same instance if list-of-listed-companies coverage is sufficient.
- `MockJQuantsMarketDataProvider` and/or `MockJQuantsCatalogProvider` for memory/E2E.
- Env/app_config:
  - `JQUANTS_API_KEY` or the provider's actual credential fields after spike.
  - `JQUANTS_BASE_URL`.
  - `JQUANTS_RATE_LIMIT_PER_MINUTE` or per-day/per-hour as documented.
  - `JP_PROVIDER_MOCK`, and `JP_CATALOG_PROVIDER_MOCK` only if split.
- Provider IDs:
  - `j-quants-jp` for data/catalog if single provider.
  - If split, use explicit IDs such as `j-quants-jp` and `jpx-listed-issues-jp` or `twelve-data-jp`.

Alternative prototype shape:

- `TwelveDataJpCatalogProvider` for catalog, if plan permits XJPX reference data.
- `YahooFinanceJpMarketDataProvider` for `.T` bars/dividends/search.
- Same rate limiter and provider mapping patterns as AU/KR, but document ToS and quality caveats in `docs/market-data-platform.md`.

### Market Calendar

Calendar support has four separate surfaces in the current system:

| Surface | Current implementation | JP requirement | Risk if missed |
|---|---|---|---|
| Historical trading-day cache | `TradingCalendarCache` loads distinct daily-bar dates per market and falls back to weekdays when no recent bars exist. | Add `JP` to supported market sets and ensure JP bars populate enough dates for bootstrap. | Latest-settled date and stale-price calculations may fall back to weekdays and ignore JP holidays. |
| Official calendar management | Admin calendar routes and persistence support active market-calendar versions, but route params only allow TW/US/AU/KR. | Add JP route allowance, import/activate flows, activity summaries, and tests. | Operators cannot load or correct JP holidays even if the provider works. |
| Settlement close | `MARKET_CLOSE_LOCAL_TIME` is single close per market. | Add `Asia/Tokyo` and close `15:30` JST for daily-bar settlement. | Daily JP positions can look stale/current at the wrong local boundary. |
| Intraday open state | `marketRegularSession` models each market as one continuous interval. | JP cash equities need two intervals: 09:00-11:30 and 12:30-15:30 JST. | If JP intraday is enabled without interval support, the app will show JP as open during lunch. |

Implementation notes:

- Add `JP` to `SUPPORTED_MARKETS`, `MARKET_TIMEZONE`, and `MARKET_CLOSE_LOCAL_TIME` in `apps/api/src/services/market-data/tradingCalendar.ts`.
- Add `JP` to `RegularSessionMarketCode`, `REGULAR_SESSION_MARKETS`, and local open/close handling in `apps/api/src/services/market-data/marketRegularSession.ts`.
- For daily bars/reporting, single close time at 15:30 JST is enough for v1 settlement.
- For intraday state, prefer extending `marketRegularSession` from one open/close pair to an array of local intervals before enabling JP in the intraday-refresh supported-market default.
- Add JP to admin calendar route enums in `apps/api/src/routes/adminRoutes.ts` around the market-calendar endpoints and to the Next admin allowlists under `apps/web/app/admin/market-data`.
- Seed/import JPX official holidays rather than relying only on derived bar dates. At minimum, the JP calendar import fixture should cover New Year market holidays, observed Japanese national holidays, and weekday closures from JPX's published holiday page.
- Document the difference between domestic cash-equity hours and derivatives holiday trading. JP support here should target TSE domestic stocks, not JPX derivatives holiday sessions.

## Implementation Plan

### Phase 0 - Provider Spike

- Verify J-Quants auth flow, base URL, pricing/plan, rate limits, and commercial terms.
- Fetch sample JP instruments, bars, dividends, and listing history for known tickers such as Toyota (`7203`) and an ETF.
- Confirm symbol-code policy: four-digit display code vs provider code.
- Confirm adjusted/unadjusted close choice. Existing TW/US docs emphasize unadjusted close parity, but J-Quants also advertises adjusted data.
- Confirm provider floor for `HISTORY_START_BY_MARKET.JP`.
- Confirm dividend fields map to existing `DividendRecord` without losing important dates.
- Confirm whether listed-company data supports absence/delisting detection.
- Confirm sector taxonomy and whether to expose a sector filter in v1.

### Phase 1 - Contracts And Schema

- Add `JPY` to `ACCOUNT_DEFAULT_CURRENCIES`.
- Add `JP` to `MARKET_CODES`, `MARKET_FILTER_CODES`, `REPORT_SCOPES`, `MARKET_CURRENCY_PAIRS`, and `MARKET_TO_CURRENCY`.
- Add shared DTO fields for valuation health threshold if needed.
- Add DB migration widening all market/currency constraints in the migration matrix.
- Update memory persistence validators if any local literal checks exist.

### Phase 2 - Providers And Workers

- Add JP provider classes and mocks.
- Add JP env schema and app_config/provider-key support if the provider needs credentials.
- Register JP in `buildMarketDataRegistry()`.
- Add JP to catalog sync routing, backfill dispatch, provider health, provider operation capabilities, unresolved rows, and incident classification.
- Add `HISTORY_START_BY_MARKET.JP`.
- Add JP to trading calendar, regular session, and intraday symbol resolution if intraday is enabled.

### Phase 3 - Reporting, FX, And Valuation

- Add JPY to `STORED_QUOTES` and update tests for FX pair persistence.
- Update report/MCP error copy and API schemas.
- Add JP report scope and JPY reporting currency tests.
- Add valuation thresholds/tolerances for JPY.
- Verify Frankfurter supports JPY in the configured v2 route and that forward-fill `getFxRate()` works for all JPY pairs.

### Phase 4 - Web UX

- Add Japan market labels/subtexts/badges to settings i18n and type definitions.
- Add JP option in account creation, account list badges, display reporting currency, portfolio/report market chips, and instrument catalog.
- Add JP instrument browser behavior:
  - show sector filter only if provider taxonomy maps cleanly,
  - enable live search only if the selected provider supports it.
- Add admin market-data JP route support in Next pages and API route data.

### Phase 5 - Tests

- Unit: shared currency/market helpers, classifier, provider symbol normalization, report context, FX stored quotes.
- API memory: create JPY account, reject cross-currency trades, create JP trade, monitored ticker save, backfill enqueue.
- API Postgres integration: migration constraints, `currency_to_market`, provider operation/unresolved/incidents inserts, ticker freshness app_config `JP`.
- HTTP/admin: JP market-data workspace, provider health, catalog sync/backfill operations, calendar routes.
- Web unit: account form, instrument catalog chip/live-search/sector behavior, display reporting currency.
- E2E: JP account creation, JP transaction selection, JP monitored ticker catalog browse, admin JP tile.

### Phase 6 - Docs And Operations

- Add JP provider strategy to `docs/market-data-platform.md`.
- Update `docs/002-operations/environment-variables.md` with JP provider envs.
- Update runbook FX call counts and provider admin workflows.
- Add a JP rollout note with provider limitations, history floor, symbol contract, and acceptance criteria.

## Acceptance Criteria For "JP Parity"

JP should not be called integrated until all of these are true:

- A user can create a JPY account and it maps to market `JP`.
- A user can search/select JP instruments using canonical JP tickers.
- JP transactions book with price currency JPY and reject non-JPY accounts.
- JP monitored tickers trigger catalog/bar/dividend backfill through provider-specific jobs.
- Dashboard, holdings, ticker detail, reports, and realized PnL render JP positions.
- Report scope `JP` and reporting currency `JPY` work with FX status.
- FX refresh stores JPY pairs for all supported reporting currencies.
- Admin market-data console has a JP tile, provider health, operations, unresolved rows, instruments, backfill, activity, and calendar management where applicable.
- Provider mocks let memory/E2E suites run without external JP network calls.
- Postgres migrations support JP in all closed-set market/currency constraints.
- Evergreen docs document provider choice, limitations, symbol contract, rate limits, and operational runbooks.

## Recommended Ticket Breakdown

| Ticket | Scope | Notes |
|---|---|---|
| JP-0 Provider spike | J-Quants/Twelve/Yahoo feasibility, symbol contract, history floor, dividend/catalog coverage, legal/commercial notes. | This must precede implementation. |
| JP-1 Contracts/schema | Shared types and DB migration. | Include Postgres integration tests. |
| JP-2 Provider implementation | Provider(s), mocks, registry, app_config/env, catalog/backfill workers. | Keep symbol normalization at provider boundary. |
| JP-3 Calendar/freshness/FX | Trading calendar/session, intraday if selected, JPY FX/reporting, valuation threshold. | Verify lunch break decision. |
| JP-4 API/admin ops | Admin workspaces, provider operations, unresolved/incident support, MCP copy. | Large `adminRoutes.ts` requires careful literal audit. |
| JP-5 Web UX | Account settings, instrument catalog, transaction selector, display/reporting currency, admin route pages. | Update EN and zh-TW dictionaries. |
| JP-6 Test hardening/docs | E2E/helpers, HTTP tests, docs/runbooks. | Fix existing KR drift in test helpers while touching market unions. |

## Open Questions

1. Which provider is acceptable for production JP support: J-Quants, a paid commercial vendor, or Yahoo/Twelve Data with explicit limitations?
2. What exact canonical ticker should the app store for JP: four-digit display code, five-character J-Quants local code, or another provider-independent identifier?
3. Should JP v1 support ETFs and REITs as stock-like instruments, or does the product need an instrument type beyond `STOCK | ETF | BOND_ETF`?
4. Should JP sector browsing use JPX/J-Quants sector categories, map them to the existing GICS display model, or hide sector filtering in v1?
5. Is intraday JP price freshness required at launch, or can v1 be daily close only?
6. Are JP dividends enough as cash-dividend events, or does JP tax reporting require withholding/source-line automation in v1?
7. Should valuation health thresholds get explicit `absoluteJpy`, or is the current zero-decimal fallback sufficient?

## Verified Facts Vs Inference

Verified from local code:

- The app's strict market set is currently TW/US/AU/KR.
- The current currency set is TWD/USD/AUD/KRW.
- FX refresh stores only those four currencies.
- DB migrations contain multiple TW/US/AU/KR closed-set constraints.
- Admin and web routes have literal market-code allowlists.
- Trading calendar/session helpers are four-market only.
- The E2E transaction helper is stale and excludes KR already.

Verified from external sources:

- JPX documents J-Quants API data categories including OHLC prices, listed-company data, dividends, financials, and earnings schedules.
- JPX publishes a TSE-listed issues file monthly.
- Twelve Data lists Tokyo Stock Exchange as `XJPX`, timezone `Asia/Tokyo`, with main trading hours and a lunch break in detailed hours.
- Twelve Data reference endpoints can list/filter stock and ETF symbols.

Inferences requiring provider spike:

- J-Quants is the best production fit, but credentials, plan limits, exact endpoint shapes, and symbol mapping must be tested.
- Yahoo `.T` can likely mirror AU/KR provider shape, but coverage and legal/commercial suitability are not proven.
- JP can likely follow KR's bare-ticker internal storage pattern, but the four-digit/five-character code decision must be locked before migration/test fixtures proliferate.

## Source Index

Local source anchors:

- `libs/shared-types/src/index.ts:487-532`
- `libs/domain/src/classifyInstrument.ts:51-94`
- `libs/config/src/env-schema.ts:74-115`
- `apps/api/src/services/market-data/registry.ts:86-274`
- `apps/api/src/services/market-data/types.ts:25-30`
- `apps/api/src/services/market-data/fxRefreshWorker.ts:24`
- `apps/api/src/services/reportContext.ts:27-41`
- `apps/api/src/services/market-data/tradingCalendar.ts:12-47`
- `apps/api/src/services/market-data/marketRegularSession.ts:4-48`
- `apps/api/src/routes/adminRoutes.ts:1121-1158`, `1217`, `1305-1333`, `8036`, `8780-9112`
- `apps/web/app/admin/market-data/[marketCode]/page.tsx:8`
- `apps/web/app/admin/market-data/[marketCode]/[tab]/page.tsx:81-93`
- `apps/web/features/settings/i18n.ts:72-90`, `199-204`
- `apps/web/features/settings/components/InstrumentCatalogSheet.tsx:20-37`, `173-232`
- `apps/web/features/settings/components/AccountCreateForm.tsx:178-195`
- `apps/web/features/settings/components/AccountsListSection.tsx:123-141`
- `libs/test-e2e/src/pages/shared/TransactionFormComponent.ts:12-13`
- `docs/market-data-platform.md:61-133`, `155-161`, `226-230`

External sources:

- JPX J-Quants API: https://www.jpx.co.jp/english/markets/other-data-services/j-quants-api/index.html
- JPX Trading Rules of Domestic Stocks: https://www.jpx.co.jp/english/equities/trading/domestic/01.html
- JPX Market Holidays: https://www.jpx.co.jp/english/corporate/about-jpx/calendar/
- JPX List of TSE-listed Issues: https://www.jpx.co.jp/english/markets/statistics-equities/misc/01.html
- Twelve Data Tokyo Stock Exchange (`XJPX`): https://twelvedata.com/exchanges/XJPX
- Twelve Data reference data support: https://support.twelvedata.com/en/articles/5620513-how-to-find-all-available-symbols-at-twelve-data
