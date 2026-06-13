---
slug: mobile-holdings-reports-ui
source: scope-grill
created: 2026-06-13
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Mobile Holdings And Reports UI

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Implementation Steps
- [x] Convert mobile-only single-choice horizontal controls to dropdowns for holdings preset chips, Reports Performance Trend timeline, Portfolio Holdings display/allocation controls, ticker sub-tabs, and ticker chart range/timeline controls.
- [x] Keep admin/settings/sharing/chat/dividends controls and true data tables out of scope.
- [x] Apply responsive cleanup to the reported Dashboard, Portfolio, Reports, and Ticker UI issues so iPhone 12 Pro width has no page-level horizontal overflow in the named cards.
- [x] Wire holdings column settings into desktop tables and the primary mobile card summary/details rendering paths.
- [x] Keep ticker/name/market identity in the mobile card header outside the configurable column count.
- [x] Add per-context mobile summary count to existing Columns settings with default `5`, minimum `1`, and maximum derived from supported mobile data columns for that context.
- [x] Render the first `N` visible supported data columns in each mobile card summary.
- [x] Render remaining visible supported columns first in Details, followed by existing extra detail context where present.
- [x] Support every visible non-identity/non-action column on mobile where feasible.
- [x] Wrap long names/account strings, and truncate only dense chart/compact labels with accessible full values.
- [x] Add or update focused component/unit coverage for mobile column settings and summary/details behavior where useful.
- [x] Add or update focused mobile E2E/browser validation for column reorder, dropdown controls, and no page-level horizontal overflow on reported pages.
- [x] Run focused relevant checks, including `npm run typecheck` if feasible; do not claim full-suite clean unless all eight repo suites run.
- [x] Update E2E coverage for the flows agreed in this scope session.

## Review Status
- [x] Code review completed after implementation.
- [x] Docs updated after review to separate implemented behavior from remaining correctness gaps.
- [x] Durable rule promoted for mobile holdings column-settings behavior.
- [x] Review findings fixed: mobile card headers and Details now honor hidden configurable columns, and Reports Details no longer duplicates column-driven rows.

## Open Items
- [x] Filter mobile Details hardcoded metric rows by visible column settings so hidden configurable columns do not leak back into Dashboard, Portfolio, or Reports mobile cards.
- [x] Remove duplicate Reports Details rows when a field is already rendered through the column-driven `detailColumns` path.
- [x] Decide whether data-health badges are structural status context or configurable column content; data health now follows the configurable health column on mobile cards/details.
- [x] Add focused coverage that hides and reorders a mobile-supported column, then asserts mobile summary and Details both honor the saved preference.

## Validation
- [x] `npm run typecheck`
- [x] `npx vitest run test/features/dashboard/components.test.tsx test/components/portfolio/HoldingsTable.test.tsx test/components/reports/ReportsClient.test.tsx --silent --reporter=verbose` from `apps/web`
- [x] `WEB_PORT=3010 API_PORT=4010 NEXT_PUBLIC_API_BASE_URL=http://localhost:4010 npm run test:e2e:bypass:mem --prefix apps/web -- --project=chromium-mobile specs/mobile-redesign-fit-aaa.spec.ts`

## References
- Scope debate note: none.
- Linear tickets: none.
