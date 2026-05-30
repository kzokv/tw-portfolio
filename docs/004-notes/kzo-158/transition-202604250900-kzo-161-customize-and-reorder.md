---
slug: kzo-158
ticket: KZO-161 (158C)
type: transition-guide
created: 2026-04-25
status: final
companion: design-202604241630-kzo-161-initial.md
---

# Transition Guide: KZO-161 (158C) — User Timeframe Customization + Card Reorder

## What shipped

KZO-161 surfaces the user-facing customization UI on top of KZO-159's data plumbing, retrofits the admin reorder control to dnd-kit, and turns the dashboard into a draggable card grid.

| Slice | What shipped |
|---|---|
| **F4 — Timeframe customize popover** | Gear icon (`timeframe-gear-btn`) on `<PortfolioTrendCard>` opens `<CustomizeRangesPopover>` (`apps/web/components/settings/CustomizeRangesPopover.tsx`). Per-row drag-reorder + visibility toggle, custom-range input, Save (`PATCH /user-preferences { dashboardPerformanceRanges }`) and Reset (`PATCH ... { dashboardPerformanceRanges: null }`). Reads the *effective* list on open, not the raw stored list — first-time users see the admin/default list as a starting point. |
| **F4 — Display tab (mobile entry)** | New "Display" tab in `<SettingsDrawer>` (testid `settings-tab-display`). Renders the same customize form inline (variant `"inline"`) plus a "Reset Layout" button. Both sections render unconditionally on every viewport. |
| **F4 — Refetch + range-snap** | `useEffectiveRanges` hook (`apps/web/hooks/useEffectiveRanges.ts`) replaces the inline `useEffect`+`getJson` in AppShell. Exposes `refetch()` so the gear popover and Display tab can refresh the dashboard pills without a remount. AppShell snaps `performanceRange` to `effectiveRanges[0]` if the current range is no longer in the list — prevents `?range=5Y` 400 from the dynamic validator after a user removes 5Y. |
| **F4a — Admin retrofit** | `AdminSettingsClient` "Dashboard Timeframe Defaults" section now uses dnd-kit via the shared `<SortableRangeList>` primitive (`apps/web/components/settings/SortableRangeList.tsx`). The legacy `timeframe-chip-up-{range}` / `timeframe-chip-down-{range}` testids are removed; new `timeframe-drag-handle-{range}` is added. The chip itself stays as the toggle affordance (`timeframe-chip-{range}` testid preserved). |
| **F5 — Card reorder grid** | Five-into-one collapse: the three nested `lg:grid-cols-*` blocks plus the standalone `DividendsSection` are now one flat `<SortableCardGrid>` (`apps/web/components/layout/SortableCardGrid.tsx`). `ActionCenterSection` joined the draggable list as the sixth card (full-width). Canonical metadata in `apps/web/components/dashboard/cards.ts`; render via inline `switch (slug)` in AppShell. |
| **F5 — Persistence** | `PATCH /user-preferences { cardOrder: { dashboard: [...slugs] } }`, debounced 250 ms after `onDragEnd`. Multiple drags within the window coalesce. Optimistic UI rolls back to *last server-confirmed* (not pre-drag) on PATCH failure — a single rollback baseline shared across drags inside a debounce window. |
| **F5 — Reset Layout** | "Reset Layout" button (`reset-layout-btn`) in the new Display tab → Layout section. PATCHes `cardOrder: null` and bumps a `cardLayoutResetCount` key on `<SortableCardGrid>` to force a remount + re-fetch. |
| **API** | `PATCH /user-preferences` schema extended with `cardOrder: { dashboard?: string[] } | null` (cap 50 slugs). Strict outer schema rejects unknown top-level keys (`400 unknown_preference_key`). |
| **Hero pill row removed** | `RouteHeroPanel` no longer renders the duplicate range-pill row; `<PortfolioTrendCard>` is now the sole pill surface. The `dashboardHeroRangeButton*` AAA helpers were removed; tests referencing the dashboard pills assert on `dashboardPerformanceRangeButton*` only. |
| **Tests** | New AAA specs: `card-reorder-aaa.spec.ts` (suite 7), `dashboard-timeframe-aaa.spec.ts` (suite 7), `user-preferences-card-order-aaa.http.spec.ts` (suite 8). Existing `admin-timeframe-defaults-aaa.spec.ts` rewritten — `[timeframe-G]` uses dnd-kit drag, `[timeframe-H]` removed (no boundary-disabled concept in dnd-kit). Unit: `SortableCardGrid.test.tsx` covers `mergeCardOrder`, debounce coalescing, optimistic rollback (last-server-confirmed baseline). All 8 suites green. |

---

## API & UI surface changes for downstream callers

| Symbol | Source | Notes |
|---|---|---|
| `cardOrder` top-level pref key | `PATCH /user-preferences` body | `{ dashboard?: string[] } | null` — JSONB sub-object keyed by page slug. Future pages add their own slugs (`{ transactions: [...], portfolio: [...] }`) without a schema change. Each slug array capped at 50 entries. |
| `DASHBOARD_CARDS` | `apps/web/components/dashboard/cards.ts` | Canonical list `{ slug, fullWidth }[]`. **Adding a card:** append entry here + add a `case` in the AppShell render-prop switch. `mergeCardOrder` appends new slugs at the tail of any saved-order array — no migration. |
| `<SortableCardGrid>` | `apps/web/components/layout/SortableCardGrid.tsx` | Page-agnostic primitive. Props: `cards`, `orderKey`, `children: (slug) => ReactNode`, `onPersistFailure?`, `_debounceMs?` (test-only). Other pages consume by passing different `cards` + `orderKey` + slug switch — no re-implementation of drag mechanics, persistence, rollback, or sensors. |
| `<CustomizeRangesPopover>` | `apps/web/components/settings/CustomizeRangesPopover.tsx` | Two variants: `"popover"` (gear-icon floating panel with backdrop and ESC) and `"inline"` (Display-tab embed). Both share the form body and persistence path. |
| `<SortableRangeList>` | `apps/web/components/settings/SortableRangeList.tsx` | Shared primitive used by F4 popover and F4a admin section. Pointer + Keyboard sensors only (no Touch — F5 owns mobile long-press for cards). Per-row drag handle + chip + optional visibility toggle. |
| `useEffectiveRanges` | `apps/web/hooks/useEffectiveRanges.ts` | `{ effectiveRanges, refetch }` — single fetch on mount + manual refetch hook. Replaces the inline `useEffect` in AppShell. |
| `mergeCardOrder` | `apps/web/components/layout/mergeCardOrder.ts` | Pure function: canonical ⋈ user-saved order. Unknown slugs dropped silently; new canonical slugs appended at the tail; empty/null user-order returns the canonical order. Re-exported from `<SortableCardGrid>`. |
| `timeframe-drag-handle-{range}` testid | `<SortableRangeList>` | Drag handle for both popover and admin. |
| `card-{slug}` / `card-drag-handle-{slug}` testids | `<SortableCardGrid>` | Card root + drag handle for E2E drag and visibility assertions. |
| `settings-tab-display`, `display-timeframes-section`, `display-layout-section`, `reset-layout-btn` | `<SettingsDrawer>` Display tab | Mobile entry surface for F4 + F5 reset. |
| `timeframe-gear-btn`, `timeframe-customize-popover` | `<PortfolioTrendCard>`, `<CustomizeRangesPopover>` | Desktop entry to F4 popover. |

**Removed surfaces:**
- `dashboard-hero-range-{range}` testids — hero pill row deleted.
- `timeframe-chip-up-{range}` / `timeframe-chip-down-{range}` testids — admin retrofit replaced ↑↓ buttons with dnd-kit.
- `dashboardHeroRangeButton*` AAA helpers (assertions and actions).
- `clickAdminTimeframeChipUp` / `clickAdminTimeframeChipDown` AAA actions and matching `*ButtonIsDisabled` assertions.

---

## E2E framework — dnd-kit pointer-release stabilization

`libs/test-e2e/src/assistants/layout/AppShellActions.ts` exports `dndKitDrag(source, target)` — Playwright's `locator.dragTo()` with a follow-up `page.mouse.move(0, 0)`. The post-drop pointer move releases dnd-kit's `PointerSensor` capture before the next click, fixing a ~25% flake rate on tests that click a button after a drag (`[timeframe-G]` was the canonical case). All E2E drag flows in `card-reorder-aaa.spec.ts`, `dashboard-timeframe-aaa.spec.ts`, and the rewritten `[timeframe-G]` go through this helper.

---

## Decisions deferred to follow-ups (no work needed in 161)

| Item | Why | Tracked at |
|---|---|---|
| Wire `<SortableCardGrid>` to non-dashboard pages (transactions section, future multi-card pages) | Build the primitive page-agnostic; per-page wiring + scope-grill happens in a follow-up so each page picks its own cards/layout | KZO-162 (blocked on KZO-161 merge) |
| Mobile TouchSensor + long-press toast E2E | Needs a new `playwright.mobile.config.ts` viewport profile | Carry-forward (manual verification only) |
| Admin-controlled card order | Out of scope per the original 158 grill (Q6) | None |
| Range grammar extensions (`W`, `D`, `QTD`, `SINCE-YYYY-MM-DD`) | Out of scope per the original 158 grill (Q2) | None |
| Card visibility toggle (show/hide individual cards) | F5 is reorder-only per the mockup | None |

---

## Hot-path summary for 158C consumers

**Add a card to the dashboard:**
1. Append `{ slug: "<new-slug>", fullWidth: <bool> }` to `DASHBOARD_CARDS` in `apps/web/components/dashboard/cards.ts`.
2. Add a `case "<new-slug>": return <NewCard ... />;` to the AppShell `<SortableCardGrid>` render-prop switch (`apps/web/components/layout/AppShell.tsx`).
3. No migration needed — `mergeCardOrder` appends the new slug at the tail of any user's saved order.

**Re-style or move the drag handle:**
- Visual: edit `SortableCardCell` and `StaticCardCell` in `SortableCardGrid.tsx`. Default position is `absolute -left-2 -top-2` with `h-7 w-7` so the handle floats outside the card's top-left corner and never overlaps the title/eyebrow.
- Touch behavior: change `activationConstraint: { delay: 250, tolerance: 5 }` on the `TouchSensor` in `SortableCardGrid.tsx`.

**Add a new draggable list to the Display tab:**
- Use `<SortableRangeList>` if the items are simple chip-shaped strings.
- Use `<SortableCardGrid>` if the items are heterogeneous cards with different prop shapes.

---

## Mockup assets

| File | Purpose |
|---|---|
| `mockup-202604221500-kzo-158-umbrella.png` | KZO-158 umbrella mockup (the four-pane fidelity sketch covering F1–F5). Required reading for any 158-series ticket. |
| `mockup-202604241500-kzo-161-ui.png` | KZO-161 close-up render of the dashboard + drawer surfaces with the gear icon, popover, drag handles, and Display tab. |
| `mockup-202604241500-kzo-161-ui.html` | Source HTML for the close-up render (open in a browser to inspect interactively). |
| `mockup-202604241500-kzo-161-render.mjs` | Node script that snapshots the HTML to PNG via Playwright. Re-run if the HTML changes. |

These were promoted from `.worklog/` (ephemeral) on 2026-04-25 so the mockup is durable alongside the design and scope-todo docs.

---

## Cross-references

- Design: `docs/004-notes/kzo-158/design-202604241630-kzo-161-initial.md`
- Scope-todo (refined): `docs/004-notes/kzo-158/scope-todo-202604241500-kzo-161-refined.md`
- Pre-PR review: `docs/004-notes/kzo-158/review-202604241703-kzo-161-pre-pr.md`
- Predecessor transition: `docs/004-notes/kzo-158/transition-202604221054-kzo-159-user-prefs-infra.md`
- Architecture: `docs/001-architecture/web-frontend.md` § "Dashboard Card Layout (KZO-161)"
- Architecture: `docs/001-architecture/backend-db-api.md` § `user_preferences` (KZO-159)
- Linear: KZO-161, KZO-162 (follow-up)
