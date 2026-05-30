---
slug: kzo-161
ticket: KZO-161 (158C)
type: technical-design
created: 2026-04-24
status: draft
companion: scope-todo-202604241500-kzo-161-refined.md
---

# Technical Design: KZO-161 — User timeframe customization + card reorder (dnd-kit)

> **Authoritative scope:** `docs/004-notes/kzo-158/scope-todo-202604241500-kzo-161-refined.md`. This design
> document operationalizes it — file inventory, contracts, algorithms, test
> matrix, risk table. The scope-todo wins on any conflict.

> Consumed by: Fullstack Implementer, Senior QA, Code Reviewer, Validator. Briefing
> references in the Dispatcher's task descriptions point at specific sections
> below (design table, contracts, test matrix).

---

## 0. Locked decisions carried forward (⚡)

Every ⚡ decision from the scope-todo is load-bearing for this design. The
design restates them here so reviewers have a single canonical list:

1. Drop `RouteHeroPanel` range pill row. `PortfolioTrendCard` is the sole pill
   surface.
2. Gear icon only on `PortfolioTrendCard` header. **No** `···` button.
3. `ActionCenterSection` renders **below** SortableContext as a full-width fixed card.
4. Display tab has two sections (Timeframes + Layout), both render unconditionally.
5. Spike failure → drop `@dnd-kit/*` dep, ↑↓ buttons everywhere, admin stays
   as-is (F4a dropped), F4 popover + F5 cards get ↑↓ affordances.
6. Popover reads **effective** list, not raw stored list.
7. Optimistic rollback baseline = last **server-confirmed** state.
8. Refetch effective-ranges on F4 save; snap `performanceRange` to `[0]` if
   out-of-list.
9. `DASHBOARD_CARDS = [{slug, fullWidth}]` — metadata only, no Component
   reference; inline slug switch in AppShell.
10. `<SortableRangeList>` is the single shared primitive for F4 popover + F4a admin.
11. Drop `[timeframe-H]` entirely.
12. Update `[timeframe-K]` to assert pills on `PortfolioTrendCard` only.
13. `TouchSensor` 250 ms activation delay + mobile toast.
14. Keep `dashboard-performance-range-{range}` testid; add new `timeframe-*`
    testids only for popover.
15. Build `<SortableCardGrid>` page-agnostic; wire dashboard only.

---

## 1. Design table (slices, layers, E2E coverage)

Per the `role-definitions.md` UI-gate rule, every UI slice has a non-empty E2E
coverage cell.

| # | Slice | Layers | Key behaviors | E2E coverage |
|---|---|---|---|---|
| 0 | **dnd-kit × Playwright spike** | React, Playwright | `locator.dragTo()` moves item; if not → `mouse.down/move/up` workaround; assert `onDragEnd` fires | Spike fixture — `apps/web/tests/e2e/specs/_spike/dnd-kit-spike.spec.ts` (dev-only, deleted after green) |
| 1 | **Dep install + build gate** | package.json | Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` to `apps/web/package.json` | N/A — no UI |
| 2 | **API schema extension — `cardOrder` key** | Fastify, zod, Postgres | Extend `userPreferencePatchSchema` in `registerRoutes.ts:1933` with `cardOrder?: z.object({ dashboard: z.array(z.string()).max(50) }).nullable().optional()` | N/A — covered by new HTTP spec `user-preferences-card-order-aaa.http.spec.ts` in suite 8 |
| 3 | **Effective-ranges hook extraction** | React hook | Lift `AppShell.tsx:205-222` effect into `useEffectiveRanges()` with `{ effectiveRanges, refetch }` | Covered via F4 E2E (refetch path) |
| 4 | **F4 gear icon + popover** | React, CSS, i18n | Gear button opens `<CustomizeRangesPopover>` anchored above `PortfolioTrendCard`. Drag-reorder, toggle, custom input (validated), Save, Reset. Refetch effective-ranges on save; snap range to `[0]` if out-of-list. | `dashboard-timeframe-aaa.spec.ts` — `[timeframe-L]` open → reorder → save → pill order changes + state read-back; `[timeframe-M]` toggle off + save → pill absent; `[timeframe-N]` custom range Add + Save; `[timeframe-O]` Reset → pills revert to admin/default; `[timeframe-P]` range-snap: current `5Y` selected → user removes `5Y` → pills render new `[0]` selected. |
| 5 | **F4a admin dnd-kit retrofit** | React | Replace ↑↓ buttons at `AdminSettingsClient.tsx:388-407` with `<SortableRangeList>`. Keep `timeframe-chip-{range}` testid; drop `timeframe-chip-up/-down-{range}`; add `timeframe-drag-handle-{range}`. | `admin-timeframe-defaults-aaa.spec.ts` rewrite — `[timeframe-G]` now uses `dragTo`, state read-back; `[timeframe-H]` dropped. |
| 6 | **Hero pill removal** | React | Remove `AppShell.tsx:1103-1130` hero pill actions block. `RouteHeroPanel.actions` prop stays typed for future use; pass `undefined`. | `[timeframe-K]` updated — `dashboardHeroRangeButton*` assertions deleted; only `dashboardPerformanceRangeButton*` assertions remain. |
| 7 | **F5 canonical card metadata** | TS | Create `apps/web/components/dashboard/cards.ts` with `DASHBOARD_CARDS` (readonly tuple) | Indirect via F5 E2E. |
| 8 | **F5 `<SortableCardGrid>` primitive** | React, dnd-kit | Page-agnostic. Props: `cards`, `orderKey`, `children: (slug) => ReactNode`. Internal: `<DndContext>` with `Pointer+Keyboard+Touch` sensors, `<SortableContext>`, `onDragEnd` → 250 ms debounced PATCH → optimistic rollback → mobile toast. | Covered indirectly via F5 E2E; **unit test** `apps/web/test/components/layout/SortableCardGrid.test.tsx` covers optimistic rollback injection. |
| 9 | **F5 AppShell layout collapse** | React, CSS | Replace `AppShell.tsx:1133-1175` three nested grids + standalone `DividendsSection` with one flat `<SortableCardGrid>`. `RouteHeroPanel` above, `ActionCenterSection` below (full-width). | `card-reorder-aaa.spec.ts` — `[card-A]` drag reorder persists + state read-back; `[card-B]` reset via Display tab → `card_order` null. |
| 10 | **SettingsDrawer Display tab** | React, i18n | 5th tab between (or after) existing tabs. Two sections (Timeframes + Layout). Full-width Reset Layout button. | `[timeframe-Q]` Display tab mobile path uses same `<SortableRangeList>` + Save; `[card-B]` Reset Layout button click. |
| 11 | **i18n keys** | TS dictionaries | en + zh-TW for tab label, section headings, Reset Layout button, popover strings. All string templates, no functions (per `nextjs-i18n-serialization.md`). | Covered via F4/F5 specs reading the rendered labels. |

**UI gate pass:** every UI slice (rows 4-11) has a non-empty E2E coverage cell.

---

## 2. Component inventory

### New files

| Path | Slice | Notes |
|---|---|---|
| `apps/web/components/dashboard/cards.ts` | 7 | `DASHBOARD_CARDS` metadata array. No React imports. |
| `apps/web/components/layout/SortableCardGrid.tsx` | 8 | Page-agnostic sortable grid primitive. |
| `apps/web/components/settings/DisplayTabSection.tsx` | 10 | Display tab body: `<CustomizeRangesPopover>`-inlined + Layout reset. |
| `apps/web/components/settings/CustomizeRangesPopover.tsx` | 4 | Shared surface for gear popover + Display tab inline form. |
| `apps/web/components/settings/SortableRangeList.tsx` | 4, 5 | Shared primitive for F4 popover and F4a admin rows. |
| `apps/web/hooks/useEffectiveRanges.ts` | 3 | Extracted from `AppShell.tsx`. Returns `{ effectiveRanges, refetch }`. |
| `apps/web/hooks/useSortablePreferences.ts` | 8 | Optional helper — debounced PATCH + optimistic rollback machinery. May be inlined in `SortableCardGrid.tsx` if small enough. |
| `apps/web/tests/e2e/specs-oauth/dashboard-timeframe-aaa.spec.ts` | 4 | F4 coverage. |
| `apps/web/tests/e2e/specs-oauth/card-reorder-aaa.spec.ts` | 9 | F5 coverage. |
| `apps/web/tests/e2e/specs/_spike/dnd-kit-spike.spec.ts` | 0 | Dev-only, deleted on green spike or preserved if rescope triggered. |
| `apps/api/test/http/specs/user-preferences-card-order-aaa.http.spec.ts` | 2 | Covers `cardOrder` PATCH acceptance + rejection. |

### Modified files

| Path | Slice | Nature |
|---|---|---|
| `apps/web/package.json` | 1 | Add dnd-kit deps. |
| `apps/api/src/routes/registerRoutes.ts` (`userPreferencePatchSchema`, lines 1933-1939) | 2 | Extend schema. |
| `apps/web/components/layout/AppShell.tsx` | 3, 6, 9 | Hook extraction, hero pill removal, layout collapse. ~40 line net reduction. |
| `apps/web/components/dashboard/PortfolioTrendCard.tsx` | 4 | Add gear icon button on header right. New `onOpenCustomize?: () => void` prop. |
| `apps/web/components/admin/AdminSettingsClient.tsx` (lines 374-411) | 5 | Replace reorder buttons with `<SortableRangeList>`. |
| `apps/web/components/settings/SettingsDrawer.tsx` (tab strip + tab-switch blocks at lines 83-241) | 10 | Add 5th tab + Display tab panel. |
| `apps/web/features/settings/types/settingsUi.ts` (line 39) | 10 | Extend `SettingsTab` union: `"profile" \| "general" \| "fees" \| "tickers" \| "display"`. |
| `apps/web/features/settings/hooks/useSettingsForm.ts` | 10 | Default tab stays `"general"`; `setTab("display")` available. |
| `apps/web/lib/i18n/types.ts` (lines 356+, 414+) + en/zh dict files | 11 | Add `tabDisplay`, `displayTimeframesTitle`, `displayLayoutTitle`, `resetLayoutButton`, popover strings. |
| `apps/web/tests/e2e/specs-oauth/admin-timeframe-defaults-aaa.spec.ts` | 5 | `[timeframe-G]` rewrite, `[timeframe-H]` drop, `[timeframe-K]` assertion update. |
| `libs/test-e2e/src/assistants/layout/AppShellAssert.ts` + sibling `AppShellActions.ts` | 4, 5, 9 | Add assertions for new testids; DROP `dashboardHeroRangeButton*`; DROP `adminTimeframeChipUpButtonIsDisabled/DownButtonIsDisabled`, `clickAdminTimeframeChipDown`; add `dragAdminTimeframeChip`, `openTimeframeCustomize`, `saveTimeframeCustomize`, `resetLayout`, `dragDashboardCard`. |

### Files **not** touched (explicitly out of scope)

- `apps/api/src/services/userPreferences.ts` — backend already handles
  arbitrary top-level keys via JSONB merge. `cardOrder` just needs the PATCH
  zod schema extension.
- Any `apps/api/` service files beyond the single schema extension in
  `registerRoutes.ts` — keep backend surface stable.
- `apps/api/src/routes/` seed endpoint — `POST /__e2e/seed-user-preferences`
  already exists (confirmed at `registerRoutes.ts:1311`, guarded by
  `assertE2ESeedEnabled()`). Do NOT modify its guard.
- `libs/shared-types/src/index.ts` — no new runtime exports anticipated; if
  one is added, follow the barrel-audit rule below.

---

## 3. Pre-flight spike task spec (Task #0)

**Budget:** 2 hours hard. Spike output lives at
`apps/web/tests/e2e/specs/_spike/dnd-kit-spike.spec.ts` + a throwaway
`apps/web/app/_spike/dnd-kit/page.tsx` (dev-only, not routed).

**Stage 1 acceptance (Playwright `locator.dragTo()` path):**
- Build a minimal `<DndContext>` + `<SortableContext>` with 3 text rows, each
  wrapping `useSortable({ id })`. Each row has a drag handle with
  `data-testid="spike-drag-handle-{id}"`.
- The dev page exposes the post-drag order via
  `data-testid="spike-order"` (JSON-stringified array).
- Spike test:
  1. Navigate to `/_spike/dnd-kit`.
  2. `await page.getByTestId("spike-drag-handle-a").dragTo(page.getByTestId("spike-drag-handle-c"))`.
  3. Assert `data-testid=spike-order` renders `["b","c","a"]` or equivalent
     "moved A past B/C" ordering (exact final order depends on dnd-kit's
     `arrayMove` insertion semantics — the assertion captures "A is no longer
     at index 0").
- **PASS** → spike green, Stage 2 skipped. Delete the spike page + spec
  before merging.

**Stage 2 acceptance (mouse.down/move/up workaround):**
- Triggered if Stage 1 does not move the row past `PointerSensor`'s activation
  threshold (5 px default distance, or 250 ms delay per scope lock — need to
  confirm dnd-kit defaults here).
- Replace `locator.dragTo()` with:
  ```ts
  const src = page.getByTestId("spike-drag-handle-a");
  const dst = page.getByTestId("spike-drag-handle-c");
  const srcBox = await src.boundingBox();
  const dstBox = await dst.boundingBox();
  await page.mouse.move(srcBox.x + srcBox.width/2, srcBox.y + srcBox.height/2);
  await page.mouse.down();
  // Multi-step to beat activation threshold
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(
      srcBox.x + srcBox.width/2,
      srcBox.y + srcBox.height/2 + (dstBox.y - srcBox.y) * (i/6),
      { steps: 5 },
    );
  }
  await page.mouse.up();
  ```
- Same assertion on `spike-order`.
- **PASS** → spike green with workaround. Document the workaround as the
  canonical E2E pattern in `apps/web/tests/e2e/specs-oauth/dashboard-timeframe-aaa.spec.ts`
  + `card-reorder-aaa.spec.ts`; either keep the spike spec as a reference
  smoke test or delete it.

**FAIL (both stages):**
- Architect sends `[ESCALATE]` to main session with the rescope proposal per
  scope-todo lines 21-27:
  - Drop `@dnd-kit/*` dep
  - F4a dropped entirely — admin stays on ↑↓ (current state after KZO-159)
  - F4 popover uses ↑↓ rows next to each range
  - F5 cards get ↑↓ buttons in card headers (lose mobile drag; lose polished UX)
- User decision required before Task #1/#2 proceed.

**Out of scope for the spike:**
- The spike does NOT have to cover touch/keyboard sensors. Desktop pointer
  drag is the critical path.
- The spike does NOT have to integrate `<SortableContext>` with AppShell
  layout. A standalone dev page is enough.

---

## 4. `<SortableRangeList>` contract (shared primitive — F4 + F4a)

**File:** `apps/web/components/settings/SortableRangeList.tsx`

```ts
interface SortableRangeRow {
  range: string;        // canonical range token (e.g. "1M", "5Y", "YTD")
  active: boolean;      // visibility toggle state
  disabled?: boolean;   // during save, disables all interactions
}

interface SortableRangeListProps {
  rows: SortableRangeRow[];
  onReorder: (nextOrder: string[]) => void;     // fires with final order after drag end
  onToggleVisibility?: (range: string) => void; // omit in F4a (admin doesn't toggle visibility per row — it uses the separate "Available" chip palette)
  dragHandleTestId: (range: string) => string;  // e.g. `timeframe-drag-handle-${range}`
  rowTestId?: (range: string) => string;        // e.g. `timeframe-customize-row-${range}` (F4 only)
  chipTestId: (range: string) => string;        // e.g. `timeframe-chip-${range}` (shared)
}
```

**Behavior:**
- Wraps rows in `<DndContext>` + `<SortableContext strategy={verticalListSortingStrategy}>`.
- Each row uses `useSortable({ id: range })` with `listeners.drag-handle` attached to the `timeframe-drag-handle-{range}` element.
- Internal sensors: `PointerSensor` + `KeyboardSensor`. **No** `TouchSensor` here — the F5 card grid owns the mobile long-press. F4 popover is a desktop surface; Display tab range section is form-usable on mobile without drag (Save + Reset work; user can edit via toggle + custom-input without reordering on mobile).
- On `onDragEnd`: compute new order via `arrayMove(current, oldIndex, newIndex)` and call `onReorder(nextOrder)`. The parent owns persistence.
- `disabled={true}` on any row kills pointer/keyboard listeners for the whole context (pass through to `useSortable`'s `disabled`).

**F4 popover consumer:** Passes `onToggleVisibility` for per-row on/off.
**F4a admin consumer:** Omits `onToggleVisibility`; admin's toggle is the
separate "Available" chip palette below the sortable list (unchanged from
KZO-159).

---

## 5. `<SortableCardGrid>` contract (page-agnostic primitive)

**File:** `apps/web/components/layout/SortableCardGrid.tsx`

```ts
interface SortableCard {
  slug: string;       // kebab-case, unique within the grid
  fullWidth: boolean; // true → xl:col-span-2
}

interface SortableCardGridProps {
  cards: ReadonlyArray<SortableCard>;  // canonical list from e.g. DASHBOARD_CARDS
  orderKey: string;                    // sub-key under user_preferences.cardOrder (e.g. "dashboard")
  children: (slug: string) => ReactNode; // render-prop, inline slug switch at call site
  // Optional — lets tests inject a handle into the rollback path:
  onPersistFailure?: (error: Error) => void;
}
```

**Internal behavior:**

1. **Initial order resolution on mount:**
   - `GET /user-preferences` → read `preferences.cardOrder?.[orderKey]` (array of slugs).
   - Join with `cards` per the canonical-list ⋈ user-order algorithm (§6).
   - If fetch fails or key absent → fall back to `cards.map(c => c.slug)` (canonical order).
   - Store as `displayOrder: string[]` state + `serverConfirmedOrder: string[]` ref.

2. **Sensors stack:**
   - `PointerSensor` (default activation — 5 px distance).
   - `KeyboardSensor` (arrow keys + space — accessibility baseline).
   - `TouchSensor({ activationConstraint: { delay: 250, tolerance: 5 } })` — 250 ms long-press per scope decision 13.

3. **On drag end:**
   - Compute new order via `arrayMove`.
   - Update `displayOrder` immediately (optimistic UI).
   - Show mobile toast "Card selected — drag to reorder" on TouchSensor
     activation (not drop). Implementation via `onDragStart` + viewport mode
     check.
   - Schedule debounced PATCH (250 ms timer; reset on subsequent drag).

4. **Debounced PATCH:**
   - Body: `{ cardOrder: { [orderKey]: [...slugs] } }`.
   - On success: advance `serverConfirmedOrder` to the just-PATCHed array.
     Do NOT touch `displayOrder`.
   - On failure: set `displayOrder = serverConfirmedOrder`, show error toast,
     call `onPersistFailure?.(err)`.

5. **Grid layout:**
   - Outer wrapper: `className="grid grid-cols-1 xl:grid-cols-2 gap-6 [grid-auto-flow:dense]"`.
   - Each card renders with `className={card.fullWidth ? "xl:col-span-2" : ""}` plus a `data-testid="card-{slug}"` and a drag handle with `data-testid="card-drag-handle-{slug}"`.

6. **Render-prop contract:**
   - `children(slug)` returns the slug's JSX, wired inline in AppShell via a switch on `slug`.
   - The primitive does NOT know about card props — it only provides the drag chrome and order.

**Unit test target (`apps/web/test/components/layout/SortableCardGrid.test.tsx`):**
- Rollback on PATCH failure: mock `fetch` to return 500, simulate drag, assert `displayOrder` restores to prior value after the debounce window fires.
- Multiple drags within debounce coalesce to one PATCH with the final state.
- Keyboard reorder flow (space → arrow keys → space) produces `onDragEnd`.

---

## 6. Canonical-list ⋈ user-order algorithm

Pure function in `apps/web/components/layout/SortableCardGrid.tsx` (or a
sibling helper `mergeCardOrder.ts`):

```ts
function mergeCardOrder(
  canonical: ReadonlyArray<SortableCard>,
  userOrder: ReadonlyArray<string> | null | undefined,
): SortableCard[] {
  if (!userOrder || userOrder.length === 0) return [...canonical];
  const canonicalSlugs = new Set(canonical.map(c => c.slug));
  const userKnown = userOrder.filter(s => canonicalSlugs.has(s));
  const userKnownSet = new Set(userKnown);
  const appended = canonical.filter(c => !userKnownSet.has(c.slug));
  // Reorder canonical cards per user preference, then append any new
  // canonical slugs that the user has never seen (e.g., after a KZO-170
  // adds a sixth card).
  return [
    ...userKnown.map(slug => canonical.find(c => c.slug === slug)!),
    ...appended,
  ];
}
```

**Properties:**
- **Unknown slugs dropped silently.** If `userOrder` has a slug not in
  `canonical` (removed card), it's filtered.
- **New canonical slugs appended.** A new card added to `DASHBOARD_CARDS`
  after a user saved a prior order lands at the end of that user's grid.
- **Idempotent on empty.** `userOrder = null` → canonical order.
- **No migration.** No DB-side rewrite; merge happens at render time.

---

## 7. Effective-ranges hook (`useEffectiveRanges`)

**File:** `apps/web/hooks/useEffectiveRanges.ts`

```ts
export function useEffectiveRanges(): {
  effectiveRanges: DashboardPerformanceRange[];
  refetch: () => void;
} {
  const [effectiveRanges, setEffectiveRanges] = useState<DashboardPerformanceRange[]>(
    () => [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES],
  );
  const refetch = useCallback(() => {
    void getJson<{ ranges: string[]; source: "user" | "admin" | "default" }>(
      "/user-preferences/effective-ranges",
    )
      .then((res) => {
        if (Array.isArray(res?.ranges) && res.ranges.length > 0) {
          setEffectiveRanges(res.ranges);
        }
      })
      .catch(() => { /* silent — keep prior value */ });
  }, []);
  useEffect(() => { refetch(); }, [refetch]);
  return { effectiveRanges, refetch };
}
```

**Integration in `AppShell.tsx`:**
- Replace the `useEffect` at lines 205-222 + the `effectiveRanges` state
  declaration at lines 117-119 with `const { effectiveRanges, refetch: refetchEffectiveRanges } = useEffectiveRanges();`.
- `refetchEffectiveRanges` is passed to the gear popover's save callback and
  also to the Display tab's timeframe save callback.
- No cancellation race — the refetch helper is idempotent; stale responses
  just re-set the same state.

**Range-snap guard:**
- In AppShell, add `useEffect(() => { if (!effectiveRanges.includes(performanceRange)) setPerformanceRange(effectiveRanges[0]); }, [effectiveRanges, performanceRange]);`.
- Runs whenever the effective list updates. First-mount path: if the URL had a
  stale `?range=5Y` and the admin has since removed `5Y`, snap to the new
  `[0]` before the chart can request it (the /dashboard/performance validator
  is now dynamic per KZO-159, so this also avoids the 400 cited in scope-todo
  decision 8).

---

## 8. AppShell layout diff (before / after)

**Before** (current, lines 1059-1176):

```
<div className="stagger grid min-w-0 gap-6">
  <RouteHeroPanel metrics=[...] actions={<div>pills...</div>}/>

  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.22fr)_minmax(0,0.78fr)]">
    <PortfolioTrendCard />
    <AllocationSnapshotCard />
  </div>

  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)]">
    <ReturnPercentCard />
  </div>

  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
    <HoldingsTable />
    <ActionCenterSection />
  </div>

  <DividendsSection />
</div>
```

**After:**

```
<div className="stagger grid min-w-0 gap-6">
  <RouteHeroPanel metrics=[...] actions={undefined} /> {/* pills gone */}

  <SortableCardGrid cards={DASHBOARD_CARDS} orderKey="dashboard">
    {(slug) => {
      switch (slug) {
        case "portfolio-trend":     return <PortfolioTrendCard {...trendProps} onOpenCustomize={() => setCustomizeOpen(true)} />;
        case "allocation-snapshot": return <AllocationSnapshotCard {...allocProps} />;
        case "return-percent":      return <ReturnPercentCard {...returnProps} />;
        case "holdings-table":      return <HoldingsTable {...holdingsProps} />;
        case "dividends-section":   return <DividendsSection {...dividendProps} />;
      }
    }}
  </SortableCardGrid>

  <ActionCenterSection {...actionProps} /> {/* full-width, below grid */}

  {customizeOpen ? <CustomizeRangesPopover anchorTestId="timeframe-gear-btn" onClose={() => setCustomizeOpen(false)} onSaved={refetchEffectiveRanges} /> : null}
</div>
```

**Key structural changes:**
- Hero pill row removed — single pill surface (`PortfolioTrendCard`).
- Five cards become one flat `<SortableCardGrid>`:
  `portfolio-trend`, `allocation-snapshot`, `return-percent` (half-width each,
  `xl:col-span-1`) + `holdings-table`, `dividends-section` (full-width each,
  `xl:col-span-2`). The `[grid-auto-flow:dense]` class packs them tightly.
- `ActionCenterSection` is now a sibling of the grid (not a child) and
  renders as a full-width card below. No wrapping `<div className="grid">`
  needed since it sits at the outer `.stagger.grid.gap-6` level.
- `<CustomizeRangesPopover>` is portaled or fixed-positioned, anchored to the
  gear button. It is NOT a child of the sortable grid — floating it outside
  avoids interaction overlap with `<DndContext>`.

**`xl:col-span-2` mechanics:** Tailwind's `xl:col-span-2` on a cell inside a
`xl:grid-cols-2` grid forces the cell to span both columns. Combined with
`[grid-auto-flow:dense]`, the grid fills gaps left by full-width cards with
smaller siblings. Drag-and-drop reorder preserves this since `fullWidth` is a
static per-card prop.

---

## 9. Display tab anatomy

**Placement in `SettingsDrawer.tsx:83-124`:**

Append the Display tab after `settings-tab-tickers` (5th and last tab):

```tsx
<Button
  type="button"
  variant={form.tab === "display" ? "default" : "secondary"}
  size="sm"
  className={form.tab !== "display" ? "border-transparent bg-transparent shadow-none" : "rounded-full"}
  onClick={() => form.setTab("display")}
  data-testid="settings-tab-display"
>
  {dict.settings.tabDisplay}
</Button>
```

**Tab body (new branch after the existing `form.tab === "tickers"` block, ~line 174):**

```tsx
{form.tab === "display" && (
  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex-1 space-y-6 overflow-y-auto pr-1" data-testid="settings-content-scroll">
      <DisplayTabSection
        effectiveRanges={effectiveRanges}
        onTimeframesSaved={refetchEffectiveRanges}
        onResetLayout={handleResetLayout}
        dict={dict}
      />
    </div>
  </div>
)}
```

**`DisplayTabSection` body:**

```
<section data-testid="display-timeframes-section">
  <h3>{dict.settings.displayTimeframesTitle}</h3>
  <CustomizeRangesForm mode="inline" {...} />
</section>
<section data-testid="display-layout-section">
  <h3>{dict.settings.displayLayoutTitle}</h3>
  <Button data-testid="reset-layout-btn" onClick={onResetLayout}>
    {dict.settings.resetLayoutButton}
  </Button>
</section>
```

**Reset Layout behavior:**
- `handleResetLayout` → `patchJson("/user-preferences", { cardOrder: null })` → success toast. No confirm dialog per scope decision.
- Refresh page? No — `SortableCardGrid` is a live consumer; it should react by
  re-fetching. Simplest: the Reset Layout handler in AppShell triggers a
  small counter / key bump that remounts the grid, or calls a `refetch` on
  `SortableCardGrid` via a ref. Design choice: **remount via key bump.** The
  grid re-fetches its initial order on mount, so `key={`card-grid-${resetCount}`}` on the grid makes the reset path trivial.

**i18n keys (new):**
- `dict.settings.tabDisplay` — "Display" / "顯示"
- `dict.settings.displayTimeframesTitle` — "Dashboard timeframes" / "儀表板時間區段"
- `dict.settings.displayLayoutTitle` — "Layout" / "版面"
- `dict.settings.resetLayoutButton` — "Reset layout" / "重設版面"
- `dict.settings.customizeRangesTitle` — popover heading
- `dict.settings.customizeRangesAddPlaceholder` — "e.g. 5Y, 18M, ALL" (reused from admin)
- All other popover copy (Save, Reset, validation messages) can reuse
  existing admin keys with localized values.

---

## 10. API schema extension — `cardOrder`

**File:** `apps/api/src/routes/registerRoutes.ts`, `userPreferencePatchSchema`
at lines 1933-1939.

**Before:**

```ts
const userPreferencePatchSchema = z
  .object({
    dashboardPerformanceRanges: z
      .union([dashboardPerformanceRangesSchema, z.null()])
      .optional(),
  })
  .strict();
```

**After:**

```ts
const cardOrderSchema = z.object({
  dashboard: z.array(z.string().min(1).max(64)).max(50),
}).strict();

const userPreferencePatchSchema = z
  .object({
    dashboardPerformanceRanges: z
      .union([dashboardPerformanceRangesSchema, z.null()])
      .optional(),
    cardOrder: z
      .union([cardOrderSchema, z.null()])
      .optional(),
  })
  .strict();
```

**Rationale:**
- Key name `cardOrder` — **camelCase** to match `dashboardPerformanceRanges`.
  The scope-todo uses `card_order` in prose; that's a notation inconsistency.
  Backend canonical form is camelCase (JSONB key). Document this explicitly
  for the QA and Technical Writer.
- `{ dashboard: string[] }` sub-object lets future tickets (KZO-162) add
  additional sub-keys (`transactions`, `portfolio`, etc.) without schema
  churn.
- `.max(50)` array length cap protects from accidental payload bloat (the
  8 KiB total body cap already guards but per-field caps are defensive).
- Null clears the key (matches PATCH semantics from KZO-159 transition
  guide: "top-level merge; null deletes key").

**No new persistence changes.** `user_preferences.preferences` is JSONB;
`setUserPreferencePatch` already handles arbitrary top-level keys via
`jsonb_set`. The schema extension is the only backend change.

**HTTP spec coverage:**
- `user-preferences-card-order-aaa.http.spec.ts` (new, suite 8):
  - PATCH with valid `cardOrder` → 200, GET echoes value.
  - PATCH with invalid `cardOrder` shape (not object, array-only) → 400.
  - PATCH with null → 200, GET shows key cleared.
  - PATCH with both `dashboardPerformanceRanges` + `cardOrder` → 200, both applied atomically.

---

## 11. Test matrix (testid → asserting spec)

### Kept (existing, no changes)

| testid | Assertion home | Slice |
|---|---|---|
| `dashboard-performance-range-{range}` | `admin-timeframe-defaults-aaa.spec.ts` ([timeframe-K]) + `dashboard-timeframe-aaa.spec.ts` | 4, 5 |
| `timeframe-chip-{range}` | `admin-timeframe-defaults-aaa.spec.ts` ([timeframe-A,B,C,D,E,F,I,J]) | 5 |
| `timeframe-add-input`, `timeframe-add-button`, `timeframe-save-button`, `timeframe-reset-button`, `timeframe-validation-error`, `timeframe-save-success` | `admin-timeframe-defaults-aaa.spec.ts` | 5 |

### Added (new)

| testid | Asserting spec | Slice |
|---|---|---|
| `timeframe-gear-btn` | `dashboard-timeframe-aaa.spec.ts` | 4 |
| `timeframe-customize-popover` | `dashboard-timeframe-aaa.spec.ts` | 4 |
| `timeframe-customize-row-{range}` | `dashboard-timeframe-aaa.spec.ts` | 4 |
| `timeframe-toggle-{range}` | `dashboard-timeframe-aaa.spec.ts` | 4 |
| `timeframe-drag-handle-{range}` | `dashboard-timeframe-aaa.spec.ts` + `admin-timeframe-defaults-aaa.spec.ts` ([timeframe-G]) | 4, 5 |
| `timeframe-custom-input` | `dashboard-timeframe-aaa.spec.ts` + Display tab subset | 4, 10 |
| `timeframe-add-btn`, `timeframe-save-btn`, `timeframe-reset-btn` | Same as above (new kebab form for popover; admin keeps existing `-button` suffix) | 4, 10 |
| `card-{slug}` (5 slugs) | `card-reorder-aaa.spec.ts` | 9 |
| `card-drag-handle-{slug}` | `card-reorder-aaa.spec.ts` | 9 |
| `settings-tab-display` | `dashboard-timeframe-aaa.spec.ts` (mobile path) | 10 |
| `display-timeframes-section`, `display-layout-section` | same | 10 |
| `reset-layout-btn` | `card-reorder-aaa.spec.ts` ([card-B]) | 10 |

### Dropped (scope-todo decisions 11, 12, 14)

| testid | Reason |
|---|---|
| `timeframe-chip-up-{range}`, `timeframe-chip-down-{range}` | Replaced by drag handle (F4a). Delete `clickAdminTimeframeChipUp/Down` + `adminTimeframeChipUpButtonIsDisabled/DownButtonIsDisabled` in `AppShellActions.ts` + `AppShellAssert.ts`. |
| `dashboard-hero-range-{range}` | Hero pill row removed. Delete `dashboardHeroRangeButton*` assertions from `AppShellAssert.ts` and the two assertions that use them in `[timeframe-K]`. |

### New E2E scenarios

**`dashboard-timeframe-aaa.spec.ts` (specs-oauth, new):**
- `[timeframe-L]` — Open gear → popover shows effective list (admin's, not raw user list). Drag "3M" to bottom → Save → assert pill order on `PortfolioTrendCard` changes + `GET /user-preferences` state read-back.
- `[timeframe-M]` — Open gear → toggle `1M` off → Save → assert `timeframe-chip-1m` no longer in active list; pill row on card drops `1M` button.
- `[timeframe-N]` — Open gear → type `6M` in `timeframe-custom-input` → Add → Save → assert new chip persisted.
- `[timeframe-O]` — Open gear → Reset → assert `dashboardPerformanceRanges: null` via state read-back; popover now shows effective (admin/default) list.
- `[timeframe-P]` — Arrange: admin config is `["1M","3M","YTD","1Y","5Y"]`, user selects `5Y` (URL `?range=5Y`). User opens gear → remove `5Y` → Save → assert `performanceRange` snaps to `1M` (`[0]`), no 400 response.
- `[timeframe-Q]` — (mobile viewport) — Open Display tab → Timeframes section → toggle/save path works without the gear.

**`card-reorder-aaa.spec.ts` (specs-oauth, new):**
- `[card-A]` — Drag `card-drag-handle-holdings-table` above `card-drag-handle-portfolio-trend` → assert `card-{slug}` render order + GET read-back after 300 ms (past debounce window).
- `[card-B]` — Open Display tab → click `reset-layout-btn` → assert `preferences.cardOrder === undefined` (or null) after PATCH round-trip; card order reverts to canonical.
- `[card-C]` — (optional, defer if hard to inject) Optimistic rollback: simulate PATCH 500 via a Playwright request interception → drag → assert after debounce that render order reverts.

**`admin-timeframe-defaults-aaa.spec.ts` (updated):**
- `[timeframe-G]` rewrite: `dragTo(timeframe-drag-handle-1M → position past 3M)`, assert `GET /admin/settings` state read-back instead of DOM order.
- `[timeframe-H]` deleted (no dnd-kit boundary-disabled concept).
- `[timeframe-K]` updated: drop `dashboardHeroRangeButtonIsVisible/Absent(...)` lines; keep only `dashboardPerformanceRangeButtonIsVisible/Absent(...)` block.
- `[timeframe-A,B,C,D,E,F,I,J]`: unchanged.

---

## 12. Precedent pointers (Implementer + QA must read both)

Per `.claude/rules/agent-team-workflow.md`, task descriptions must name
precedents so Implementer and QA converge independently on the same shape.

| Need | Precedent (file + lines) |
|---|---|
| Effective-ranges effect pattern (for hook extraction) | `apps/web/components/layout/AppShell.tsx:201-222` |
| Raw list → chip UI (for popover + admin primitive) | `apps/web/components/admin/AdminSettingsClient.tsx:360-516` |
| PATCH `/user-preferences` shape | `apps/web/components/admin/AdminSettingsClient.tsx:196-248` + `apps/api/src/routes/registerRoutes.ts:1947-1984` |
| Tab strip + conditional body in SettingsDrawer | `apps/web/components/settings/SettingsDrawer.tsx:83-241` |
| AAA assistant/action extension pattern | `libs/test-e2e/src/assistants/layout/AppShellAssert.ts:360-530` |
| `routeError(status, code, msg)` | `apps/api/src/lib/routeError.ts` (pattern; not anticipated for KZO-161 unless a new route is added — none planned) |
| Sliding-window rate limiter registration | `apps/api/src/lib/inviteStatusRateLimit.ts` (reference only — **not** used in KZO-161; patterns kept for scope boundary clarity) |

---

## 13. Rules in play (briefing checklist for Implementer + QA)

Each teammate's task description names the relevant rules. Tier 2 parallel
Phase 1+2 means both Implementer and QA receive this checklist in their own
task.

| Rule | Applies when |
|---|---|
| `nextjs-i18n-serialization.md` | Every i18n key added must be a string template. No functions in dictionary objects. |
| `shared-types-barrel-turbopack.md` | If `libs/shared-types/src/index.ts` gets a new runtime value export (e.g., a shared `cardOrder` schema), audit sibling `export *` siblings. **Likely NOT triggered** — `cardOrderSchema` is backend-only in `registerRoutes.ts`. Flag if this changes. |
| `e2e-seed-vs-reset-guards.md` | The `/__e2e/seed-user-preferences` endpoint already exists. Do NOT change its guard (`assertE2ESeedEnabled()`). New E2E specs consume it as-is. |
| `playwright-oauth-cookie-patterns.md` | New specs live in `specs-oauth/`; use `TestEnv.host` for any session cookie ops. |
| `playwright-request-cookie-jar-isolation.md` | Seed helpers used by `dashboard-timeframe-aaa.spec.ts` + `card-reorder-aaa.spec.ts` must use `withFreshContext(...)` wrappers for any HTTP seed calls — this already exists as a canonical helper in `apps/web/tests/e2e/specs/helpers/sharing.ts`. |
| `e2e-seed-testuser-userid.md` | Any seed call that the UI must observe must pass `testUser.userId` as the owner. |
| `playwright-fast-sse-assertions.md` | Reorder/save flows do NOT emit SSE. Rules retained for reference — if an assertion races with a toast, use the multi-state regex pattern. |
| `full-test-suite.md` | Validator runs all 8 suites. Don't declare done on subset. |
| `implementer-qa-test-ownership.md` | Implementer may update `admin-timeframe-defaults-aaa.spec.ts` strictly for type-compile (e.g. if `AppShellActions.clickAdminTimeframeChipDown` is deleted, any callers compile-break). QA writes all new behavioral tests and the spec's `[timeframe-G]` rewrite. |
| `config-web-env-pattern.md` | Any env access uses `WebEnv`; no `process.env` with fallback strings. Not expected to be hit here (no new env vars). |
| `service-error-pattern.md` | If any new route throws, use `routeError(status, code, msg)`. Not expected (no new routes). |
| `admin-new-subpage-checklist.md` | NOT triggered — Display tab is a new drawer tab, not a new admin subpage. |
| `doc-stale-forward-notes.md` | The KZO-159 transition guide's line "Admin uses simple up/down buttons" becomes stale when F4a retrofit lands. Technical Writer handles in Wave 2 via a new transition guide (does NOT modify the frozen KZO-159 guide). |
| `phased-ticket-scope-completeness.md` | `<SortableCardGrid>` must be genuinely page-agnostic so KZO-162 can wire non-dashboard pages with zero re-implementation. Code Reviewer checklist item. |
| `fastify-eviction-lifecycle-pattern.md` | NOT triggered — no new interval timers / rate limiters. |
| `migration-strategy.md` | NOT triggered — no DB migrations in KZO-161. |
| `agent-team-workflow.md` | Tier 2 parallel Phase 1+2: Dispatcher creates BOTH Task #1 and Task #2 at Phase 1 start. Validator `[GO]` gated on Architect's explicit signal. |

---

## 14. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| dnd-kit × Playwright drag unreliable | Medium | High (rescope) | 2-hour spike gate with rescope plan pre-decided (scope-todo §Pre-flight). |
| Optimistic rollback race on multi-drag | Medium | Medium | Baseline = last server-confirmed state (not pre-drag). All debounced-window drags map to same baseline. Unit test covers. |
| `[grid-auto-flow:dense]` visual regression | Low | Medium | Manual visual validation by Validator (Playwright MCP screenshots). Full-width card placement deterministic. |
| Two `mutation-status` testids rule (`.first()`) | Low | Low | Existing rule `.claude/rules/playwright-duplicate-testid-pattern.md`. Not new — no new duplicate testids introduced. |
| `cardOrder` camelCase vs scope-todo's `card_order` snake_case | Low | Medium | Design locks camelCase. Technical Writer notes the canonical form in the transition guide. |
| Spike spec pollutes full E2E suite | Low | Medium | Spike lives in `specs/_spike/` — excluded from the normal specs glob, or deleted on spike green before merging. |
| `useEffectiveRanges` hook mount re-fetches on every `setPerformanceRange` | Low | Low | Hook uses `useCallback` + `useEffect([refetch])`. Refetch is invoked explicitly, not on every render. |
| AppShell layout collapse breaks AAA page-object selectors | Medium | Low | Testids preserved (`card-{slug}` additive, `dashboard-performance-range-{range}` unchanged). |
| Non-default admin ranges break F4 popover on first mount (race: popover opens before hook hydrates) | Low | Low | Popover reads effective-ranges directly on open — not from AppShell state. Re-fetch on open guarantees fresh list. |
| Backend schema extension breaks existing PATCH callers | Low | Medium | `cardOrder` is optional; existing callers unaffected. HTTP spec covers. |
| Shared-types barrel Turbopack trap (if `cardOrderSchema` is exported from shared-types) | Low | High | Design keeps schema in `registerRoutes.ts` — not shared-types. If later pulled into shared-types, audit sibling `export *` per `shared-types-barrel-turbopack.md`. |
| Scope-todo's F5 renames `DividendsSection` from standalone to grid-child — responsive layout regression | Low | Medium | Manual visual check on mobile (1-col) + xl (2-col) viewports in Validator phase. |

---

## 15. Open items / minor clarifications

- **`cardOrder` naming (camelCase vs snake_case):** Design locks **camelCase**
  (`cardOrder`) to match existing `dashboardPerformanceRanges`. Scope-todo
  prose uses `card_order`; treat as notation typo. Technical Writer flags in
  transition guide.
- **Popover anchor implementation:** `<CustomizeRangesPopover>` is a
  floating element. Implementation can use a minimal `role="dialog"` with a
  click-outside close + ESC-to-close, or a light wrapper around a
  library-less pattern (the repo doesn't yet use Radix/HeadlessUI for
  popovers — check for any existing modal/dialog pattern first). Implementer
  decides during build; scope-grill did NOT lock a specific library.
- **Reset Layout UX:** Current design triggers a key-bump remount of
  `<SortableCardGrid>`. An alternative is a `resetCount` prop bump that
  causes an internal refetch via `useEffect([resetCount])`. Either works;
  Implementer's call.
- **Spike spec glob exclusion:** If the spike spec stays, need to update the
  Playwright `testMatch`/`testIgnore` in `apps/web/tests/e2e/playwright.config.ts`
  to exclude `_spike/` in CI OR delete the spec on spike green. Default:
  delete on green; if preserved, update the config.
- **TouchSensor testing:** Scope-todo confirms mobile TouchSensor E2E is a
  known gap — no `playwright.mobile.config.ts`. Manual verification only,
  documented in transition guide. Desktop-only E2E for reorder is the
  contract.

None of these are blockers. All resolvable at implementation time without
scope re-grill.

---

## 16. Phase plan summary (for Dispatcher briefing)

- **Phase 1 / Task #0 (Fullstack Implementer):** dnd-kit × Playwright spike. 2 h budget. PASS or ESCALATE.
- **Phase 1 / Task #1 (Fullstack Implementer):** Source implementation — slices 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11. `blockedBy: [#0]`.
- **Phase 1 / Task #2 (Senior QA):** Test authoring — all E2E/HTTP specs, AAA assistant/action extensions, unit test for `<SortableCardGrid>`. `blockedBy: [#0]`. Parallel with #1 per Tier 2 protocol.
- **Phase 3:** Validator (all 8 suites) + Code Reviewer (delta vs `dev`) + Architect review. `[GO]` from Dispatcher only after BOTH #1 and #2 completed.
- **Phase 4:** Self-fix routing via Architect triage. Route docs-only findings to Wave 2 per `team-phase-3-triage.md`.
- **Wave 2:** Technical Writer — transition guide at `docs/004-notes/kzo-158/transition-YYYYMMDDHHMM-kzo-161-{slug}.md` covering: gear icon + popover UX, card drag, Display tab, `cardOrder` preference shape, testid registry deltas, spike outcome.

---

## 17. Acceptance

- [ ] Spike gate resolved (PASS one of two stages, or rescope via user decision).
- [ ] All scope-todo checkboxes checked or explicitly scoped out.
- [ ] Full 8-suite gate green: `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`.
- [ ] Code review findings resolved (or deferred to Wave 2 per triage rule).
- [ ] Transition guide written; stale notes in KZO-159 transition guide referenced (frozen; new guide supersedes).

---

## References

- **Scope (authoritative):** `docs/004-notes/kzo-158/scope-todo-202604241500-kzo-161-refined.md`
- **KZO-159 transition (dependency contract):** `docs/004-notes/kzo-158/transition-202604221054-kzo-159-user-prefs-infra.md`
- **Parent scope:** `docs/004-notes/kzo-158/scope-todo-202604221500-initial.md`
- **UI mockup:** `docs/004-notes/kzo-158/kzo-158-ui-mockups.png`
- **Linear:** KZO-161 (this ticket); KZO-162 (follow-up: wire `<SortableCardGrid>` to non-dashboard pages)
