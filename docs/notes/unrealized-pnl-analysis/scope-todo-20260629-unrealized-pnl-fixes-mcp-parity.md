---
slug: unrealized-pnl-fixes-mcp-parity
source: scope-grill
created: 2026-06-29
tickets: []
required_reading:
  - docs/notes/unrealized-pnl-analysis/scope-todo-20260629-unrealized-pnl-analysis.md
  - docs/notes/unrealized-pnl-analysis/evidence-checklist-20260629.md
superseded_by: null
---

# Todo: Unrealized P&L Fixes and MCP Parity

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Add selected-ticker unrealized P&L values to the chart focus scrub.
- Keep selected ticker lines highlighted while non-selected lines remain muted.
- Clarify ticker ranking values as period unrealized P&L change, not current or today's P&L.
- Rename position labels from `Current` / `Sold out` to `Open position` / `Closed position`.
- Rename selected-detail `End P&L` to `Focused P&L` when the focus scrub is active.
- Add a stale-currency guard: show a refresh banner, dim stale chart/summary/ranking/detail UI, and never relabel old values as the newly selected currency.
- Audit every user-facing deep link into `/analysis/unrealized-pnl`.
- Add shared DTO semantic metadata without breaking existing fields.
- Add MCP parity for `get_unrealized_pnl_report`, including semantic metadata, `deepLinkUrl`, and `_meta.deepLinkUrl`.
- Add `analysis-unrealized-pnl` to shared cache invalidation.

## Out of Scope

- Do not add a new historical price-bars MCP tool in this slice.
- Do not implement full price-effect versus transaction-effect attribution.
- Do not perform breaking API, DTO, or MCP field renames.

## Validated Issues

- `apps/web/components/analysis/UnrealizedPnlAnalysisClient.tsx` renders focus scrub interaction without selected ticker P&L values on the chart.
- `apps/web/features/analysis/services/unrealizedPnlService.ts` maps ranking row labels as `Current` / `Sold out`, and the ranking numeric value is period change despite ambiguous copy.
- `apps/api/src/services/unrealizedPnlAnalysis.ts` computes ranking `periodChangeAmount` as end unrealized P&L minus start unrealized P&L and exposes `currentlyHeld`, `isSoldOut`, `endUnrealizedPnlAmount`, and `periodChangeAmount`.
- Analysis route/API/cache paths include reporting currency, but stale response data can be displayed while the UI selector has already moved to another reporting currency.
- Reports and Dashboard summary deep links have some currency coverage, but Dashboard Biggest Movers needs stronger assertion coverage for selection, view, and reporting currency parameters.
- `apps/web/features/portfolio/hooks/useTransactionMutations.ts` and `apps/web/components/layout/useSnapshotGeneration.ts` clear dashboard, portfolio, reports, and transactions caches but not the `analysis-unrealized-pnl` route cache.

## Implementation Steps

- [x] Add shared semantic metadata to `libs/shared-types/src/index.ts`, preserving existing fields:
  - [x] Add a non-breaking position status, e.g. `positionStatus: "open_position" | "closed_position"`, to unrealized P&L ranking rows and ticker series points.
  - [x] Add metric definitions for fields such as `periodChangeAmount`, `endUnrealizedPnlAmount`, `startUnrealizedPnlAmount`, and reporting currency semantics.
- [x] Update `apps/api/src/services/unrealizedPnlAnalysis.ts` to populate the new semantic metadata consistently for API, web, and MCP consumers.
- [x] Update `apps/api/src/mcp/tools.ts` description for `get_unrealized_pnl_report` so connector users understand period change, focused/current snapshot terminology, and open/closed position semantics.
- [x] Update the MCP handler in `apps/api/src/mcp/registerMcpRoutes.ts` so `get_unrealized_pnl_report` returns:
  - [x] Existing relative `deepLink`.
  - [x] Absolute `deepLinkUrl` using `app.appBaseUrl`.
  - [x] `_meta.deepLinkUrl` for connector host metadata.
- [x] Update API/MCP tests:
  - [x] Unit tests for semantic metadata and metric definitions in unrealized P&L analysis output.
  - [x] MCP report tool tests for schema/description acceptance.
  - [x] MCP integration or focused route tests verifying `deepLinkUrl` and `_meta.deepLinkUrl`.
- [x] Update `apps/web/features/analysis/services/unrealizedPnlService.ts`:
  - [x] Use shared position status instead of deriving ambiguous `Current` / `Sold out` labels from booleans.
  - [x] Rename displayed status labels to `Open position` / `Closed position`.
  - [x] Keep ranking value mapped to period change and expose label/copy that says period change clearly.
- [x] Update `apps/web/features/analysis/i18n.ts` for English and zh-TW copy:
  - [x] Open position / Closed position.
  - [x] Period P&L change label.
  - [x] Focused P&L label.
  - [x] Stale reporting-currency refresh banner.
- [x] Update `apps/web/components/analysis/UnrealizedPnlAnalysisClient.tsx`:
  - [x] Show selected ticker unrealized P&L values when the user moves the focus scrub.
  - [x] On desktop, render selected-line callouts without crowding the chart.
  - [x] On mobile, use a compact stacked selected-values treatment when inline labels would crowd.
  - [x] Keep unselected series visually muted while selected series remain emphasized.
  - [x] Show unavailable focus values as `-`.
  - [x] Rename focused detail `End P&L` to `Focused P&L` when focus is active.
- [x] Add stale-currency handling in the analysis data path:
  - [x] Detect when `data.query.reportingCurrency !== state.reportingCurrency`.
  - [x] Keep the old data visible but dim chart, summary, ranking, and detail.
  - [x] Show a banner like `Refreshing values in TWD...`.
  - [x] Do not relabel old values with the newly selected currency.
  - [x] Replace stale data only when a matching response arrives.
- [x] Reuse and harden route DTO cache behavior:
  - [x] Keep reporting currency in the analysis cache key.
  - [x] Avoid writing mismatched-currency payloads to the wrong cache entry.
  - [x] Add `buildRouteDtoCacheTag("route", "analysis-unrealized-pnl")` to shared mutation and snapshot invalidation paths.
- [x] Audit all user-facing `/analysis/unrealized-pnl` deep links:
  - [x] Reports summary link preserves range, market scope, and reporting currency.
  - [x] Reports holding links, desktop and mobile, preserve range, market, ticker, manual selection, ticker-detail view, and reporting currency.
  - [x] Dashboard command module preserves reporting currency.
  - [x] Dashboard Biggest Movers preserves range, market, ticker, manual selection, ticker-detail view, and reporting currency.
  - [x] Analysis index remains a simple unscoped navigation link.
- [x] Update web unit tests:
  - [x] Service mapping tests for new labels, period-change naming, and semantic metadata.
  - [x] Analysis client tests for focus scrub values and stale-currency banner/dimming.
  - [x] Reports and Dashboard tests for all deep-link parameters, especially Biggest Movers.
  - [x] Cache hook tests for rejecting or flagging mismatched reporting currency.
  - [x] Cache invalidation tests for transaction mutation and snapshot-generation route tags.
- [x] Run `/aaa` to add or update E2E tests covering chart focus values, reporting-currency stale guard, and deep-link behavior if existing E2E coverage does not already exercise those user-facing flows.

## Open Items

- [ ] Decide final visual collision behavior for desktop chart callouts during implementation after checking actual rendered spacing.
- [ ] Decide whether MCP host fallback should later support analysis routes beyond `deepLinkUrl`; leave as a note unless connector UX requires a button-level fallback.

## Evidence Update - 2026-06-29

- Implemented shared/API/MCP semantic metadata and absolute MCP deep-link output:
  - `libs/shared-types/src/index.ts`
  - `apps/api/src/services/unrealizedPnlAnalysis.ts`
  - `apps/api/src/mcp/tools.ts`
  - `apps/api/src/mcp/registerMcpRoutes.ts`
- Implemented web labels, focused P&L values, stale-currency guard, cache hardening, and cache invalidation:
  - `apps/web/components/analysis/UnrealizedPnlAnalysisClient.tsx`
  - `apps/web/features/analysis/services/unrealizedPnlService.ts`
  - `apps/web/features/analysis/hooks/useUnrealizedPnlData.ts`
  - `apps/web/features/analysis/i18n.ts`
  - `apps/web/components/layout/useSnapshotGeneration.ts`
  - `apps/web/features/portfolio/hooks/useTransactionMutations.ts`
- Implemented focused test coverage for API/MCP metadata/deepLinkUrl, analysis focus/stale-currency behavior, cache mismatch behavior, and Reports/Dashboard deep links.
- Passed focused backend/API/MCP validation:
  - `cd apps/api && npx vitest run test/unit/unrealizedPnlAnalysis.test.ts test/unit/mcpReportTools.test.ts test/integration/unrealizedPnlAnalysis.integration.test.ts`
- Passed focused web analysis validation:
  - `cd apps/web && npx vitest run test/features/analysis/cacheInvalidation.test.ts test/components/analysis/UnrealizedPnlAnalysisClient.test.tsx test/features/analysis/useUnrealizedPnlData.test.tsx test/features/analysis/unrealizedPnlService.test.ts`
- Passed focused Reports/Dashboard deep-link validation:
  - `cd apps/web && npx vitest run test/components/reports/ReportsClient.test.tsx test/features/dashboard/components.test.tsx`
- Passed focused E2E validation:
  - `npx playwright test tests/e2e/specs/unrealized-pnl-analysis-aaa.spec.ts tests/e2e/specs/mobile-unrealized-pnl-analysis-aaa.spec.ts --config=apps/web/tests/e2e/playwright.config.ts`
  - Result: 3 passed, 1 existing tablet variant skipped.
- Passed broader local gates:
  - `npm run typecheck`
  - `npx eslint .` with 0 errors and 6 pre-existing Playwright conditional warnings in AI connector history specs.
- Passed full eight-suite AGENTS gate:
  - `npx eslint . && npm run typecheck && npm run test:all:full`
  - `npx eslint .`: 0 errors, 6 pre-existing Playwright conditional warnings in AI connector history specs.
  - `npm run typecheck`: passed.
  - Web/unit/package tests, API unit and memory-backed integration, full Postgres integration, bypass E2E, OAuth E2E, and API HTTP all passed.
  - Full Postgres integration: 94 files, 944 passed, 1 skipped.
  - Bypass E2E: 308 passed, 17 skipped.
  - OAuth E2E: 121 passed.
  - API HTTP: 298 passed, 2 skipped.

## References

- Original locked scope: `docs/notes/unrealized-pnl-analysis/scope-todo-20260629-unrealized-pnl-analysis.md`
- Existing evidence checklist: `docs/notes/unrealized-pnl-analysis/evidence-checklist-20260629.md`
- Main web UI file: `apps/web/components/analysis/UnrealizedPnlAnalysisClient.tsx`
- Web mapper/cache: `apps/web/features/analysis/services/unrealizedPnlService.ts`, `apps/web/features/analysis/hooks/useUnrealizedPnlData.ts`
- Shared route state: `apps/web/features/analysis/unrealizedPnlRouteState.ts`
- Backend service: `apps/api/src/services/unrealizedPnlAnalysis.ts`
- MCP definitions and handler: `apps/api/src/mcp/tools.ts`, `apps/api/src/mcp/registerMcpRoutes.ts`
