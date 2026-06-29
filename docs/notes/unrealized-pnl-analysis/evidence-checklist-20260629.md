# Unrealized P&L Analysis Evidence Checklist

Date: 2026-06-29
Worktree: `/Users/lume/repos/tw-portfolio/.worktrees/unrealized-pnl-mcp-improvements`
Scope source: `docs/notes/unrealized-pnl-analysis/scope-todo-20260629-unrealized-pnl-analysis.md`

This note defines the minimum evidence required before any box in the locked scope should be checked.

Current status:

- Implementation evidence has been reviewed for the locked scope items and the source scope checklist is checked for shipped code paths.
- Full eight-suite AGENTS validation passed locally on the current worktree diff after the final preference/cache patch.
- This file records the proof used for the implementation checkboxes and the completed validation gate.

## Evidence Update — 2026-06-29

### Scope Evidence

- Shared contracts: `libs/shared-types/src/index.ts` exports Unrealized P&L query, DTO, bounds, diagnostics, rankings, series, trade marker, and MCP-compatible response types.
- Backend service: `apps/api/src/services/unrealizedPnlAnalysis.ts` implements `buildUnrealizedPnlAnalysis(...)` and centralizes query normalization, API bounds, daily/weekly/monthly/yearly bucketing, selected ticker defaults, ranking limits, sold-out handling, provisional exclusion, diagnostics, data health, trade markers, and deterministic `deepLink`.
- Persistence: `apps/api/src/persistence/types.ts`, `apps/api/src/persistence/memory.ts`, and `apps/api/src/persistence/postgres.ts` add `listUnrealizedPnlAnalysisSnapshots(...)` to aggregate `daily_holding_snapshots` by date, ticker, market, account scope, and reporting currency.
- API route: `apps/api/src/routes/registerRoutes.ts` exposes `GET /analysis/unrealized-pnl` as a thin adapter over the shared service.
- MCP tool: `apps/api/src/mcp/tools.ts` and `apps/api/src/mcp/registerMcpRoutes.ts` register and execute `get_unrealized_pnl_report` through the same shared service.
- Analysis routes: `apps/web/app/analysis/page.tsx` and `apps/web/app/analysis/unrealized-pnl/page.tsx` add the top-level Analysis area and first workspace.
- Analysis UI: `apps/web/components/analysis/UnrealizedPnlAnalysisClient.tsx` implements the v1 filter surface, summary, decomposition chart, ranking selection, comparison chart, focus scrub, detail cards, loading skeleton, reduced-motion-safe refresh behavior, mobile collapsed filters, and muted unselected series.
- Route state/cache/preferences: `apps/web/features/analysis/unrealizedPnlRouteState.ts`, `apps/web/features/analysis/hooks/useUnrealizedPnlData.ts`, and `apps/web/lib/routeDtoCache.ts` implement deterministic URL state, route DTO cache reuse, and session-scoped presentation defaults via `analysisUnrealizedPnlDefaults`.
- Discovery links: `apps/web/components/reports/ReportsClient.tsx`, `apps/web/components/dashboard/DashboardClient.tsx`, and `apps/web/components/dashboard/BiggestMoversCard.tsx` deep-link Reports/Dashboard surfaces into `/analysis/unrealized-pnl` using the shared route-state serializer.
- Navigation/i18n: Analysis navigation and zh-TW/en copy are wired through `apps/web/components/layout/*`, `apps/web/lib/i18n.ts`, `apps/web/lib/i18n/types.ts`, and `apps/web/features/analysis/i18n.ts`.
- Mockups: desktop and mobile screenshots are stored under `docs/notes/unrealized-pnl-analysis/mockups/`.

### Focused Backend Validation

- Passed: `cd apps/api && npx vitest run test/unit/unrealizedPnlAnalysis.test.ts test/unit/mcpReportTools.test.ts test/integration/unrealizedPnlAnalysis.integration.test.ts`
- Coverage evidence:
  - `apps/api/test/unit/unrealizedPnlAnalysis.test.ts` covers buy-only history, partial sell/full exit markers, sold-out default exclusion and included sold-out rows, multi-account aggregation, cross-market same-symbol separation, missing FX diagnostics, provisional exclusion/inclusion, daily/weekly/monthly/yearly bucketing, and deterministic deep-link behavior.
  - `apps/api/test/integration/unrealizedPnlAnalysis.integration.test.ts` proves API/MCP parity by comparing the `GET /analysis/unrealized-pnl` body to `get_unrealized_pnl_report` structured content.
  - `apps/api/test/unit/mcpReportTools.test.ts` proves tool catalog registration and report-read metadata for `get_unrealized_pnl_report`.

### Focused Web Validation

- Passed: `cd apps/web && npx vitest run test/components/analysis/UnrealizedPnlAnalysisClient.test.tsx test/features/analysis/unrealizedPnlRouteState.test.ts`
- Passed earlier in this worktree: `cd apps/web && npx vitest run test/components/analysis/UnrealizedPnlAnalysisClient.test.tsx test/features/analysis/unrealizedPnlRouteState.test.ts test/components/reports/ReportsClient.test.tsx test/features/dashboard/components.test.tsx`
- Coverage evidence:
  - `apps/web/test/features/analysis/unrealizedPnlRouteState.test.ts` covers deterministic parse/serialize, custom date state, report/dashboard range mapping, explicit URL precedence over preferences, and bounded preference parsing.
  - `apps/web/test/components/analysis/UnrealizedPnlAnalysisClient.test.tsx` covers preview shell render, ranking selection URL updates, focus scrub URL sync, preference hydration, URL override precedence, and preference persistence.
  - Reports and Dashboard component tests cover discovery modules and deep links into the shared analysis route-state format.

### MCP/API Parity Validation

- `apps/api/test/integration/unrealizedPnlAnalysis.integration.test.ts` compares the complete extracted MCP structured payload to the HTTP API JSON response for the same monthly include-sold query.
- `apps/api/src/mcp/registerMcpRoutes.ts` and `apps/api/src/routes/registerRoutes.ts` both call `buildUnrealizedPnlAnalysis(...)`; no separate MCP-specific report builder exists.

### Responsive/Manual UI Validation

- Generated mockup screenshots:
  - `docs/notes/unrealized-pnl-analysis/mockups/unrealized-pnl-analysis-desktop.png`
  - `docs/notes/unrealized-pnl-analysis/mockups/unrealized-pnl-analysis-mobile.png`
- Focused E2E specs were added:
  - `apps/web/tests/e2e/specs/unrealized-pnl-analysis-aaa.spec.ts`
  - `apps/web/tests/e2e/specs/mobile-unrealized-pnl-analysis-aaa.spec.ts`
- Earlier focused E2E run in this worktree passed:
  - `npx playwright test tests/e2e/specs/unrealized-pnl-analysis-aaa.spec.ts --config=apps/web/tests/e2e/playwright.config.ts`
  - `npx playwright test tests/e2e/specs/mobile-unrealized-pnl-analysis-aaa.spec.ts --config=apps/web/tests/e2e/playwright.config.ts` with the tablet-width guard skipped as designed.

### Full Gate Evidence

- Passed on the current worktree diff:
  1. `npx eslint .` — passed with six pre-existing Playwright warnings in AI connector history specs.
  2. `npm run typecheck` — passed.
  3. `npm run test --prefix apps/web` — passed; phase 1 reported 64 files and 406 tests, phase 2 reported 65 files and 440 tests.
  4. `npm run test --prefix apps/api` — passed; 185 files passed, 44 skipped, 1849 tests passed, 437 skipped.
  5. `npm run test:integration:full:host` — passed; 94 files passed, 944 tests passed, 1 skipped.
  6. `npm run test:e2e:bypass:mem --prefix apps/web` — passed; 308 passed, 17 skipped.
  7. `npm run test:e2e:oauth:mem --prefix apps/web` — passed; 121 passed.
  8. `npm run test:http --prefix apps/api` — passed; 298 passed, 2 skipped.

### Remaining Gaps

- No locked implementation todo is intentionally deferred.
- PR readiness remains pending until latest `dev` rebase/freshness check, commit/PR metadata, Codex review, and CI monitoring are complete.

### Durable Lesson Review

- Ran a lightweight `/si-review` pass against `.claude/memory/MEMORY.md` and `CLAUDE.md`.
- No `/si-promote` change was made: existing promoted rules already cover the durable patterns exercised by this work, including server-authoritative report DTOs, route DTO cache context keys, URL-first App Router state, and user preference key extension.

## Evidence Rules

- Code evidence means a concrete diff exists in the named layer and can be pointed to by file path.
- Test evidence means at least one focused automated test or contract check proves the new behavior.
- Runtime evidence means route payload inspection, screenshots, or manual verification is needed because code/tests alone would not prove the user-visible or MCP-visible outcome.
- For items that change shared behavior, API and MCP parity must be shown explicitly rather than inferred.
- Before merge, final validation must still follow the repo rule for the full eight-suite gate. Focused evidence is necessary for checking individual boxes but is not a substitute for the final repo gate.

## Suggested Evidence Log Shape

When implementation starts, record evidence in a follow-up validation note using this shape:

1. Scope evidence
2. Focused backend validation
3. Focused web validation
4. MCP/API parity validation
5. Responsive/manual UI validation
6. Full eight-suite gate evidence
7. Remaining gaps or explicit deferrals

## Implementation Todo Evidence Gates

1. `Add shared DTO and query types for Unrealized P&L analysis in libs/shared-types.`
   Required evidence: new exported DTO/query types in `libs/shared-types`; compile/typecheck evidence for consumers; focused tests or schema assertions proving the public shape used by API and web.

2. `Add parsing and validation for /analysis/unrealized-pnl query state, including API bounds and granularity rules.`
   Required evidence: route/query parser code with explicit bounds; focused tests for valid/invalid ranges and `ALL` yearly-only behavior; examples showing deterministic serialization back to URL state.

3. `Add persistence support to aggregate daily_holding_snapshots by date, market, ticker, account scope, and reporting currency.`
   Required evidence: persistence implementation in memory and Postgres paths if both are used in this repo pattern; focused integration tests covering aggregation dimensions; sample payload/assertions showing reporting-currency resolution.

4. `Implement period-end bucketing for daily, weekly, monthly, and yearly snapshots.`
   Required evidence: bucketing logic with clear period-end rules; focused tests for each granularity; at least one edge-case assertion around partial periods or boundary dates.

5. `Implement sold-out historical behavior: excluded by default, post-exit zero series with exit marker when included.`
   Required evidence: service logic for default exclusion and optional inclusion; focused tests proving zero continuation after exit; runtime payload example showing exit marker plus muted-series intent metadata if exposed.

6. `Implement transaction marker derivation for buy, partial sell, full exit, and aggregate same-date events.`
   Required evidence: marker derivation logic; focused tests for all four marker types; payload example showing same-date aggregation rather than duplicated markers.

7. `Implement buildUnrealizedPnlAnalysis(...) as the shared backend service for API and MCP.`
   Required evidence: single shared service used by both callers; tests proving both API and MCP read from the shared builder instead of divergent shaping; code-path references for both integrations.

8. `Add GET /analysis/unrealized-pnl API route.`
   Required evidence: route registration and contract shape; focused HTTP or integration test covering success plus validation failure; sample response showing resolved filters and analysis sections.

9. `Add MCP tool definition and handler for get_unrealized_pnl_report.`
   Required evidence: MCP tool registration plus handler; focused MCP integration test covering discovery and execution; sample tool response with required top-level fields.

10. `Ensure MCP output includes summary, portfolio series, ticker series, rankings, selected tickers, data health, diagnostics, resolved filters, and deterministic deepLink.`
    Required evidence: explicit response-shape assertions in MCP tests; one captured response example; parity check showing `deepLink` matches the route-state format used by the web route.

11. `Add backend tests covering buy-only history, partial sells, full sells, current-only exclusion, multiple accounts same ticker, same ticker across markets, missing prices, provisional inclusion/exclusion, period-end bucketing, and MCP/API parity.`
    Required evidence: concrete test files containing those cases; command output from the focused backend suites; note calling out any still-missing case rather than implying full coverage.

12. `Add /analysis index page and top-level Analysis navigation item.`
    Required evidence: route/page code and navigation entry; focused web tests proving navigation visibility and route reachability; runtime screenshot or E2E proof that the nav leads to the new index.

13. `Add /analysis/unrealized-pnl page with deterministic URL state and route DTO cache reuse.`
    Required evidence: page implementation with cache reuse path identified; unit/integration coverage for URL hydration and URL updates; proof that reload/back/forward preserve the same state.

14. `Add full v1 filter surface: date/range, granularity, markets, accounts, tickers, selection mode, ticker limit, holdings state, reporting currency, provisional toggle, and instrument type when available.`
    Required evidence: visible filter controls and route-state support; focused tests covering filter serialization/hydration; responsive/manual proof that the full filter surface remains usable on desktop and narrow layouts.

15. `Add portfolio-to-ticker decomposition summary and chart.`
    Required evidence: summary/chart component code; focused UI tests proving rendered totals and empty/loading states; runtime screenshot or E2E assertion that the chart reflects filtered data.

16. `Add purpose-built ranking table with selection controls and analysis columns.`
    Required evidence: ranking table implementation with expected columns; focused tests for sort/order and selection behavior; runtime or E2E proof that row selection drives downstream analysis state.

17. `Add selected ticker comparison chart with configurable line count, selected-line emphasis, and muted unselected lines.`
    Required evidence: chart code honoring default `5` and max `20`; focused tests for line-count limits and selection emphasis state; runtime screenshot showing selected vs muted series treatment.

18. `Add focus scrub interaction with synchronized point detail.`
    Required evidence: interaction code; UI tests where feasible for synchronized detail state; browser-level manual or E2E evidence because scrub behavior is interaction-heavy.

19. `Add selected ticker detail section with cost basis, market value, quantity, P&L, transaction context, and data health.`
    Required evidence: detail-section implementation; focused tests for displayed fields and empty states; runtime evidence proving synchronization with selected ticker and hovered/focused point.

20. `Add restrained chart/ranking transitions, stable loading skeletons, and reduced-motion handling.`
    Required evidence: motion/loading implementation with reduced-motion branch; UI tests for skeleton presence and reduced-motion settings where feasible; manual evidence or screenshot/GIF proving transitions are restrained rather than disruptive.

21. `Make mobile and narrow desktop usable with collapsed filters and table below chart.`
    Required evidence: responsive layout code; browser-level responsive checks at narrow widths; screenshots or E2E assertions showing collapsed filters and table placement without horizontal overflow.

22. `Add compact Unrealized P&L drivers module in Reports.`
    Required evidence: Reports module code; focused tests proving module rendering and data hookup; runtime screenshot or E2E proof that module content links conceptually to the analysis workspace.

23. `Add deep links from Reports summary, holdings/top movers rows, and Dashboard unrealized KPI where route mapping is clean.`
    Required evidence: deep-link wiring in each originating surface that is actually shipped; focused tests or E2E coverage for each source; note any omitted source explicitly if route mapping was not clean enough for v1.

24. `Ensure Reports/Dashboard links and MCP deepLink use the same route-state format.`
    Required evidence: direct parity assertions comparing route serialization across Reports, Dashboard, and MCP; at least one shared helper or single serializer path preferred; focused tests proving equivalent URLs for equivalent state.

25. `Run /aaa to add or update E2E tests covering Analysis navigation, filters, chart selection, focus detail, and Reports deep links.`
    Required evidence: new or updated E2E specs exist; command output from the focused E2E run; explicit note about any `fixme`, skipped, or still-missing flows so this box is not checked prematurely.

## Open Item Resolution Evidence

1. `Finalize exact i18n labels and copy during UI implementation.`
   Required evidence: concrete copy added in the locale dictionaries used by the shipped surface; review pass confirming label consistency across Analysis, Reports, and MCP terminology where shared wording matters.

2. `Confirm instrument type filter quality against available instrument metadata; degrade gracefully if incomplete.`
   Required evidence: metadata audit showing completeness limits by market/source; implementation proof for graceful degradation when metadata is missing; tests covering both available and unavailable metadata cases.

3. `Decide whether user preference persistence ships with the first UI slice or follows after the chart/table shell is stable.`
   Required evidence: explicit implementation decision recorded in docs or handoff; if shipped, code/tests proving preferences are presentation-only and do not replace deterministic URL state; if deferred, the scope doc must leave it open rather than implied complete.

## Current Writer Assessment

- The scope doc is sufficiently specific to gate future checkboxes without rewriting locked scope.
- The highest-risk overclaim areas are API/MCP parity, sold-out ticker behavior, deterministic deep-link parity, and interaction-heavy UI items such as scrub plus responsive filter layout.
- The first future evidence note should be created only after code lands; until then this file is planning guidance, not implementation proof.
