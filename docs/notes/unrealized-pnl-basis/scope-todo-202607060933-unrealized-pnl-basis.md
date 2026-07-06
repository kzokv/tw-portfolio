---
slug: unrealized-pnl-basis
source: scope-grill
created: 2026-07-06
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Unrealized P&L Basis Disclosure and Analysis Refinements

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. This artifact is the locked scope; do not expand the calculation semantics without re-opening scope with the user.

## Scope Status

- Scope locked by the user on 2026-07-06.
- No debate note was produced.
- Worktree branch at scope lock: `codex/unrealized-pnl-analysis-scope`, based on `origin/dev` at `5a0b9627`.
- Target user for reproduced dev data: `mmckchuang@gmail.com`.

## Confirmed Investigation

- Reports portfolio Unrealized P&L reproduced as `A$434,119.82` from current open lots using report/display quote resolution and report/latest FX.
- Unrealized P&L analysis reproduced as `A$434,189.06` from `daily_holding_snapshots` using snapshot valuation and snapshot-date FX.
- The mismatch is not an arithmetic error. It is a valid valuation-basis mismatch that is currently under-disclosed in the UI.
- 2026-07-05 was a Sunday, and 2026-07-03 was a US market holiday for Independence Day observed. US tickers should visibly explain that the report is using 2026-07-02 close where no 2026-07-03 US close exists.
- Quote fallback can update the displayed quote path without updating holding snapshots. Confirmed example: `ETPMAG` had a fallback quote snapshot for 2026-07-03, but no `market_data.daily_bars` row and no holding snapshot for that date. `AVGO` had no fallback snapshot and also stayed on the 2026-07-02 snapshot/close path.

## Locked Scope

- Keep Reports and Unrealized P&L analysis as separate valuation surfaces:
  - Reports are current valuation: current open holdings, displayed/latest eligible quote resolution, and report/latest FX basis.
  - Analysis is snapshot valuation: `daily_holding_snapshots`, snapshot prices, and snapshot-date FX basis.
- Do not force Reports and Analysis to produce the same Unrealized P&L number in this scope. Instead, disclose the basis clearly enough that users can tell which number answers which question.
- Add report-side basis disclosure near the report meta/header, not only in data health details.
- Report basis disclosure must include:
  - quote as-of date,
  - quote source/provider where available,
  - fallback quote usage where applicable,
  - FX date/basis,
  - market closure/holiday/weekend rollback explanation.
- Calendar closure disclosure applies to all supported markets in the report scope, not just the US market. Initial supported market scope is `TW`, `US`, `AU`, `KR`, and `JP`, matching the current report/calendar support set.
- Use active market calendar status and closure names where available. For example: `US closed Jul 3: using Jul 2 close`.
- Analysis-side basis disclosure must explain that the chart/details use holding snapshots and snapshot-date FX, and must surface snapshot date/source/FX basis in the selected detail experience where available.
- Selected ticker details must add a total sum of end P&L:
  - sum active/unmuted selected rows only,
  - use `endUnrealizedPnl`,
  - exclude null P&L rows,
  - display `-` if all selected rows have null end P&L,
  - place the total above the selected detail table/card but below the selected detail title/description.
- Ticker decomposition line chart must add:
  - a visually explicit zero baseline,
  - compact y-axis amount labels for max, zero, and min in the selected reporting currency.
- Keep the UI copy as basis tips/disclosure, not as an error banner, unless existing diagnostics already classify a true data issue.

## Implementation Steps

- [x] Extend backend report diagnostics/DTOs, if needed, so the web client can render market basis by market: expected valuation date, actual quote date, calendar status, closure name, provider/source, fallback flag, and FX date/basis.
- [x] In `apps/api/src/services/reports.ts`, preserve current report valuation semantics while attaching enough basis metadata for each affected market and holding row.
- [x] Use existing `priceState` metadata on report holding rows where possible before adding new fields.
- [x] Add report UI basis disclosure in `apps/web/components/reports/ReportsClient.tsx` near the report meta/header.
- [x] Ensure report disclosure explains multi-market behavior compactly, including holiday/weekend rollbacks for every market in scope.
- [x] Extend Unrealized P&L analysis DTOs/service, if needed, so selected ticker details can display snapshot date/source and snapshot FX basis.
- [x] Add analysis-side basis tip in `apps/web/components/analysis/UnrealizedPnlAnalysisClient.tsx` above the selected detail table/card and below the selected detail title/description.
- [x] Add the selected ticker detail end P&L total using selected active/unmuted rows and `endUnrealizedPnl`.
- [x] Update the ticker decomposition SVG chart to show an explicit zero baseline and compact y-axis amount labels for max, zero, and min.
- [x] Add component/unit tests for report basis disclosure, analysis basis disclosure, selected detail end P&L total, and chart y-axis/zero baseline behavior.
- [x] Run `/aaa` or otherwise add/update E2E coverage for the user-facing report and analysis disclosure flows covered by this scope.
- [x] Run the smallest relevant test scope first, then broader checks according to repo guidance before opening a PR.
- [x] After implementation, revisit this todo and mark completed deliverables with `[x]`.

## Open Items

- [x] Decide during implementation whether report FX should remain latest/report-date FX long term or move to snapshot-date FX in a future scoped change. This scope keeps report/latest FX semantics and discloses the basis; any semantics change is deferred to a future scope.
- [x] Confirm the final UI wording once the available basis metadata is known; keep it concise and avoid implying a data error when the behavior is a basis difference.

## Implementation Evidence

- Backend/shared contracts:
  - `libs/shared-types/src/index.ts` adds report valuation basis and analysis snapshot-basis DTO fields.
  - `apps/api/src/services/reports.ts` attaches `diagnostics.valuationBasis` without changing report valuation semantics; scope seeding covers `TW`, `US`, `AU`, `KR`, and `JP` for `all`, and the requested market for single-market reports.
  - Report valuation basis now carries per-market quote source composition (`quoteSources`, `fallbackProviders`, `fallbackQuoteCount`, `holdingCount`) so one fallback-priced holding does not make the entire market look like it used that fallback source.
  - `apps/api/src/services/unrealizedPnlAnalysis.ts` surfaces snapshot valuation basis, snapshot dates, provider sources, and snapshot FX dates.
  - `apps/api/src/persistence/memory.ts` and `apps/api/src/persistence/postgres.ts` preserve provider/source and FX-as-of metadata for analysis snapshot rows.
- UI:
  - `apps/web/components/reports/ReportsClient.tsx` renders the report valuation basis strip under report meta/header.
  - The report valuation basis strip renders mixed per-holding quote sources and partial fallback counts, for example when one AU holding uses `eodhd` while another AU holding stays on the primary quote path.
  - Legacy/cached report payloads without `diagnostics.valuationBasis` use the same conservative quote-date disclosure as the backend: unavailable when any holding row is missing a quote date, otherwise the earliest quote date across market rows.
  - `apps/web/components/analysis/UnrealizedPnlAnalysisClient.tsx` renders the selected-detail basis note, active selected end P&L total, zero baseline, and max/zero/min y-axis amount labels.
  - The analysis selected-detail basis note follows the focused chart date when a user scrubs/focuses an earlier point instead of falling back to the latest snapshot date.
  - English and zh-TW copy was added in `apps/web/features/analysis/i18n.ts`, `apps/web/features/dashboard/i18n.ts`, and `apps/web/lib/i18n/types.ts`.
- Mockups:
  - `docs/notes/unrealized-pnl-basis/mockups/reports-basis-disclosure.png`
  - `docs/notes/unrealized-pnl-basis/mockups/analysis-details-basis-total.png`
  - `docs/notes/unrealized-pnl-basis/mockups/analysis-chart-axis-zero.png`

## Validation Evidence

- Passed: `npm run build -w libs/shared-types`
- Passed: `npm run test --prefix apps/api -- --run test/unit/reports.test.ts`
- Passed: `npm run test --prefix apps/api -- --run test/unit/reports.test.ts test/unit/unrealizedPnlAnalysis.test.ts`
- Passed: `npx tsc --noEmit -p apps/web/tsconfig.json`
- Passed: `npx vitest run test/components/reports/ReportsClient.test.tsx test/components/analysis/UnrealizedPnlAnalysisClient.test.tsx` from `apps/web`
- Passed with existing warnings only: `npx eslint .`
- Passed: `npm run typecheck`
- Passed after fixes: `npm run test:e2e:bypass:mem --prefix apps/web -- --grep "analysis-unrealized-pnl-(B|G)"`
- Passed after fixes: `npx playwright test tests/e2e/specs/unrealized-pnl-analysis-aaa.spec.ts --config=tests/e2e/playwright.config.ts --grep "analysis-unrealized-pnl-B"` from `apps/web`
- Passed after fixes: `npx playwright test tests/e2e/specs/unrealized-pnl-analysis-aaa.spec.ts --config=tests/e2e/playwright.config.ts --grep "analysis-unrealized-pnl-G"` from `apps/web`
- Passed: `npm run test --prefix apps/web`
- Passed: `npm run test --prefix apps/api`
- Passed after final mixed-source/focused-basis fixes: `npm run test --prefix apps/api -- --run test/unit/reports.test.ts test/unit/unrealizedPnlAnalysis.test.ts`
- Passed after final mixed-source/focused-basis fixes: `npx vitest run test/components/reports/ReportsClient.test.tsx test/components/analysis/UnrealizedPnlAnalysisClient.test.tsx` from `apps/web`
- Passed after final mixed-source/focused-basis fixes: `npm run typecheck`
- Passed after legacy cached-basis review fix: `npx vitest run test/components/reports/ReportsClient.test.tsx` from `apps/web`
- Passed after CI lint cleanup: `npx eslint .` (existing Playwright conditional warnings only)
- Passed after CI lint cleanup: `npx vitest run test/components/reports/ReportsClient.test.tsx` from `apps/web`
- Passed after fixes: `npm run test:integration:full:host` (`95` files, `966` passed, `1` skipped)
- Passed: `npm run test:e2e:bypass:mem --prefix apps/web` (`318` passed, `19` skipped)
- Passed after fixes: `npx playwright test tests/e2e/specs-oauth/admin-instruments-aaa.spec.ts --config=tests/e2e/playwright.oauth.config.ts` from `apps/web`
- Passed after fixes: `npm run test:e2e:oauth:mem --prefix apps/web` (`121` passed)
- Passed: `npm run test:http --prefix apps/api` (`301` passed, `2` skipped)
- Passed: `git diff --check`

## Recorded Validation Issues

- `npm run test --prefix apps/web -- --run test/components/reports/ReportsClient.test.tsx test/components/analysis/UnrealizedPnlAnalysisClient.test.tsx` expanded through the package test script and failed one unrelated existing test: `test/components/admin/AdminSettingsClient-tabs.test.tsx > falls back to rate-limits when ?tab is absent` timed out after 5000 ms. The scoped component files passed when run directly with `npx vitest`.
- First E2E pass failed because `scope=US` reports did not render a `reports-basis-market-US` card for an empty scoped report. Fixed by seeding report valuation basis with the requested market even when no holdings are present; verified with API unit and report E2E reruns.
- Second E2E pass failed due to a strict Playwright text locator where `FX` matched both the heading and `No FX conversion required`. Fixed with exact text matching and reran the E2E.
- Full OAuth E2E initially failed because `apps/web/tests/e2e/specs-oauth/admin-instruments-aaa.spec.ts` used broad `retired_by_admin` text matching after the drawer rendered the status both as a definition value and a disabled button label. Fixed by asserting the definition role value; verified with the focused OAuth spec and the full OAuth suite.
- Live Vakwen Dev validation found that the AU market basis card rendered `Source eodhd` while only `ETPMAG` used an `EODHD stale` fallback and `QAU` stayed on the normal closed quote path. Fixed by rendering per-holding source composition plus fallback counts instead of a single market-wide representative source.
- Codex review found that the analysis selected-detail basis note still used all selected series points while focused cards used the focused date. Fixed by aggregating basis metadata from focused points when a focus date is active.
- Codex review found that the legacy/cached report fallback path used the freshest holding quote date even though server-side valuation basis is conservative. Fixed by deriving `quoteAsOf` as unavailable when any market row is missing an as-of date, otherwise the earliest market row date.
- CI lint then found the previous `latestDate` helper was unused after that conservative fallback fix. Removed the dead helper and reran lint plus the report component regression.

## References

- Reports service: `apps/api/src/services/reports.ts`
- Unrealized P&L analysis service: `apps/api/src/services/unrealizedPnlAnalysis.ts`
- Snapshot generation: `apps/api/src/services/snapshotGeneration.ts`
- Quote snapshot resolution: `apps/api/src/services/market-data/quoteSnapshotService.ts`
- Shared DTOs: `libs/shared-types/src/index.ts`
- Reports UI: `apps/web/components/reports/ReportsClient.tsx`
- Analysis UI: `apps/web/components/analysis/UnrealizedPnlAnalysisClient.tsx`
- Mockup source: `docs/notes/unrealized-pnl-basis/mockups/unrealized-pnl-basis-mockups.html`
- Mockup render script: `docs/notes/unrealized-pnl-basis/mockups/render-mockups.mjs`
- Report basis mockup: `docs/notes/unrealized-pnl-basis/mockups/reports-basis-disclosure.png`
- Analysis details mockup: `docs/notes/unrealized-pnl-basis/mockups/analysis-details-basis-total.png`
- Analysis chart mockup: `docs/notes/unrealized-pnl-basis/mockups/analysis-chart-axis-zero.png`
