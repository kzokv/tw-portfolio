---
slug: jp-market-support
source: scope-grill
created: 2026-06-25
tickets: []
required_reading:
  - docs/004-notes/jp-market-support/analysis-20260625-jp-market-support.md
  - docs/004-notes/jp-market-support/spike-20260625-jp-provider-feasibility.md
superseded_by: null
---

# Todo: JP Market Support

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. This todo is the locked scope; it supersedes earlier provider recommendations inside the spike.

## Locked Scope

- JP v1 mirrors current market behavior for Japan without adding extra product features.
- JP v1 uses two providers maximum: Twelve Data for JPX catalog, Yahoo Finance JP for bars, dividends, intraday, close refresh, metadata/search fallback, and fundamentals.
- FinMind JP and J-Quants are out of JP v1. FinMind is rejected because its JP catalog is stale; J-Quants stays a future official-provider upgrade path.
- Canonical JP ticker is the bare JPX/TSE symbol, such as `7203`, `130A`, `1306`, or `133A`. Provider code appends `.T` for Yahoo.
- Strict catalog inclusion is the default and is configurable in the admin JP market-data UI.
- Strict inclusion means `currency=JPY`, `exchange=JPX`, `mic_code=XJPX`, symbol matches `^[0-9A-Z]+$`, stock types are `Common Stock`, `Preferred Stock`, or `REIT`, and ETF endpoint rows pass the same currency/exchange/MIC/symbol rules.
- Strict exclusion means symbols containing `@`, `Depositary Receipt`, unknown/unsupported stock types, and non-JPX/non-JPY rows.
- Relaxed catalog config controls catalog import eligibility only; it does not promise Yahoo priceability. Normal unresolved/backfill failure surfaces handle rows Yahoo cannot price.
- JP v1 does not add KR-style provider mapping repair.
- JP calendar uses the existing admin calendar import/preview/confirm workflow with JPX Market Holidays as the default official source.
- JP regular-session modeling mirrors the existing single-session app behavior: `Asia/Tokyo`, open `09:00`, close `15:30`, latest-settled/daily freshness at close. Lunch-break precision is deferred because multi-session support would be a new feature.
- JP fee support adds `JPY` account/commission-currency support, with no built-in JP sell-tax rules. Existing configurable fee-tax rules remain available.
- JP instrument search/autocomplete is catalog-first. Yahoo JP search is not the source of truth because chart probes showed valid JPX symbols can be priceable while Yahoo search misses them.
- JP history floor is `2000-01-04` for market-level backfill truncation; per-ticker listing dates remain provider-native.

## Implementation Steps

- [x] Add `JP` and `JPY` to shared market/currency contracts in `libs/shared-types`, including report scopes, market filters, currency/market mapping helpers, and DTO schemas.
- [x] Add a Postgres migration widening all market/currency checks for `JP`/`JPY`, including `accounts.default_currency`, `currency_to_market`, provider operations, unresolved items, outcomes, incidents, ticker fundamentals, ticker freshness config, and market-calendar activity.
- [x] Add `JPY` to FX quote storage, report validation, MCP validation, display settings, and all market/currency error copy.
- [x] Add JP domain classification: ETF endpoint rows map to `ETF`; `Common Stock`, `Preferred Stock`, and `REIT` map to `STOCK`; unsupported JP rows stay filtered unless admin config allows catalog import.
- [x] Add JP fee-profile/account support with `JPY` commission currency and zero default JP sell-tax rules.
- [x] Implement `TwelveDataJpCatalogProvider` and mock provider using `/stocks?country=Japan` and `/etf?country=Japan`, strict default filters, endpoint deduplication, catalog raw fields, absence detection support, and admin-configurable inclusion settings.
- [x] Implement a JP catalog-inclusion app/admin config surface with UI controls for allowed stock types, Depositary Receipt inclusion, and `@` symbol inclusion. Keep JPX/JPY/XJPX matching non-negotiable.
- [x] Implement Yahoo JP market-data provider and mock provider for daily bars, cash dividends, metadata, and search fallback. Normalize `bare -> .T` at provider boundaries and persist bare symbols.
- [x] Add Yahoo JP support to intraday overlays, close-only refresh, and fundamentals by normalizing `${ticker}.T`.
- [x] Set `HISTORY_START_BY_MARKET.JP = "2000-01-04"` and document the probe evidence.
- [x] Register JP providers in `buildMarketDataRegistry`, including provider IDs `twelve-data-jp` and `yahoo-finance-jp`, real/mock branch logging, shared Twelve Data limiter use, and Yahoo JP rate-limit config as needed.
- [x] Add provider-health calendar mapping for `twelve-data-jp` and `yahoo-finance-jp`.
- [x] Add JP to official market-calendar support with default source URL `https://www.jpx.co.jp/english/corporate/about-jpx/calendar/`.
- [x] Add JP to `TradingCalendarCache`, regular-session helpers, close-refresh services, intraday runtime supported markets, quote snapshot/session logic, and admin calendar routes.
- [x] Add JP admin market-data workspace support: overview, providers, activity, calendar, unresolved, catalog sync, backfill, purge, valuation repair, and provider re-run actions as applicable. Do not add JP mapping-repair UI.
- [x] Make JP instrument selection/search catalog-first in the portfolio combobox and command palette, and avoid gating JP discoverability on Yahoo search.
- [x] Add JP account creation/listing UI labels, badges, i18n copy, market chips, report filters, instrument catalog filters, and settings/default-currency controls in both locales.
- [x] Update API/MCP/test helper market unions that currently lag behind `MARKET_CODES`, including E2E transaction market-chip helpers.
- [x] Add memory/Postgres fixtures for JP accounts, JP catalog rows, Yahoo `.T` bars/dividends, JP calendar imports, and provider activity.
- [x] Add focused unit tests for JP shared mappings, classifier behavior, catalog strict/default filters, relaxed filter config, Yahoo `.T` normalization, history floor, calendar/session handling, fee defaults, and provider health mapping.
- [x] Add integration coverage for JP DB constraints, catalog sync, backfill, monitored ticker selection, FX/reporting, admin calendar import, admin provider workspace, and unresolved/backfill failure behavior for relaxed-but-unpriceable rows.
- [x] Run `/aaa` to add or update E2E tests covering JP account creation/selection, JP market chips, JP instrument search, JP monitored ticker/backfill flow, JP admin market-data workspace, and JP calendar UI.
- [x] Update evergreen docs and operations runbooks: `docs/market-data-platform.md`, provider/admin-market-data docs, FX/reporting notes, and this JP support analysis.

## Implementation Evidence Snapshot

Snapshot date: 2026-06-25. Updated after fetch/rebase verification against `origin/dev`.

Verified in code:

- Shared contracts include `JP` / `JPY`, JP report scope handling, JP catalog config DTO fields, and JP test-helper market unions in `libs/shared-types/src/index.ts`, `apps/api/src/services/reportContext.ts`, `apps/api/src/services/mcpPortfolioRead.ts`, and `libs/test-e2e/src/pages/shared/TransactionFormComponent.ts`.
- Postgres migration `db/migrations/092_jp_market_support.sql` widens account/report/provider/calendar checks for `JP` / `JPY`, adds JP app-config columns, seeds JP provider-health rows, and seeds default calendar source `official-jp` pointing at JPX Market Holidays.
- JP provider registry is implemented in `apps/api/src/services/market-data/registry.ts`: Yahoo Finance JP owns bars/dividends/metadata/search and Twelve Data JP owns catalog sync.
- Twelve Data JP strict catalog filtering and admin-relaxed inclusion knobs are implemented in `apps/api/src/services/market-data/providers/twelveDataJp.ts` and `apps/api/src/services/appConfig/jpCatalog.ts`.
- Yahoo JP `.T` normalization, daily bars, cash dividends, metadata, and search fallback are implemented in `apps/api/src/services/market-data/providers/yahooFinanceJp.ts`.
- JP history floor and market-calendar/session support are implemented in `apps/api/src/services/market-data/types.ts`, `apps/api/src/services/market-data/tradingCalendar.ts`, `apps/api/src/services/market-data/marketRegularSession.ts`, and `apps/api/src/services/market-data/marketCalendarService.ts`.
- JP provider-health/admin workspace routing is implemented in `apps/api/src/services/market-data/providerHealth.ts`, `apps/api/src/services/market-data/providerOperationCapabilities.ts`, `apps/api/src/routes/adminRoutes.ts`, `apps/web/app/admin/market-data/[marketCode]/page.tsx`, and `apps/web/app/admin/market-data/[marketCode]/[tab]/page.tsx`.
- JPY/JP account and reporting surfaces are implemented in `apps/api/src/services/market-data/fxRefreshWorker.ts`, `apps/web/features/settings/components/AccountCreateForm.tsx`, `apps/web/features/settings/components/AccountsListSection.tsx`, and `apps/web/features/portfolio/holdingGroups.ts`.
- JP `/market-data/search` is catalog-first for persisted JP rows, with Yahoo search retained only as provider fallback when the catalog has no match.
- Focused JP unit coverage now covers shared mappings, classifier behavior, strict and relaxed Twelve Data catalog filters, Yahoo `.T` normalization, history floor, report context, regular-session/trading-calendar behavior, provider health mapping, registry wiring, and the no-built-in-JP-sell-tax fee default.
- Postgres integration coverage now proves the widened provider-health seed rows, `JPY -> JP` `currency_to_market` trigger path, market-scoped JP catalog persistence/search, JP backfill candidates, JP monitored ticker selection, JP unresolved rows for relaxed-but-unpriceable symbols, JP provider operations, and `official-jp` calendar source state.
- API/HTTP coverage includes JP catalog-first `/market-data/search` before provider fallback.
- Mockup screenshots are present in `docs/004-notes/jp-market-support/mockups/`: JP admin market-data overview, JP admin calendar import, and JP transaction catalog search mobile.
- Dedicated E2E coverage now includes JP account creation/selection, JP no-compatible-account account-create link, JP transaction market chip, JP catalog search/filtering, JP monitored ticker/backfill badges, JP market-data landing tile, and JP admin calendar import surface with the JPX source URL.

Verified locally:

- `git fetch origin dev` followed by `git rebase origin/dev` — branch already up to date; no rebase conflicts and no new scope gaps introduced.
- `npx eslint .`
- `npm run typecheck`
- `npm run test --prefix apps/web` — 61 files / 375 tests passed, then 63 files / 433 tests passed.
- `npm run test --prefix apps/api` — 180 files passed, 44 skipped; 1784 tests passed, 431 skipped.
- `npm run test:integration:full:host` — 92 files passed; 908 tests passed, 1 skipped.
- `npm run test:e2e:bypass:mem --prefix apps/web` — 296 passed, 16 skipped.
- `npm run test:e2e:oauth:mem --prefix apps/web` — 120 passed.
- `npm run test:http --prefix apps/api` — 297 passed, 2 skipped.
- Focused JP/search checks: `npm run test:http --prefix apps/api -- test/http/specs/market-data-search-aaa.http.spec.ts` passed, including JP catalog-first search.
- Latest focused JP E2E additions:
  - `npm run test:e2e:bypass:mem --prefix apps/web -- tests/e2e/specs/transaction-form-market-code-aaa.spec.ts tests/e2e/specs/monitored-tickers-aaa.spec.ts` — 14 passed, including JP transaction/account and JP monitored ticker/backfill flows.
  - `npm run test:e2e:oauth:mem --prefix apps/web -- tests/e2e/specs-oauth/provider-health-aaa.spec.ts` — 5 passed, including JP admin market-data landing and JP calendar import UI.

Validation issues found and fixed:

- `catalogSync.integration.test.ts` initially violated `user_monitored_tickers_user_id_fkey` by writing monitored selections for `user-1` before creating/loading that user. Fixed by creating the user via `loadStore("user-1")`; the full host integration rerun passed.
- A parallel focused E2E attempt hit Next's build lock (`Another next build process is already running`). Reran the affected specs serially.
- The new JP calendar E2E initially used `page.getByDisplayValue`, which is unavailable in this Playwright version. Fixed by asserting `#calendar-source-url` with `toHaveValue`; rerun passed.
- The JP calendar E2E then hit the repo AAA lint guard for raw `expect()` in spec files. Fixed by routing the source-url assertion through `appShell.assert.mxAssertEqual`.

Latest lint/unit verification after the final E2E assertion fix:

- `npx eslint .` — passed.
- `npm run test --prefix apps/web` — first Vitest pass 61 files / 375 tests passed; second pass 63 files / 433 tests passed.
- `npm run test --prefix apps/api` — 180 files passed, 44 skipped; 1784 tests passed, 432 skipped.

Scope gaps after rebase:

- None introduced by rebase. `HEAD`, `origin/dev`, and `FETCH_HEAD` were identical after fetch, and the explicit rebase reported the branch was up to date.
- Residual coverage note: latest focused JP E2E now covers the requested JP user journeys directly. The full E2E suites must still be rerun after these latest spec additions before claiming the final all-eight-suite pass again.

## Open Items

- None. Any future J-Quants migration, FinMind fallback, multi-session/lunch-break precision, or JP provider mapping repair is explicitly outside JP v1.

## References

- Analysis report: `docs/004-notes/jp-market-support/analysis-20260625-jp-market-support.md`
- Provider spike: `docs/004-notes/jp-market-support/spike-20260625-jp-provider-feasibility.md`
- Worktree: `/Users/lume/repos/tw-portfolio/.worktrees/jp-market-support`
