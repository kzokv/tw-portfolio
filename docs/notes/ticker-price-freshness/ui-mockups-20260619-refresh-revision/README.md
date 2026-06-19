---
slug: ticker-price-freshness-refresh-revision-ui-mockups
created: 2026-06-19
source: codex-ui-mockup
scope:
  - docs/notes/ticker-price-freshness/scope-todo-202606191921-ticker-price-freshness-calendar-activity-refresh-revision.md
---

# UI Mockups: Calendar, Activity, Operations, And Silent Refresh

These mockups visualize the locked refresh revision for ticker price freshness. They are static HTML artboards rendered to PNG screenshots for implementation handoff.

## Files

- Source HTML: `refresh-revision-mockups.html`
- Screenshots:
  - `screenshots/dashboard-market-context-desktop-en.png`
  - `screenshots/dashboard-market-context-desktop-zh-TW.png`
  - `screenshots/admin-calendar-json-import-desktop-en.png`
  - `screenshots/admin-activity-operations-desktop-en.png`
  - `screenshots/mobile-price-refresh-tooltip-zh-TW.png`

## Design Notes

- Dashboard uses one `Market context` card with market-scoped local date, session state, held count, and calendar warnings.
- Activity defaults to all results for the last 24 hours. `Problems only` is a quick filter, not the default.
- Operations keeps raw provider-operation log visibility in a focused detail drawer/panel.
- Calendar import is JSON-paste only, exceptions-only, and shows suggested official source URLs. No parser/adapter UI is shown.
- `Refresh prices` silently updates quote state and metrics in place without page reload, remount, resort, refilter, repage, or scroll jump.
- Changed price/quote values use a subtle flash/pulse treatment and must respect `prefers-reduced-motion`.
- zh-TW copy is included in dashboard and mobile price-chip examples to make i18n coverage explicit.

## Implementation References

- Locked scope: `docs/notes/ticker-price-freshness/scope-todo-202606191921-ticker-price-freshness-calendar-activity-refresh-revision.md`
- Current admin market data UI: `apps/web/components/admin/AdminMarketDataClient.tsx`
- Current dashboard: `apps/web/components/dashboard/DashboardClient.tsx`
- Current portfolio holdings table: `apps/web/components/portfolio/HoldingsTable.tsx`
- Current price chip: `apps/web/components/holdings/PriceStateChip.tsx`
