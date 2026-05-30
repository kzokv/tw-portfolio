---
slug: ui-reshape-phase-6
source: scope-grill
created: 2026-05-17
tickets: []
required_reading:
  - docs/004-notes/ui-reshape-shadcn/design-202605151200-locked-scope.md
  - docs/004-notes/ui-reshape-shadcn/scope-todo-202605151201-phases.md
superseded_by: null
---

# Todo: Phase 6 — Charts on shadcn `chart` recipe

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. This scope-todo supersedes the Phase 6 section of `scope-todo-202605151201-phases.md` (which under-scoped the work — "~5 files, 1 commit" — and missed one consumer; corrected per scope-grill session 2026-05-17).

## Locked scope summary

The original Phase 6 deliverables targeted "PortfolioTrendCard, AllocationSnapshotCard, any other Recharts consumers." The grill surfaced two corrections:

1. **Only one file actually uses Recharts:** `DividendReviewCharts.tsx`. The two named cards (PortfolioTrendCard, AllocationSnapshotCard) are hand-rolled — inline SVG and CSS conic-gradient respectively.
2. **A fourth chart was missed entirely:** `ReturnPercentCard.tsx` — hand-rolled SVG, dashboard hot path, queried by `DashboardPage.ts:71,95`.

Total chart inventory under the locked scope: **4 files / 6 visual chart components**:

| File | Style | Series | LOC |
|---|---|---|---|
| `apps/web/components/dividends/DividendReviewCharts.tsx` | Recharts (already v3) | 3 sub-charts × multi-currency | 401 |
| `apps/web/components/dashboard/PortfolioTrendCard.tsx` | inline SVG | 3 (marketValue, totalCost, totalReturn) | 375 |
| `apps/web/components/dashboard/ReturnPercentCard.tsx` | inline SVG | 1 (return %) | 229 |
| `apps/web/components/dashboard/AllocationSnapshotCard.tsx` | CSS conic-gradient donut | 6 categorical | 103 |

### Locked decisions (7)

1. **Scope** — Option B: full unification of all four chart files to shadcn `<ChartContainer>` wrapping Recharts v3. ~10–15 files touched (charts + page objects + tests + tokens), comparable to Phase 4 in size and risk.
2. **Palette** — A3: semantic tokens for trend + dividend charts; numbered palette for the donut. Light + dark variants in `globals.css`.
   - Trend: `--chart-primary` (= follows `--primary` / accent), `--chart-muted` (neutral baseline), `--chart-positive` (success/green).
   - Dividend: `--chart-expected` (sky family), `--chart-received` (green family).
   - Donut: `--chart-1` … `--chart-6` (categorical; mirror current `DONUT_COLORS` identity in light, pick high-contrast equivalents in dark).
3. **Fidelity** — B3 selective:
   - **Preserve** PortfolioTrendCard's latest-point peak markers (three colored circles at rightmost data point) AND linearGradient area-fill (`0.28 → 0.04` opacity stop for `marketValueArea`).
   - **Preserve** ReturnPercentCard's latest-point marker (single dot at rightmost point).
   - **Accept defaults** for DividendReviewCharts tooltip/legend rendering (review screens; functional behavior still preserved — see #6).
   - **Accept defaults** for AllocationSnapshotCard pie animation; donut-hole center-label overlay div preserved.
4. **Commit slicing** — C2 (refined): **5 commits**.
   - C1 substrate (recipe + tokens; no call-site changes).
   - C2 DividendReviewCharts.
   - C3 PortfolioTrendCard + ReturnPercentCard (bundled — structurally identical skeleton; one Implementer pass).
   - C4 AllocationSnapshotCard.
   - C5 (optional) cleanup sweep.
5. **Testid contract** — D1: lift testids to outer `<ChartContainer>` wrapper (matches Phase 4's `<DataTable>` precedent). `dashboard-allocation-card` testid stays on outer `<Card>` unchanged. Page-object updates lockstep per commit.
6. **Bespoke behavior preservation** — E1:
   - DividendReviewCharts: preserve `dimmed: Set<string>` state and legend-click-to-dim behavior via native Recharts `<Legend onClick={handleLegendClick}>` inside `<ChartContainer>`.
   - PortfolioTrendCard + ReturnPercentCard: preserve `role="img"` + `aria-label={dict.dashboardHome.performanceTitle}` on outer `<ChartContainer>` wrapper.
   - `chart-currency-selector` `<select>` in DividendReviewCharts survives unchanged (outside chart proper).
7. **ReturnPercentCard inclusion** — G1: bundled into C3 with PortfolioTrendCard. Library migration preferred; tokenize-only is fallback if migration hits a snag mid-implementation.

### Verification gate per commit

| Commit | Lint | Typecheck | Web vitest | API vitest | PG integration | Suite 6 | Suite 7 | Suite 8 |
|---|---|---|---|---|---|---|---|---|
| C1 substrate | ✓ | ✓ | ✓ | – | – | – | – | – |
| C2 DividendReviewCharts | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | – |
| C3 Trend + ReturnPercent | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | ✓ |
| C4 Allocation donut | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | – |

Branch-final must pass the full 8-suite gate before merge (Phase 4 precedent; per `.claude/rules/full-test-suite.md`).

---

## Implementation steps

### C1 — Chart substrate (Phase 6a)

`feat(web): chart substrate — install shadcn chart + add chart tokens (Phase 6a)`

- [x] `npx shadcn@latest add -c apps/web chart` → emits `apps/web/components/ui/shadcn/chart.tsx`.
- [x] Confirm shadcn `chart` recipe is on Recharts v3 (verified during scope-grill via shadcn docs).
- [x] No `react-is` override needed (`apps/web/package.json` pins React `18.3.1`; override only applies to React 19).
- [x] Add to `apps/web/app/globals.css` `:root` block (light values):
  - `--chart-primary`, `--chart-muted`, `--chart-positive` (semantic — trend)
  - `--chart-expected`, `--chart-received` (semantic — dividend review)
  - `--chart-1` through `--chart-6` (categorical — donut)
- [x] Mirror in `.dark` block. Each token must have ≥4.5:1 contrast against `--background` in its respective theme; verify manually before committing.
- [x] Verify gate: `npx eslint .`, `npm run typecheck`, `npm run test --prefix apps/web`. No E2E required at this stage — no call-site changes yet.

### C2 — DividendReviewCharts migration (Phase 6b)

`feat(web): migrate DividendReviewCharts to ChartContainer (Phase 6b)`

- [x] Wrap each of `MonthlyBarChart`, `AccumulatedAreaChart`, `ByTickerBarChart` in `<ChartContainer config={chartConfig}>`.
- [x] Move testids `monthly-bar-chart`, `accumulated-area-chart`, `by-ticker-bar-chart` to outer `<ChartContainer>` wrapper (D1).
- [x] Replace `EXPECTED_COLOR = "#0ea5e9"` / `RECEIVED_COLOR = "#22c55e"` with `hsl(var(--chart-expected))` / `hsl(var(--chart-received))` via `chartConfig`.
- [x] Preserve `dimmed: Set<string>` state + legend-click behavior. Render native Recharts `<Legend onClick={handleLegendClick} wrapperStyle={{ cursor: "pointer" }}>` inside `<ChartContainer>` — `ChartContainer` accepts arbitrary Recharts children (E1).
- [x] Preserve tooltip number formatting (`Number(value).toLocaleString()`) — either shadcn `<ChartTooltipContent formatter>` or native Recharts `<Tooltip formatter>`. Visual rendering can adopt shadcn defaults (B3).
- [x] `chart-currency-selector` `<select>` lives outside chart proper — survives unchanged.
- [x] Pre-commit grep: `grep -rn "monthly-bar-chart\|accumulated-area-chart\|by-ticker-bar-chart" libs/test-e2e libs/test-api apps/web/tests apps/api/test` — update every locator + assertion in lockstep per `.claude/rules/playwright-page-object-testid-drift.md`.
- [x] Verify gate: lint + typecheck + web vitest + suite 6 (`test:e2e:bypass:mem`) + suite 7 (`test:e2e:oauth:mem`).

### C3 — PortfolioTrendCard + ReturnPercentCard migration (Phase 6c)

`feat(web): migrate dashboard trend cards to ChartContainer (Phase 6c)`

**PortfolioTrendCard:**

- [x] Replace inline `<svg viewBox="0 0 760 320">` + `buildChartGeometry` with `<ChartContainer config={chartConfig}>` containing a `<ComposedChart>` (or a `<LineChart>` with overlaid `<AreaChart>` series, implementer's call).
- [x] Series colors via `chartConfig`: `marketValue` = `--chart-primary`, `totalCost` = `--chart-muted`, `totalReturn` = `--chart-positive`.
- [x] Preserve linearGradient area-fill for `marketValueArea` via Recharts `<defs><linearGradient id="portfolio-trend-fill" x1="0" x2="0" y1="0" y2="1">` inside the chart SVG, with the existing `0.28 → 0.04` opacity stops.
- [x] Preserve latest-point peak markers via custom `<Dot>` component, applied only when `index === points.length - 1`. Three colored circles, sized 5-6px, one per series.
- [x] Apply `role="img"` + `aria-label={dict.dashboardHome.performanceTitle}` props to outer `<ChartContainer>` wrapper.
- [x] Move `data-testid="dashboard-performance-chart"` to outer `<ChartContainer>` wrapper (D1).
- [x] Preserve conditional render branches (loading, error, empty, partial-data warning) **outside** `<ChartContainer>` — current logic unchanged.

**ReturnPercentCard:**

- [x] Replace inline `<svg>` with `<ChartContainer config={chartConfig}>` containing a `<LineChart>` with single series.
- [x] Series color: `--chart-primary` (or dedicated semantic if the implementer determines purple distinction is load-bearing — judgement call).
- [x] Preserve latest-point marker (single dot at rightmost point) via custom `<Dot>` component on `index === points.length - 1`.
- [x] Apply `role="img"` + `aria-label` on outer `<ChartContainer>` wrapper.
- [x] Move `data-testid="dashboard-return-percent-chart"` to outer `<ChartContainer>` wrapper (D1).
- [x] Preserve conditional render branches (loading, error, empty, provisional-warning).

**Shared:**

- [x] **Optional extraction of a shared `<TrendChart>` helper** if both cards share enough scaffolding to cleanly remove duplication. Do NOT contort the API to share — the cards have different data shapes (single-series vs three-series). Only extract if the duplication after migration is genuine and the shared component reads naturally to a future maintainer.
- [x] Update `libs/test-e2e/src/pages/dashboard/DashboardPage.ts`:
  - Line 68: `performanceChart` locator — testid string unchanged; verify it resolves to the new wrapper element.
  - Lines 90-94: `performanceChartDataPath` — queries `path[d]` inside the testid'd element. Recharts produces different SVG path counts and shapes than the hand-rolled `buildChartGeometry`. Verify the assertion either still works structurally OR rewrite to query a Recharts-specific descendant.
  - Line 71: `returnPercentChart` locator — same treatment as line 68.
  - Lines 95-99: `returnPercentChartDataPath` — same treatment as lines 90-94.
- [x] Verify gate: **full 8-suite** (dashboard hot path; two charts).

### C4 — AllocationSnapshotCard migration (Phase 6d)

`feat(web): migrate AllocationSnapshotCard to Recharts Pie (Phase 6d)`

- [x] Replace CSS conic-gradient div with `<ChartContainer config={chartConfig}>` containing `<PieChart>` + `<Pie data={segments} dataKey="amount" innerRadius="60%" outerRadius="100%">`.
- [x] Each `<Cell fill={...}>` uses `hsl(var(--chart-N))` from `--chart-1` … `--chart-6` (A3).
- [x] Preserve donut-hole center label via overlay `<div>` (absolute-positioned over the chart wrapper) — current pattern survives. Show market value + label using current dict strings.
- [x] Delete `DONUT_COLORS` hex array and `buildConicGradient` helper.
- [x] Preserve testid `dashboard-allocation-card` on outer `<Card>` (unchanged).
- [x] Preserve empty-state branch (`segments.length === 0`) — render dashed-border empty UI outside `<ChartContainer>`.
- [x] Accept Recharts pie default animation + hover behavior (B3).
- [x] Verify gate: lint + typecheck + web vitest + suite 6 + suite 7.

### C5 — Optional cleanup sweep (Phase 6e)

`chore(web): retire hex color literals + final token sweep (Phase 6e)`

- [x] `grep -rnE "#[0-9a-fA-F]{6}" apps/web/components/dashboard apps/web/components/dividends` — confirm no hex literals leaked through. Any match must be tokenized.
- [x] Confirm `buildChartGeometry` (PortfolioTrendCard) and `buildConicGradient` (AllocationSnapshotCard) are fully deleted.
- [x] Verify gate: lint + typecheck + web vitest.
- [x] **Skip this commit entirely if no leftover detected.** This commit is an optional safety net, not load-bearing.

### Branch-final pre-PR gate

- [x] Run the canonical pre-push gate per `.claude/rules/full-test-suite.md`:
  ```
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```
- [ ] Manual visual verification (chrome-devtools MCP or local browser): (NOT run by solo-dev; suggest before merge)
  - Open `/dashboard`, `/dividends`, `/share/[token]`.
  - Toggle theme (light → dark → system); confirm all four charts re-render with appropriate tokens.
  - Cycle accent colors via Settings → Display; confirm `--chart-primary`-bound series follows the accent change.
  - Verify peak markers (PortfolioTrendCard + ReturnPercentCard) visible at rightmost data point.
  - Verify donut-hole center label still readable in both themes.
- [ ] Run `/code-reviewer` per `.claude/rules/code-review-before-pr.md` — produce structured review doc before PR creation. (NOT run by solo-dev; user-authored decision)

---

## Non-critical gaps documented as proposed stances

These gaps surfaced during Phase 1.5 ultrathink pass. None blocking; all addressed by per-commit acceptance criteria above. No further grilling needed.

| # | Gap | Proposed stance |
|---|---|---|
| G-2 | Specific HSL values for `--chart-*` tokens not pinned | Defer to implementer. Constraint: mirror current `DONUT_COLORS` identity in light; pick high-contrast equivalents in dark; verify against existing `--success` / `--muted-foreground` for semantic vars. |
| G-3 | `EXPECTED_COLOR` / `RECEIVED_COLOR` hex constants in DividendReviewCharts | Replaced by `--chart-expected` / `--chart-received` in C1 substrate. |
| G-4 | Area-fill linearGradient preservation | Preserve via Recharts `<defs><linearGradient>` inside chart SVG; explicit in C3 acceptance criteria. |
| G-5 | `chart-currency-selector` outside chart proper | Survives unchanged; explicit in C2 acceptance criteria. |
| G-6 | Tooltip number formatting | Preserve via shadcn `<ChartTooltipContent formatter>` or native Recharts formatter; visual rendering can adopt shadcn defaults per B3. |
| G-7 | shadcn docs mention `react-is` override for React 19 | Not applicable; app is React 18.3.1. Documented in C1 commit message. |
| G-8 | Visual regression strategy | Match Phase 4 precedent — E2E + Code Reviewer + manual visual at heavy commit gates. No screenshot diffing introduced. |

---

## Open items

None blocking. All design forks resolved during scope-grill session 2026-05-17. No follow-up tickets required from this scope.

---

## References

- **Locked design scope:** `docs/004-notes/ui-reshape-shadcn/design-202605151200-locked-scope.md`
- **Multi-phase scope-todo (Phase 6 section superseded by this doc):** `docs/004-notes/ui-reshape-shadcn/scope-todo-202605151201-phases.md`
- **Phase 4 precedent** (commit slicing + verification gate model): `docs/004-notes/ui-reshape-shadcn/scope-todo-202605171244-phase-4.md`
- **Phase 5 precedent:** `docs/004-notes/ui-reshape-shadcn/scope-todo-202605171756-phase-5.md`
- **Relevant rules:**
  - `.claude/rules/playwright-page-object-testid-drift.md` — lockstep testid updates per commit; grep recipe pre-commit.
  - `.claude/rules/full-test-suite.md` — canonical 8-suite gate definition.
  - `.claude/rules/code-review-before-pr.md` — run `/code-reviewer` before PR creation.
  - `.claude/rules/single-dom-table-sticky-first-column.md` — not directly applicable but illustrates the Phase 4 single-DOM precedent that Phase 6 mirrors structurally.
- **Linear tickets:** none (single-ticket worktree, phased delivery via sequential commits on same branch).
