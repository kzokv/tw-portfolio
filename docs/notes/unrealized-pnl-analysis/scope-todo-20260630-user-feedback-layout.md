---
slug: unrealized-pnl-user-feedback-layout
source: scope-grill
created: 2026-06-30
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Unrealized P&L User Feedback Layout

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

1. Total unrealized detail opens from the Total card via click/tap.
2. Desktop uses a bounded popover; mobile uses a sheet/dialog-style panel.
3. Total detail stays anchored to the report end date, not the focus scrub.
4. Total detail uses a new full ticker composition API/shared DTO field, exposed through HTTP and MCP.
5. Composition rows show instrument name, ticker/market, end unrealized P&L, and contribution share when meaningful.
6. Composition rows sort descending by end unrealized P&L; null/unavailable rows go last.
7. Reconciliation warnings appear only when unavailable/null values prevent clean explanation.
8. Decomposition becomes one workspace card: chart plus Ticker selection on desktop, stacked on mobile.
9. "Ticker ranking" becomes "Ticker selection"; ranking number remains metadata.
10. Ticker selection rows show checkbox, rank/manual badge, color dot, instrument name, ticker/market, and open/closed state.
11. Checked rows highlight chart lines; unchecked rows remain visible but muted.
12. Chart line identity is shown inside the chart corner with color dots and instrument names.
13. Selected detail moves into the decomposition card bottom.
14. Selected detail renders the same bounded ranked/manual set as Ticker selection.
15. Checked detail rows are expanded; unchecked detail rows stay visible but collapsed/muted.
16. Selected detail gets sort: Ranking, Name, End P&L.
17. Ranking number means existing rank by absolute period unrealized P&L change.
18. Manual selected tickers outside the ranked set appear as pinned Manual/Unranked rows.
19. Instrument name is primary everywhere; ticker/market is secondary metadata.
20. Decomposition card stays bounded to returned ranked/manual rows; Total popover handles full composition.

## Implementation Steps

- [x] Add shared DTO type/schema for unrealized P&L ticker composition rows.
- [x] Populate composition in `buildUnrealizedPnlAnalysis` from all included ticker series.
- [x] Preserve HTTP/MCP parity and update API/MCP tests.
- [x] Map composition into web analysis service types.
- [x] Add Total unrealized detail trigger with desktop popover and mobile sheet/dialog.
- [x] Redesign decomposition card into chart + Ticker selection + selected detail layout.
- [x] Add a chart-corner legend with color dots and instrument names for every rendered line.
- [x] Replace ranking table with compact Ticker selection rows.
- [x] Add expanded/collapsed selected detail behavior and sort control.
- [x] Ensure manual out-of-ranking selected tickers render as pinned rows.
- [x] Update English/ZH-TW copy.
- [x] Add focused component tests for popover composition, selection behavior, collapsed detail, sort, and manual rows.
- [x] Run `/aaa` or update E2E tests for desktop/mobile analysis workflow.
- [x] Verify responsive layout with Playwright screenshots.

## Open Items

- [x] Decide exact shared DTO field name during implementation, with preference for the clearest API/MCP contract such as `tickerComposition` or `composition`.

Decision: use `tickerComposition` in shared DTO, HTTP response, MCP structured content, and web mapped model.

## Evidence

- Shared/API/MCP: `libs/shared-types/src/index.ts`, `apps/api/src/services/unrealizedPnlAnalysis.ts`, `apps/api/src/mcp/tools.ts`.
- Web/UI: `apps/web/components/analysis/UnrealizedPnlAnalysisClient.tsx`, `apps/web/features/analysis/services/unrealizedPnlService.ts`, `apps/web/features/analysis/unrealizedPnlPreview.ts`, `apps/web/features/analysis/i18n.ts`.
- Focused API/MCP validation passed: `npx vitest run apps/api/test/unit/unrealizedPnlAnalysis.test.ts apps/api/test/unit/mcpReportTools.test.ts apps/api/test/integration/unrealizedPnlAnalysis.integration.test.ts` (22 tests).
- Focused web validation passed: `npx vitest run test/components/analysis/UnrealizedPnlAnalysisClient.test.tsx test/features/analysis/unrealizedPnlService.test.ts test/features/analysis/useUnrealizedPnlData.test.tsx` from `apps/web` (15 tests).
- Build/type validation passed: `npm run build -w libs/shared-types && npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json`.
- Fresh standalone build passed: `NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 npm run build -w @vakwen/config -w @vakwen/test-framework -w @vakwen/test-e2e -w @vakwen/web`.
- Targeted E2E validation passed after clearing stale `.next`: `npx playwright test tests/e2e/specs/unrealized-pnl-analysis-aaa.spec.ts tests/e2e/specs/mobile-unrealized-pnl-analysis-aaa.spec.ts --config=apps/web/tests/e2e/playwright.config.ts` (3 passed, 1 tablet viewport guard skipped).
- Responsive mockup screenshots generated with Playwright:
  - `docs/notes/unrealized-pnl-analysis/mockups/unrealized-pnl-user-feedback-desktop.png` (default desktop decomposition with unobstructed chart legend)
  - `docs/notes/unrealized-pnl-analysis/mockups/unrealized-pnl-user-feedback-desktop-total-popover.png` (desktop Total composition popover state)
  - `docs/notes/unrealized-pnl-analysis/mockups/unrealized-pnl-user-feedback-mobile.png`
  - `docs/notes/unrealized-pnl-analysis/mockups/unrealized-pnl-user-feedback-mobile-sheet.png`

- Full AGENTS eight-suite matrix passed:
  - `npx eslint .` (passed with existing unrelated Playwright conditional-test warnings in AI connector specs)
  - `npm run typecheck`
  - `npm run test --prefix apps/web`
  - `npm run test --prefix apps/api`
  - `npm run test:integration:full:host` (94 files, 944 passed, 1 skipped)
  - `npm run test:e2e:bypass:mem --prefix apps/web` (308 passed, 17 skipped)
  - `npm run test:e2e:oauth:mem --prefix apps/web` (121 passed on full rerun)
  - `npm run test:http --prefix apps/api` (299 passed, 2 skipped)
- E2E issue encountered and cleared: the first full OAuth E2E run timed out in unrelated `card-reorder-aaa.spec.ts` waiting for a `PATCH /user-preferences` response; the targeted card-reorder OAuth spec passed (`5 passed`) and the subsequent full OAuth suite passed (`121 passed`).

## References

- Mockup source: `docs/notes/unrealized-pnl-analysis/mockups/user-feedback-layout-mockup.html`
- Desktop mockup: `docs/notes/unrealized-pnl-analysis/mockups/unrealized-pnl-user-feedback-desktop.png`
- Desktop Total composition popover mockup: `docs/notes/unrealized-pnl-analysis/mockups/unrealized-pnl-user-feedback-desktop-total-popover.png`
- Mobile stacked-layout mockup: `docs/notes/unrealized-pnl-analysis/mockups/unrealized-pnl-user-feedback-mobile.png`
- Mobile Total composition sheet mockup: `docs/notes/unrealized-pnl-analysis/mockups/unrealized-pnl-user-feedback-mobile-sheet.png`
- Scope debate note: none
- Linear tickets: none
