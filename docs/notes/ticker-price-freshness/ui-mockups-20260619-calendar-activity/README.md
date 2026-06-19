---
slug: ticker-price-freshness-calendar-activity-ui-mockups
created: 2026-06-19
source: codex-ui-mockup
scope:
  - docs/notes/ticker-price-freshness/scope-todo-202606191222-ticker-price-freshness-calendar-activity-revision.md
---

# UI Mockups: Calendar Authority And Activity

These mockups visualize the locked ticker price freshness calendar/activity revision. They are static HTML artboards rendered to PNG screenshots for implementation handoff.

## Files

- Source HTML: `calendar-activity-mockups.html`
- Screenshots:
  - `screenshots/admin-activity-desktop.png`
  - `screenshots/admin-calendar-desktop.png`
  - `screenshots/dashboard-holdings-calendar-warning-desktop.png`
  - `screenshots/admin-activity-mobile.png`
  - `screenshots/price-chip-popover-intraday-mobile.png`

## Design Notes

- `Activity` replaces the old user-facing `Logs` surface.
- Activity is market-scoped and source-filtered, not provider-settings-scoped.
- Activity defaults to warnings/errors for the last 24 hours while still showing success counts in the summary strip.
- Activity uses a summary strip, friendly filters, compact rows, and a details drawer.
- Calendar management is market-first, with years inside each market.
- Calendar import supports configured source preview and pasted normalized JSON.
- Calendar unknown warnings are grouped near holdings price surfaces.
- `Refresh prices` is visually separate from `Refresh closes` and represents enrichment-only refresh.
- Price chip popovers include compact intraday facts and point users to Activity for request history.

## Implementation References

- Locked scope: `docs/notes/ticker-price-freshness/scope-todo-202606191222-ticker-price-freshness-calendar-activity-revision.md`
- Current admin market data UI: `apps/web/components/admin/AdminMarketDataClient.tsx`
- Current price chip: `apps/web/components/holdings/PriceStateChip.tsx`
