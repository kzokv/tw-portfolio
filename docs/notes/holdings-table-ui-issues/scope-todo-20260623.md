---
slug: holdings-table-ui-issues
source: scope-grill
created: 2026-06-23
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Holdings Table UI Issues

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Authenticated holdings surfaces only: portfolio holdings, dashboard top holdings, and reports holdings cards.
- Public share holdings is out of scope for this pass.
- Market/account filters persist globally under `holdingsTableSettings.contexts["holdings.shared"]`.
- All authenticated holdings surfaces share one global market/account filter state.
- Persisted filter values are applied only when valid for the current surface.
- Stale or absent persisted filter values are ignored at render time and are not auto-cleaned.
- Market/account filter changes persist immediately.
- Empty filter arrays mean all markets or all accounts.
- Dashboard and reports holdings tables should use holdings-native table markup instead of wrapped shadcn `Table`.
- Sticky headers stick inside each holdings table's own vertical scroll frame.
- Existing sticky first-column behavior must be preserved.
- Portfolio holdings gets a taller internal scroll frame around `max-h-[42rem]`.
- Dashboard and reports keep their current max heights.
- Dashboard top holdings removes dashboard-specific minimum width behavior.
- Column resizing uses the shared holdings column sizing behavior and remains global through `holdings.shared`.
- Extend the existing holdings table settings hook/schema for shared filter persistence rather than adding a separate preference key.
- Done requires focused unit/component tests plus browser-level sticky-header and sticky-first-column verification.

## Implementation Steps

- [x] Extend `HoldingsTableContextPreferenceDto` with `selectedMarketCodes?: string[]` and `selectedAccountIds?: string[]`.
- [x] Extend the holdings table settings Zod schema to accept `selectedMarketCodes` and `selectedAccountIds`.
- [x] Extend the existing holdings table settings hook to hydrate and expose market/account filter arrays from `holdings.shared`.
- [x] Add hook setters that persist market/account filter changes immediately through the existing preference merge/PATCH path.
- [x] Ensure empty persisted arrays represent all markets/all accounts.
- [x] Apply only currently valid persisted market/account selections per surface.
- [x] Leave stale persisted filter values stored until the user changes filters.
- [x] Wire portfolio holdings filters to the shared `holdings.shared` filter state.
- [x] Wire dashboard top holdings filters to the shared `holdings.shared` filter state.
- [x] Wire reports holdings filters to the shared `holdings.shared` filter state.
- [x] Keep report card render/test `contextKey` behavior separate from global filter persistence.
- [x] Convert dashboard holdings table rendering from wrapped shadcn `Table` to holdings-native table markup.
- [x] Convert reports holdings table rendering from wrapped shadcn `Table` to holdings-native table markup.
- [x] Replace portfolio holdings `overflow-y-hidden` frame behavior with a vertical scroll frame around `max-h-[42rem]`.
- [x] Preserve sticky first-column ticker behavior across portfolio, dashboard, and reports holdings tables.
- [x] Remove `DASHBOARD_HOLDINGS_MIN_COLUMN_WIDTHS` and any dashboard-only width minimum enforcement.
- [x] Use shared `holdingsColumnCellStyle`/`settings.getColumnWidth` behavior for dashboard top holdings.
- [x] Add or update unit/component tests for shared filter persistence payloads.
- [x] Add or update unit/component tests for hydration and runtime-valid filter application.
- [x] Add or update unit/component tests proving stale filter values are ignored without auto-cleaning.
- [x] Add or update tests proving dashboard top holdings can shrink columns to the shared holdings floor.
- [x] Run browser-level verification for sticky headers in portfolio, dashboard, and reports holdings tables.
- [x] Run browser-level verification that the first column remains sticky horizontally.

## Open Items

- [ ] Decide later whether public share holdings should also get sticky headers in a separate follow-up.

## References

- Worktree: `/Volumes/My Shared Files/tw-portfolio-worktrees/fix-holdings-table-ui-issues`
- Branch: `codex/fix-holdings-table-ui-issues`
