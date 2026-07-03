---
slug: unrealized-pnl-ux
source: scope-grill
created: 2026-07-02
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Unrealized P&L UX Validated Followups

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Decisions

- Manual legend clicks dim/un-dim lines locally in both top drivers and manual tickers modes.
- Manual legend clicks do not change `tickerIds`, URL params, saved preferences, or trigger a refetch.
- Muted tickers remain visible in selected ticker detail cards/table, dimmed and labeled.
- Manual picker adds a picker-only "Uncheck all eligible" action.
- `manualTickers + custom + []` is a valid, persisted empty applied state.
- Empty manual selection still uses the normal Unrealized P&L API path.
- Picker membership changes reset local muted legend state.
- Ticker detail breadcrumb/title use market-scoped `details.identity`, not broad catalog search identity.
- No catalog data cleanup or duplicate ticker migration belongs in this PR.
- Duplicate ticker regression should use a synthetic cross-market fixture.
- Analysis-origin ticker detail shows a clear analysis range/context action.
- Clearing analysis context removes `source`, `fromDate`, `toDate`, and `includeProvisional`, resets date range, and switches metric back to Current Price.
- Analysis-origin ticker detail defaults to Unrealized P&L until cleared.
- Ticker chart title/subtitle switch by metric.
- Current Price chart shows loading while hydration is in flight, then an explicit empty state if no data arrives.
- Focused unit/component tests are required; add or extend E2E coverage only if the existing flow is cheap.

## Implementation Steps

- [x] Update Unrealized P&L route-state parse/repair/serialization so `selection=manualTickers&tickerMode=custom` with empty `tickerIds` survives URL and preference persistence.
- [x] Add the manual ticker picker "Uncheck all eligible" action and empty trigger label/copy for zero selected tickers.
- [x] Update Unrealized P&L legend toggling so manual mode uses local muted state instead of modifying ticker membership or route params.
- [x] Ensure muted legend state resets when picker membership or broader data scope changes.
- [x] Render the shared empty chart/detail state for zero selected manual tickers while still using the normal API data path.
- [x] Keep muted rows/cards visible in selected ticker detail, dimmed and labeled consistently across top drivers and manual modes.
- [x] Replace ticker detail breadcrumb/title identity source with market-scoped `details.identity`; avoid broad catalog names when market scope is known.
- [x] Add synthetic duplicate ticker coverage proving cross-market catalog rows cannot leak the wrong name into ticker detail breadcrumb/title.
- [x] Add a ticker detail clear-analysis action beside analysis source/date badges.
- [x] Implement clear-analysis behavior: remove analysis params, reset chart date range, clear analysis-origin state, and switch metric to Current Price.
- [x] Keep analysis-origin ticker detail defaulting to Unrealized P&L before clear.
- [x] Make ticker chart title/subtitle metric-aware for Current Price versus Unrealized P&L.
- [x] Add Current Price chart loading and post-hydration empty states so an empty primary chart does not look broken.
- [x] Add focused tests for manual legend behavior, empty manual route state, picker uncheck-all, ticker identity, analysis clear, metric-aware chart copy, and chart loading/empty behavior.
- [x] Inspect existing analysis-to-ticker E2E coverage; extend it only if cheap and stable.

## Open Items

- [ ] If live catalog impact needs auditing later, run a read-only duplicate ticker query outside this PR; do not include data cleanup in this scope.

## Validation Evidence

- `npx vitest run test/features/analysis/unrealizedPnlRouteState.test.ts test/components/analysis/UnrealizedPnlAnalysisClient.test.tsx test/app/tickers/TickerHistoryClient.test.tsx test/app/tickers/tickerDetailsService.test.ts` from `apps/web` passed: 4 files, 73 tests.
- `npx tsc --noEmit --project apps/web/tsconfig.json` passed.
- `npx eslint` on the changed analysis, ticker detail, service, unit test, and E2E spec files passed.
- Existing analysis E2E coverage was inspected; `apps/web/tests/e2e/specs/unrealized-pnl-analysis-aaa.spec.ts` was updated for the new manual legend dimming behavior.
- `npm run test:e2e:bypass:mem --prefix apps/web -- --grep "analysis-unrealized-pnl-E"` passed: 1 Chromium test.
- Full gate 1, `npx eslint .`, passed with 6 pre-existing `playwright/no-conditional-in-test` warnings in AI connector responsive E2E specs and no errors.
- Full gate 2, `npm run typecheck`, passed.
- Full gate 3, `npm run test --prefix apps/web`, passed: web Vitest phases reported 65 files / 444 tests and 68 files / 454 tests passing.
- Full gate 4, `npm run test --prefix apps/api`, passed: 185 files passed, 44 skipped; 1879 tests passed, 437 skipped.
- Full gate 5, `npm run test:integration:full:host`, passed: 94 files passed; 946 tests passed, 1 skipped.
- Full gate 6, `npm run test:e2e:bypass:mem --prefix apps/web`, passed: 312 tests passed, 17 skipped.
- Full gate 7, `npm run test:e2e:oauth:mem --prefix apps/web`, passed: 121 tests passed.
- Full gate 8, `npm run test:http --prefix apps/api`, passed: 300 tests passed, 2 skipped.

## References

- Scope debate note: none
- Linear tickets: none
