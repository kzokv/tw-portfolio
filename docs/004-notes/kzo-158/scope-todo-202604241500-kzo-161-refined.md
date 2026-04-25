---
slug: kzo-161
source: scope-grill
created: 2026-04-24
tickets: [KZO-161]
required_reading:
  - kzo-158-ui-mockups.png
  - docs/004-notes/kzo-158/scope-todo-202604221500-initial.md
  - docs/004-notes/kzo-158/transition-202604221054-kzo-159-user-prefs-infra.md
superseded_by: null
---

# Todo: KZO-161 — User timeframe customization + card reorder (dnd-kit)

> **For agents starting a fresh session:** read every file listed in `required_reading` before starting. This todo supersedes the KZO-158C section of `scope-todo-202604221500-initial.md` — use this file as the authoritative source for KZO-161. Six scope decisions and eight non-critical refinements were locked in a second grill session on 2026-04-24; deltas from the original are marked ⚡.

KZO-161 consumes KZO-159's `user_preferences` infrastructure (table, endpoints, `effectiveDashboardPerformanceRanges`, seed endpoint, `parsePerformanceRange`). All prerequisites are present in `dev`. KZO-159 also shipped the admin "Dashboard Timeframe Defaults" section using ↑↓ arrow buttons; KZO-161 retrofits this to dnd-kit (F4a) once the spike passes.

---

## Pre-flight (FIRST sub-task — halt and rescope on failure)

- [x] **2-hour dnd-kit + Playwright spike.** Build a minimal `<SortableContext>` fixture; prove `locator.dragTo()` produces the expected `onDragEnd` event.
  - **Stage 1**: try `locator.dragTo(target)`. ✅ **PASS** (2026-04-24, KZO-161 Task #0) — single-shot `locator.dragTo()` against a `useSortable()` drag handle moves the row past its neighbor and the post-drop `arrayMove` state update reflects within Playwright's default polling. No distance/delay threshold workaround needed for `PointerSensor` defaults. Canonical F4/F5 spec pattern: `await page.getByTestId("<drag-handle>").dragTo(page.getByTestId("<target-handle>"));` then poll the post-drag state assertion.
  - **Stage 2** (inside the same 2-hour budget): if Stage 1 fails, try `page.mouse.down() → multi-step page.mouse.move() → page.mouse.up()` workaround. — Not exercised; Stage 1 green.
  - **Total failure rescope**: drop dnd-kit dep entirely; ↑↓ arrow buttons everywhere — admin stays as-is (drop F4a), F4 popover gets ↑↓ next to each row, F5 cards get ↑↓ in card headers. Mobile loses long-press drag but ↑↓ works trivially. Card UX degrades but ships. ⚡ Locked rescope plan. — Not triggered.
- [x] If spike passes: add to `apps/web/package.json` — `@dnd-kit/core` ^6.3.1, `@dnd-kit/sortable` ^10.0.0, `@dnd-kit/utilities` ^3.2.2.

---

## F4 — User timeframe customization

### Removal
- [x] ⚡ **Remove the hero range pill row** from `RouteHeroPanel` actions in `AppShell.tsx:1105-1128` entirely. The PortfolioTrendCard's pill row becomes the sole pill surface. Removes the dual-source-of-truth that confused the original design.

### Card-level entry point (desktop)
- [x] ⚡ **Gear icon only** — top-right of `PortfolioTrendCard` header (`hidden lg:inline-flex` or equivalent). **No `···` button after the last pill** — original scope's two-affordance design dropped as redundant.
- [x] Click → opens shared `<CustomizeRangesPopover>` anchored to the gear.

### Popover contents (shared component, used by gear + Display tab)
- [x] Built on top of new `<SortableRangeList>` primitive (extracted as a single component used by both F4 popover and F4a admin section — UI primitive only; storage logic stays separate).
- [x] **Initial state read**: `GET /user-preferences/effective-ranges`. ⚡ Popover **always reads the effective list**, not the raw stored list. First-time users (no `dashboard_performance_ranges` row) see the admin/default list pre-loaded as the editable starting point. Admin-pruned ranges silently disappear from popover view (matches "auto-prune at resolve, never rewrite prefs" contract from KZO-159).
- [x] Per-row drag handle + visibility toggle (per-range on/off).
- [x] Custom-range text input + Add button. Validates against `dashboardPerformanceRangesSchema` from `@tw-portfolio/shared-types`. Inline error on invalid input.
- [x] Save button: explicit, debounced only by user interaction. PATCH `/user-preferences { dashboard_performance_ranges: [list] }`.
- [x] Reset button: PATCH `/user-preferences { dashboard_performance_ranges: null }` (no confirm dialog).
- [x] Min-1 guard: Save disabled when active list is empty (matches admin's KZO-159 guard).

### Mobile entry
- [x] Same popover content rendered inline as a section in the new "Display" tab (see Drawer below). Mobile users have no gear.
- [x] ⚡ Both surfaces render unconditionally; desktop users have two paths (gear + Display tab) — duplication is intentional, no responsive hiding.

### Effective-ranges refetch + range-snap
- [x] ⚡ Lift the existing `useEffect`+`getJson` effective-ranges fetch in `AppShell.tsx` into a hook that exposes both `effectiveRanges` and a `refetch()` callback. **No SWR/Query introduction** (KZO-159 used plain effect; keep the pattern consistent).
- [x] After F4 popover saves successfully → call `refetch()` so the dashboard pills update without remount.
- [x] ⚡ **Range-out-of-list guard**: on `effectiveRanges` update, if the current `performanceRange` is not in the new list, snap to `effectiveRanges[0]`. Prevents `?range=5Y` 400 from the dynamic validator after a user removes 5Y from their list.

---

## F4a — Admin timeframe reorder retrofit

- [x] Replace the ↑ / ↓ arrow buttons at `AdminSettingsClient.tsx:388-407` with a dnd-kit `<SortableContext>` using the shared `<SortableRangeList>` primitive.
- [x] **Keep `timeframe-chip-{range}` testids stable** (referenced by other admin-section tests).
- [x] **Drop the `timeframe-chip-up-{range}` and `timeframe-chip-down-{range}` testids** (no longer rendered).
- [x] Add `timeframe-drag-handle-{range}` testid to each row.
- [x] Save button behavior + min-1 guard + duplicate rejection + custom-range input — all unchanged.

### Admin spec rewrite
- [x] **`apps/web/tests/e2e/specs-oauth/admin-timeframe-defaults-aaa.spec.ts`** — rewrite using `locator.dragTo()` (with mouse.down/move/up workaround if needed):
  - `[timeframe-G]`: rewrite `clickAdminTimeframeChipDown("1M")` → `dragTo` from `timeframe-drag-handle-1M` to a position past the next chip; assert order via `GET /admin/settings` state read-back, not DOM order. ⚡ State-read-back required by F4a contract.
  - `[timeframe-H]`: ⚡ **drop entirely**. dnd-kit has no boundary-disabled-button concept; drag-past-end is implicit no-op. Drag happy-path coverage stays via `[timeframe-G]`.
  - `[timeframe-A,B,C,D,E,F,I,J]`: no changes — they don't exercise the reorder primitive.
  - **Post-merge note (2026-04-25):** `[timeframe-G]` initially flaked ~25% of runs because dnd-kit's `PointerSensor` retained pointer-capture briefly after the drop, intercepting the next click on Save. Fixed by adding `page.mouse.move(0, 0)` after `dragTo` inside the shared `dndKitDrag(...)` helper in `libs/test-e2e/src/assistants/layout/AppShellActions.ts`. All E2E drag flows go through this helper, so the fix also benefits `[card-A]` and `[card-B]`.

---

## F5 — Card reorder (dnd-kit)

### Canonical metadata
- [x] Create `apps/web/components/dashboard/cards.ts`:
  ```ts
  export const DASHBOARD_CARDS = [
    { slug: "portfolio-trend",     fullWidth: false },
    { slug: "allocation-snapshot", fullWidth: false },
    { slug: "return-percent",      fullWidth: false },
    { slug: "holdings-table",      fullWidth: true  },
    { slug: "dividends-section",   fullWidth: true  },
    { slug: "action-center",       fullWidth: true  }, // ⚡ added post-merge — see "Fixed cards" deviation below
  ] as const;
  ```
- [x] ⚡ **Metadata only — no Component reference, no render-prop indirection.** Heterogeneous card props (PortfolioTrendCard wants data/range/dict, AllocationSnapshotCard wants holdings/dict, etc.) get wired inline in AppShell via a slug switch.

### Generic primitive (page-agnostic, dashboard-only consumer for KZO-161)
- [x] ⚡ Create `apps/web/components/layout/SortableCardGrid.tsx` — **page-agnostic** sortable grid primitive. Props:
  - `cards: ReadonlyArray<{ slug: string; fullWidth: boolean }>` — canonical metadata
  - `orderKey: string` — `user_preferences.card_order` sub-key (e.g. `"dashboard"`)
  - `children: (slug: string) => ReactNode` — render-prop for the JSX of each slug (keeps prop wiring inline at the call site)
  - Internally handles: `<SortableContext>`, `<DndContext>` with `PointerSensor` + `KeyboardSensor` + `TouchSensor` (250ms delay), `onDragEnd` → debounced PATCH → optimistic rollback → mobile toast.
- [x] ⚡ KZO-161 wires this primitive **only** to the dashboard via `DASHBOARD_CARDS`. Other pages (Transactions section, future multi-card pages) consume the primitive in a follow-up ticket — see Out of scope below.
- [x] Why C (build generically, wire dashboard only) over A (dashboard-only ad-hoc): zero marginal cost to factor the dnd-kit wiring out of the dashboard call site, and the follow-up ticket only needs to add `<SortableCardGrid cards={...} orderKey="...">` plus a slug switch — no re-implementation of drag mechanics, persistence, rollback, or mobile sensor.

### Layout collapse
- [x] **Refactor `AppShell.tsx:1133-1175`** — collapse the three nested grids (`1.22fr/0.78fr`, `1fr`, `1.08fr/0.92fr`) AND the standalone `DividendsSection` (line 1175) into one flat `<SortableContext>`.
- [x] Grid: `grid grid-cols-1 xl:grid-cols-2 gap-6 [grid-auto-flow:dense]`.
- [x] Full-width cards (`HoldingsTable`, `DividendsSection`) render with `xl:col-span-2`.
- [x] **Render order**: canonical `DASHBOARD_CARDS` ⋈ `user_preferences.preferences.card_order.dashboard`. Unknown slugs dropped silently; new canonical slugs appended at end. No migration when canonical list changes.

### Fixed cards (outside SortableContext)
- [x] `RouteHeroPanel` stays **above** the SortableContext, unchanged.
- [x] ⚡ `ActionCenterSection` renders **below** the SortableContext as a single full-width fixed card. (Today it's nested with HoldingsTable; the half-width slot disappears once HoldingsTable becomes full-width.)
  - **Post-merge deviation (2026-04-25):** ActionCenterSection was promoted from "fixed below the grid" to "draggable inside the grid" per a user direction. It now renders as the sixth `DASHBOARD_CARDS` entry (`{ slug: "action-center", fullWidth: true }`) and gets a `card-drag-handle-action-center` like every other card. `RouteHeroPanel` remains the only fixed surface above the grid; nothing renders below.

### Drag interaction
- [x] **Desktop**: `⠿` drag handle top-left of each draggable card header. Testid `card-drag-handle-{slug}`.
  - **Post-merge polish (2026-04-25):** Original implementation placed the handle at `absolute left-3 top-3 h-8 w-8`, which overlapped the card's eyebrow/heading text. Repositioned to `absolute -left-2 -top-2 h-7 w-7` so the handle floats slightly outside the card's top-left corner and never covers content.
- [x] **Mobile**: `TouchSensor` with ⚡ **250ms long-press activation delay**. On activation: toast "Card selected — drag to reorder".
- [x] Each card root gets testid `card-{slug}`.

### Persistence
- [x] PATCH `/user-preferences { card_order: { dashboard: [...slugs] } }` debounced 250ms after `onDragEnd`. Multiple drags within window coalesce to one PATCH with final state.
- [x] **Optimistic UI**: ⚡ snapshot the **last server-confirmed state** (not pre-drag). Multiple drags within debounce all map back to the same baseline on PATCH failure. Server confirmation advances the snapshot. Restore baseline + show error toast on failure.

### Reset
- [x] "Reset Layout" button (testid `reset-layout-btn`) in the new Display tab → Layout section. PATCH `/user-preferences { card_order: null }`. No confirm.

---

## SettingsDrawer — new "Display" tab

- [x] ⚡ Add a fifth tab to `SettingsDrawer.tsx:83-124` between (or after — placement TBD by visual fit) the existing tabs. Testid `settings-tab-display`.
- [x] Two sections rendered always (mobile + desktop):
  - `display-timeframes-section`: full Customize Ranges UI inlined (same `<SortableRangeList>` + custom input + Save / Reset as the popover).
  - `display-layout-section`: `<button data-testid="reset-layout-btn">` with confirmation-free PATCH on click.
- [x] New i18n keys for tab label, section headings, and the Reset Layout button (en + zh-TW).

---

## Test updates

### New AAA specs (run `/aaa`)
- [x] **`dashboard-timeframe-aaa.spec.ts`** (desktop-only) — covers F4 gear → popover open, drag-reorder, toggle off + Save, custom range Add + Save, Reset, refetch + range-snap behavior. Assert state via `GET /user-preferences` read-back. Use `POST /__e2e/seed-user-preferences` for fixture setup.
- [x] **`card-reorder-aaa.spec.ts`** (desktop-only) — covers F5 drag handle → reorder → debounced PATCH → state read-back. Reset Layout button → state cleared. Optimistic rollback on injected PATCH failure (if feasible to inject; otherwise skip optimistic rollback E2E and rely on unit test).

### Updates to existing specs
- [x] **`admin-timeframe-defaults-aaa.spec.ts`**: rewrite `[timeframe-G]` per F4a; drop `[timeframe-H]` (per F4a).
- [x] **`[timeframe-K]` (HIGH-1 regression)**: ⚡ update assertions to expect range pills only on `PortfolioTrendCard` surface. Drop `dashboard-hero-range-{range}` assertions — those testids no longer exist after the hero pill removal in F4.

### Mobile coverage
- [x] Mobile `TouchSensor` + long-press toast: **manual verification only, no E2E**. Documented as a known gap (carry-forward from initial scope).

### Pre-PR
- [x] `/code-reviewer` → fix findings → full 8-suite gate: `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`. **All 8 suites green** (suites 1+2 + suite 3 web 278/278 + suite 4 API 686/686 + suite 5 integration 457/457 + suite 6 bypass E2E 177/177 + suite 7 OAuth E2E 77/77 + suite 8 HTTP 122/122).

---

## Testid registry (additive — existing testids preserved)

**Existing — keep unchanged**:
- `dashboard-performance-range-{range}` (PortfolioTrendCard pills) — `[timeframe-K]` regression depends on this.
- `timeframe-chip-{range}` (admin) — F4a keeps stable; only the up/down testids are dropped.

**New for F4 popover / Display tab**:
- `timeframe-gear-btn` (gear icon on PortfolioTrendCard)
- `timeframe-customize-popover` (popover root)
- `timeframe-customize-row-{range}` (each row inside popover)
- `timeframe-toggle-{range}` (per-row visibility toggle)
- `timeframe-drag-handle-{range}` (per-row drag handle — used by both popover and admin)
- `timeframe-custom-input`, `timeframe-add-btn`, `timeframe-save-btn`, `timeframe-reset-btn`

**New for F5 cards**:
- `card-{slug}` (each draggable card root)
- `card-drag-handle-{slug}` (each card's drag handle)

**New for Display tab**:
- `settings-tab-display`, `display-timeframes-section`, `display-layout-section`, `reset-layout-btn`

---

## Out of scope (carry-forward, no new tickets)

- Mobile TouchSensor + long-press toast E2E — requires a new `playwright.mobile.config.ts`. Not scoped here.
- Admin-controlled card order — explicitly out of scope per the original 158 grill (Q6).
- Range grammar extensions (`W`, `D`, `QTD`, `SINCE-YYYY-MM-DD`) — out of scope per the original 158 grill (Q2).
- Card visibility toggle (show/hide cards entirely) — F5 is reorder-only. Mockup confirms.

## Out of scope (follow-up Linear ticket created)

- **Wire `<SortableCardGrid>` to non-dashboard pages** — Transactions section + any future multi-card pages. KZO-161 ships the primitive page-agnostic; the wiring + per-page scope-grill (which pages, what cards are draggable, layout decisions) lives in the follow-up ticket. See ticket reference in `## References`.

---

## Deltas from `scope-todo-202604221500-initial.md` (KZO-158C section)

| ⚡ | Change | Reason |
|---|---|---|
| 1 | Drop hero row range pills | Single source of truth; removes confusion from two un-customizable pill rows. |
| 2 | Drop `···` button after last pill | Redundant with gear; ambiguous icon; not in mockup. |
| 3 | ActionCenterSection placement = below SortableContext | HoldingsTable becoming full-width destroys ActionCenter's current half-width slot; "below" matches utility-panel mental model. |
| 4 | "Display" tab anatomy = single new tab with Timeframes + Layout sections | Cleaner than stuffing into General; both sections render always (no responsive hiding). |
| 5 | Spike rescope plan = workaround → ↑↓ everywhere | Original scope said "halt and rescope" without a plan. Now decided. |
| 6 | Popover reads effective list, not raw | First-time UX needs a starting point; admin-pruned ghost ranges confuse. |
| 7 | Snapshot policy = last server-confirmed state, not pre-drag | Multiple drags within debounce need a single rollback baseline. |
| 8 | Refetch effective-ranges on F4 save + snap performanceRange to [0] if invalid | Original scope didn't address stale dashboard pills or 400-on-stale-range. |
| 9 | DASHBOARD_CARDS = `{ slug, fullWidth }` only, no Component reference | Heterogeneous card props can't be uniformly threaded; inline switch is simpler. |
| 10 | `<SortableRangeList>` primitive shared by F4 popover + F4a admin | Single drag implementation; less surface to test. |
| 11 | Drop `[timeframe-H]` test entirely | No dnd-kit equivalent for boundary-disabled buttons. |
| 12 | Update `[timeframe-K]` to assert only PortfolioTrendCard surface | Hero pills gone; old assertion would fail. |
| 13 | TouchSensor delay = 250ms | Standard dnd-kit mobile recommendation. |
| 14 | Testids: keep `dashboard-performance-range-{range}`; add `timeframe-*` for popover only | Original scope's `timeframe-pill-{range}` would conflict with regression test. |
| 15 | Build `<SortableCardGrid>` page-agnostic; wire only to dashboard here. Other pages handled in KZO-162. | Decision C from post-lock follow-up question. Zero marginal cost to factor primitive out; future ticket only adds wire-up not mechanics. |

---

## References

- **Linear**: KZO-161 — https://linear.app/kzokv/issue/KZO-161/
- **Follow-up**: KZO-162 (extend `<SortableCardGrid>` primitive to non-dashboard pages) — https://linear.app/kzokv/issue/KZO-162/ — blocked on KZO-161
- **Parent**: KZO-158 (umbrella), KZO-159 (158A — shipped), KZO-160 (158B — in-flight)
- **Mockup (required reading)**: `kzo-158-ui-mockups.png` (repo root, uncommitted)
- **KZO-159 transition guide (dependency contract)**: `docs/004-notes/kzo-158/transition-202604221054-kzo-159-user-prefs-infra.md`
- **Initial 158 scope (superseded for KZO-161 by this file)**: `docs/004-notes/kzo-158/scope-todo-202604221500-initial.md`
- **Rules in play**: `playwright-request-cookie-jar-isolation.md`, `e2e-seed-vs-reset-guards.md`, `nextjs-i18n-serialization.md`, `service-error-pattern.md`, `full-test-suite.md`, `agent-team-workflow.md`
