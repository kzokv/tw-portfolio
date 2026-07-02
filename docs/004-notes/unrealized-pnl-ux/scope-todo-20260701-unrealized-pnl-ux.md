---
slug: unrealized-pnl-ux
source: scope-grill
created: 2026-07-01
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Unrealized P&L UX

> **For agents starting a fresh session:** this is the locked scope for the unrealized P&L UX redesign. Treat this file as the implementation source of truth unless superseded by a newer scope note.

## Locked Scope

1. Use a hard cutoff to the redesigned state model. Do not support or migrate legacy route/query params, API request fields, MCP input fields, shared DTO names, or old saved preference shape.
2. Ignore legacy/unknown old state gracefully and fall back to the new settings/defaults without breaking the page.
3. Remove legacy compatibility tests. Add tests for new defaults and invalid/unknown new-state fallback.
4. Use a new internal model with `selection = topDrivers | manualTickers`.
5. Use one filter group containing Selection, Position status, Tickers, and mode-specific Drivers.
6. Use UI labels `Top drivers`, `Manual tickers`, `Open positions`, and `Include sold-out`.
7. Use internal position status values `openOnly | includeClosed`.
8. Date range and account filters are shared across modes. Detail layout preference is also shared.
9. Mode-specific settings are remembered separately: position status, ticker mode, ticker IDs, and top-driver count.
10. Store settings as one context-specific, preferably versioned, Unrealized P&L analysis settings object.
11. Strictly validate the new settings object and repair invalid fields to defaults rather than discarding the whole object.
12. Route state carries only explicit current/shareable state. Preferences hold richer remembered mode-specific settings.
13. Query params override provided fields; missing query fields are filled from preferences, then defaults.
14. URL updates immediately on filter changes. Query/filter preferences persist only after the matching data refresh succeeds.
15. UI/layout preferences such as detail layout persist immediately.
16. Persist successful shared/query-opened states as the new remembered settings after successful refresh.
17. Use minimal new query params for current visible state, with names aligned to the new model, such as `selection`, `drivers`, `positionStatus`, `tickerMode`, and `tickerIds`.
18. Use `topDrivers` and `manualTickers` as new route/API enum values.
19. Use `MARKET:TICKER_CODE` as the logical ticker identity in route state, preferences, series IDs, and API DTOs.
20. Show ticker labels as `MARKET:TICKER_CODE:DISPLAY_NAME` when display name is available, otherwise `MARKET:TICKER_CODE`.
21. Group ticker picker options by market.
22. Search ticker picker options case-insensitively by market, ticker code, and display name.
23. Ticker picker displays eligible options plus saved unavailable selections only.
24. Unavailable saved ticker rows remain selected, disabled/flagged, counted in labels, and removable.
25. Unavailable saved ticker rows do not appear in chart legend or detail unless they are rendered candidates.
26. Persist custom ticker sets including unavailable saved ticker IDs until the user removes them.
27. Saved custom sets may contain only unavailable tickers and should render an empty state.
28. UI prevents users from manually creating an empty custom ticker set. Removing the last custom ticker is disallowed unless resetting to All eligible.
29. Both modes support `tickerMode = allEligible | custom`.
30. Persist `allEligible` as an abstract setting, not a snapshot of ticker IDs.
31. Both modes include a `Reset to All eligible` action in custom ticker mode, and the dropdown closes after reset.
32. Ticker picker trigger text is mode-aware, distinguishing ranking universe from shown chart membership.
33. In Top drivers, Tickers is an optional universe narrowing filter and defaults to All eligible.
34. In Manual tickers, Tickers is the primary chart membership control and defaults to All eligible.
35. Each mode remembers its own ticker mode, ticker set, and position status.
36. Switching Selection mode immediately applies that mode's remembered settings, closes the ticker dropdown, updates URL, and refetches.
37. Position status changes keep the ticker dropdown open and update option eligibility immediately.
38. Drivers changes keep the ticker dropdown open.
39. Dropdown search text persists while the dropdown remains open and clears when it closes.
40. Build ticker dropdown as a button-triggered popover/listbox with checkboxes, search, groups, unavailable rows, reset action, Escape close, outside-click close, and keyboard support. Reuse existing local primitives if available.
41. In Top drivers, show Drivers control with `5`, `10`, and `20` only. Remove `ALL` from Drivers.
42. Hide Drivers entirely in Manual tickers and let the filter group reflow naturally.
43. Top drivers ranks candidates by absolute period unrealized P&L change.
44. Top-driver tie-break is absolute period change descending, then market, then ticker.
45. Top drivers uses one combined absolute ranking, not separate gain/loss buckets.
46. Top-driver ranking orders valid period-change series first; null-change chartable series follow in deterministic market/ticker order.
47. Top drivers fills remaining driver slots with chartable null-change series when fewer than N valid-change series exist.
48. Detail rows/cards explicitly mark null period change as unavailable.
49. Best/worst summary considers only valid period-change series.
50. In Top drivers, legend click is a local mute/unmute only. It is not persisted.
51. Top-driver local legend mutes reset whenever filters/date/account/position/ticker/driver-count recompute the result.
52. In Manual tickers, legend click updates ticker selection and persists through manual ticker settings.
53. If Manual tickers is All eligible and the user turns off a legend item, convert to Custom with that ticker removed.
54. Manual mode has no separate temporary mute layer.
55. Legend order remains stable in candidate order and never reorders by active/muted state.
56. Legend items are toggle buttons with accessible active state and remain keyboard reachable when muted.
57. Legend items are not ticker-detail links.
58. API returns candidate lines. Client derives active/muted state.
59. Response echoes the normalized new query model used for the result.
60. API returns data-dependent warning facts; UI renders localized presentation copy.
61. Hard-cap truncation returns structured warning facts such as `candidateLimitApplied`, `candidateLimit`, and `omittedEligibleCount`.
62. Unavailable requested ticker reasons use stable reason codes such as `notInScope`, `noChartableSnapshots`, `valuationUnavailable`, and `invalidTicker`.
63. Valid-shape but unresolved custom ticker IDs remain unavailable with `invalidTicker`.
64. Eligibility means chartable data under the exact current account/date/position/ticker scope.
65. Open positions means open as of the resolved analysis end date.
66. Include sold-out includes only tickers with chartable snapshot data inside the selected account/date scope.
67. Zero-P&L snapshot series count as chartable.
68. All-null unrealized P&L series are unavailable/ineligible for rendered candidates, with reason metadata for requested saved tickers.
69. Partially-null series are chartable and use existing chart null/gap behavior.
70. Manual/custom selected ticker limit should use the broader filter safety cap, around 200, not the old comparison line cap of 20.
71. Manual tickers -> All eligible renders up to the safety cap and shows a hard limit warning if eligible tickers exceed that cap.
72. If All eligible exceeds the cap, choose the top capped set by absolute period P&L change, then display in deterministic manual market/ticker order.
73. When capped, chart, legend, and detail all show the same rendered candidate set with a hard limit warning.
74. Noisy-chart warning is based on rendered candidate count greater than 20.
75. Date state keeps both range presets and explicit `fromDate`/`toDate`; explicit dates win.
76. Keep previous chart, summary, and detail visible during refresh, mode switch, and failed refresh. Mark them stale/updating or stale/error as appropriate.
77. Keep chart/detail interactions enabled while stale, with clear section-level status that actions affect the previous result.
78. On refresh failure, keep previous successful result visible, show explicit error/unsaved status, and do not persist failed filter settings.
79. Show stale/updating state at chart/detail section level, not per row.
80. Summary cards remain tied to the previous successful result and are marked stale during refresh.
81. Detail section supports shared layout preference values `responsive | cards | table`.
82. Responsive layout renders cards on mobile and table on desktop.
83. Detail layout toggle uses an existing accessible segmented/radio control if available, otherwise a native select.
84. Detail section shows all returned/rendered candidates. In Top drivers, muted candidates remain visible but dimmed and marked `Muted`.
85. Detail ordering remains stable in candidate order.
86. Muted detail rows/cards remain clickable.
87. Manual mode has no muted detail rows in normal operation; deselected tickers leave the candidate set.
88. Table layout uses a core scan-focused subset: ticker/instrument, market, end unrealized P&L, period change, market value, cost basis, quantity, and position status.
89. Ticker ID and instrument name are clickable in both card and table layouts.
90. Chart lines/data points do not navigate in this pass.
91. Ticker detail links use `/tickers/{ticker}?marketCode={market}` and not analysis series IDs.
92. Ticker detail links from analysis include `source=unrealized-pnl-analysis`.
93. Ticker detail links do not include muted state.
94. Ticker detail navigation preserves explicit account filter scope: `accountId` for one account, `accountIds` for multiple accounts, omit account context when no account filter exists.
95. Ticker detail navigation passes `fromDate` and `toDate` when analysis has explicit/resolved date scope.
96. Ticker detail page applies analysis date/account scope to both price chart and Unrealized P&L metric when opened from analysis.
97. Ticker detail page defaults to `Unrealized P&L` metric when opened from unrealized P&L analysis; direct visits keep Price default.
98. Ticker detail page shows subtle scope chips when opened from analysis, such as `From analysis`, date range, and account count.
99. Ticker detail Unrealized P&L history uses native ticker currency, not reporting currency.
100. Ticker detail Unrealized P&L history shows total P&L across selected account scope, not per-account split.
101. Ticker detail Unrealized P&L history uses actual snapshot points only; do not interpolate or synthesize daily P&L.
102. Ticker detail chart metric options are `Price` and `Unrealized P&L`.
103. If no P&L snapshots exist for the selected ticker scope, show a metric-specific empty state in the chart area while keeping Price available.
104. Reuse existing chart component/style where feasible. Add a new component only if existing structure blocks the agreed interaction model.
105. Add unit/integration coverage plus focused Playwright E2E for the user-facing flows.

## Implementation Steps

- [x] Replace Unrealized P&L shared types with the new hard-cut DTO/state model, including `selection`, `positionStatus`, `tickerMode`, `tickerIds`, `drivers`, candidate lines, normalized query echo, unavailable requested tickers, and structured warning facts.
- [x] Update API route and MCP schemas to accept only the new model, ignore legacy fields through normal unknown-state fallback, and remove legacy `selectionMode`/`comparisonLineCount` semantics.
- [x] Rework API candidate resolution for Top drivers and Manual tickers, including exact-scope eligibility, unavailable reason codes, null handling, ranking, safety cap, noisy/hard-limit facts, and deterministic ordering.
- [x] Add API tests for ranking, eligibility, all-null/partial-null behavior, unavailable requested tickers, hard cap truncation, normalized query echo, invalid state fallback, and no legacy compatibility.
- [x] Replace web route state with minimal new query params and hard-cut parsing/serialization. Support partial query override with preference/default fill.
- [x] Implement the versioned context-specific Unrealized P&L settings object with field-level default repair and separate mode-specific memory.
- [x] Update refresh lifecycle so URL changes immediately, stale previous results remain visible, query preferences save only after successful matching refresh, failed refresh shows stale/error/unsaved status, and UI layout preference saves immediately.
- [x] Redesign the filter group to include Selection, Position status, Tickers, and mode-specific Drivers with natural reflow and mode-aware labels.
- [x] Build or adapt the ticker dropdown popover with grouped searchable checkbox options, unavailable saved rows, remove actions, reset to All eligible, outside/Escape dismissal, and keyboard support.
- [x] Update chart legend behavior for Top drivers local mute/reset and Manual tickers selection sync, keeping stable candidate order and accessible toggle semantics.
- [x] Update detail card/table section with shared layout preference, responsive/cards/table presentation, candidate-order rendering, muted Top-driver dimming/status, scan-focused table columns, and ticker/name links.
- [x] Update analysis-to-ticker navigation links to include source, market, account scope, and date scope while preserving existing ticker route shape.
- [x] Extend ticker detail API/data flow to provide unrealized P&L snapshot history in native ticker currency across selected account/date scope.
- [x] Add ticker detail chart metric toggle for Price vs Unrealized P&L, analysis-origin default metric, scope chips, and P&L empty state.
- [x] Update preview/demo data and i18n copy for the redesigned filter, warnings, unavailable reasons, muted state, stale/error status, and ticker detail metric.
- [x] Remove legacy compatibility tests and update existing web/API tests to the hard-cut model.
- [x] Add focused component/unit tests for route state, settings repair, dropdown behavior, legend behavior, detail layout, stale refresh reconciliation, and ticker detail query parsing.
- [x] Run `/aaa` to add or update E2E tests covering the filter group, dropdown dismissal/search/grouping, Top drivers legend muting, Manual ticker legend selection, stale/failed refresh behavior, card/table toggle, and analysis-to-ticker detail navigation.
- [x] Run the smallest relevant test scopes first, then the broader required repo suites as appropriate before PR.

## Evidence

- Shared types: `npm run build -w libs/shared-types` passed.
- API typecheck: `npx tsc --noEmit -p apps/api/tsconfig.json` passed.
- Web typecheck: `npx tsc --noEmit -p apps/web/tsconfig.json` passed.
- API focused coverage: `npx vitest run apps/api/test/unit/unrealizedPnlAnalysis.test.ts apps/api/test/integration/unrealizedPnlAnalysis.integration.test.ts apps/api/test/unit/tickerDetails.test.ts` passed, 40 tests.
- Web focused coverage: `cd apps/web && npx vitest run --config vitest.config.ts test/features/analysis/unrealizedPnlService.test.ts test/features/analysis/unrealizedPnlRouteState.test.ts test/features/analysis/useUnrealizedPnlData.test.tsx test/components/analysis/UnrealizedPnlAnalysisClient.test.tsx test/components/reports/ReportsClient.test.tsx test/app/tickers/tickerHistoryPage.test.tsx test/app/tickers/TickerHistoryClient.test.tsx test/features/dashboard/components.test.tsx` passed, 122 tests.
- API HTTP preference coverage: `cd apps/api && npx playwright test --config=test/http/playwright.config.ts test/http/specs/user-preferences-aaa.http.spec.ts` passed, 27 tests.
- Focused E2E: `cd apps/web && NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:${API_PORT:-4000} npx playwright test --config=tests/e2e/playwright.config.ts tests/e2e/specs/unrealized-pnl-analysis-aaa.spec.ts tests/e2e/specs/mobile-unrealized-pnl-analysis-aaa.spec.ts` passed, 7 tests with 1 tablet skip by mobile-only guard.
- Full gate 1: `npx eslint .` passed with 0 errors and 6 unrelated Playwright conditional-test warnings in AI connector E2E specs.
- Full gate 2: `npm run typecheck` passed.
- Full gate 3: `npm run test --prefix apps/web` passed after fixing ticker detail service history fallback; first batch 64 files/418 tests, second batch 68 files/446 tests.
- Full gate 4: `npm run test --prefix apps/api` passed, 185 files passed / 44 skipped, 1867 tests passed / 437 skipped.
- Full gate 5: `npm run test:integration:full:host` passed, 94 files passed, 944 tests passed / 1 skipped.
- Full gate 6: `npm run test:e2e:bypass:mem --prefix apps/web` passed, 312 tests passed / 17 skipped.
- Full gate 7: `npm run test:e2e:oauth:mem --prefix apps/web` passed, 121 tests passed.
- Full gate 8: `npm run test:http --prefix apps/api` passed, 300 tests passed / 2 skipped.
- Local desktop/mobile UI validation used a memory API on port 4100 and web dev server on port 3100, with browser interception for the report fallback. Screenshots:
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/artifacts/validation/unrealized-pnl-desktop.png`
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/artifacts/validation/unrealized-pnl-mobile.png`
- Manual tickers mode mockups:
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/artifacts/mockups/unrealized-pnl-ux-manual-desktop.png`
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/artifacts/mockups/unrealized-pnl-ux-manual-mobile.png`
- Scope-reviewed Manual tickers mode mockups:
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/artifacts/mockups/unrealized-pnl-ux-scope-reviewed-manual-desktop.png`
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/artifacts/mockups/unrealized-pnl-ux-scope-reviewed-manual-mobile.png`
- Full AGENTS.md eight-suite gate passed locally.

## Open Items

- [ ] Rebase on the latest `origin/dev`, create clean commits, open the PR to `dev`, and complete review/CI follow-up.

## Validation Issues Recorded

- Mobile E2E initially failed because it still asserted the removed `Ticker selection` section; the test now validates the redesigned responsive filter group and Manual tickers mode.
- Failed-refresh E2E initially had order-dependent route-cache/preference state; the test now uses explicit URL state and deterministic `drivers=10` failure interception.
- Ticker detail test fixture initially used invalid chart metadata typing; the fixture now matches the shared DTO shape.
- Full web unit test initially failed because ticker detail service mappers assumed all endpoint payloads include `unrealizedPnlHistory`; missing history now maps to an empty array instead of falling back to stale primary detail data.

## Out Of Scope

- Legacy route/query/API/MCP/preference compatibility or migration.
- Per-account split series on ticker detail Unrealized P&L history.
- Reporting-currency P&L history on ticker detail.
- Synthetic daily P&L reconstruction or interpolation.
- Chart-line or data-point navigation.
- Legend ticker labels as detail links.
- User-defined custom display ordering for manual ticker selections.
- Row expansion in detail table layout.

## References

- Scope debate note: none
- Scope GIF: `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/artifacts/scope-grill/q26-filter-first-lines-second-v2.gif`
- Key inspected files:
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/apps/web/components/analysis/UnrealizedPnlAnalysisClient.tsx`
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/apps/web/features/analysis/unrealizedPnlRouteState.ts`
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/apps/web/features/analysis/hooks/useUnrealizedPnlData.ts`
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/apps/web/features/analysis/services/unrealizedPnlService.ts`
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/apps/api/src/services/unrealizedPnlAnalysis.ts`
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx`
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/apps/web/features/portfolio/services/tickerDetailsService.ts`
  - `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-ux/apps/api/src/services/tickerDetails.ts`
