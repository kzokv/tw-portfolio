---
slug: holdings-table-sorting
source: scope-grill
created: 2026-07-19
tickets: []
required_reading: [docs/001-architecture/glossary.md]
superseded_by: null
---

# Todo: Holdings sorting and terminology consistency

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Goal

Add performant, accessible, persisted sorting to authenticated holdings tables and establish one canonical holdings vocabulary across all user-facing holdings presentations.

## Locked Decisions

1. Sorting applies to holdings tables on Dashboard, both Portfolio styles, and all Reports contexts. Public Share and Unrealized P&L Analysis do not gain sorting controls.
2. Canonical holdings terminology applies across every user-facing holdings presentation, including Public Share and matching metric labels in Analysis.
3. Desktop tables use sortable column-label buttons. Mobile layouts use a synchronized field selector and direction toggle. Column dragging, resizing, and sorting remain distinct interaction targets.
4. Every deterministic data column is sortable except action-only columns. Sorting is single-column only.
5. Sort direction is two-state. Text defaults ascending; numeric, percentage, health-severity, and date fields default descending.
6. Missing, unavailable, or non-finite values always sort last. Equal values use ticker, market, and account identity as deterministic tie-breakers.
7. Processing order is filter/selection, derive displayed metrics, field sort or Custom order, then top-N limiting.
8. Custom order remains a holding-level mode. It preserves the saved holding order, and account holdings use account name and ID as their deterministic order within a holding.
9. Aggregated mode sorts holding groups. Expanded mode sorts groups and then visible account holdings within each group. Accounts mode globally sorts account holdings for explicit field sorts.
10. Focus presets apply canonical sorts. Explicit header sorting overrides preset ordering while retaining Stale Quotes or FX Exposure filtering. Selecting another preset reapplies its canonical sort.
11. Sort mode, semantic field, and direction persist independently per holdings context. Existing saved manual order is never deleted by selecting a field sort.
12. Dashboard, Portfolio compact, and Reports retain their Largest/market-value-descending default. Portfolio detailed retains its current/custom order default. Legacy contexts with `rowOrder` and no sort fields infer Custom order.
13. Sorting remains client-side. Do not add URL sort state, report query parameters, API sorting, database sorting, a sorting dependency, or preemptive virtualization.
14. Hidden active sort fields remain active. Desktop shows a compact sort chip only when no visible column exposes the active field.

### Canonical holdings vocabulary

| Term | Definition and usage |
|---|---|
| Holding | One instrument aggregated across the selected accounts. |
| Account holding | One instrument held within one account. |
| Quantity | Number of instrument units held. Use instead of generic Units, Shares, or Position in holdings presentation. |
| Accounts | Number or list of accounts contributing to a holding. |
| Average cost | Cost basis per unit. |
| Price | Current unit price. |
| Unit P&L | Signed unrealized profit or loss per unit. |
| Market value | Current total value of the holding. |
| Cost basis | Total acquisition cost. Replaces Book Cost and Total Cost in holdings tables. |
| Daily change | Signed daily performance. Explicit column sorting uses signed percentage; mover presets may use absolute percentage. |
| Unrealized P&L | Current market value minus cost basis. Replaces bare P&L and Unrealized table labels. |
| Allocation | Holding percentage of the selected portfolio. Replaces Weight in holdings tables. |
| Data health | Composite quote, FX, freshness, and allocation-fallback condition. |
| Position | Reserved for accounting or inventory workflows that explicitly mean a position or position action. Never use as a generic holdings-table column. |

### Semantic sort fields

Use one shared semantic union for persisted sorting:

- `ticker`
- `accountCount`
- `quantity`
- `averageCost`
- `price`
- `unitPnl`
- `marketValue`
- `costBasis`
- `dailyChangePercent`
- `unrealizedPnl`
- `allocation`
- `dataHealth`
- `nextDividendDate`
- `lastDividendDate`

## Implementation Steps

### 1. Establish performance baselines

- [x] Add or reuse a non-production benchmark harness for 1,000 report holdings and a realistic grouped/account-holding dataset.
- [x] Record the current Dashboard/Reports sort-to-commit baseline before implementation.
- [x] Record pure primitive-sort baseline evidence. The scope-session proxy for 1,000 rows measured medians of 0.18-0.34 ms and a worst field-level p95 of 3.42 ms.

### 2. Update the evergreen glossary

- [x] Add Holding, Account holding, Quantity, Accounts, Average cost, Price, Unit P&L, Market value, Cost basis, Daily change, Unrealized P&L, Allocation, Data health, and the restricted Position usage to `docs/001-architecture/glossary.md`.
- [x] Correct the glossary's stale Full test suite entry from seven suites to the eight suites required by the root `AGENTS.md`.
- [x] Do not rewrite frozen documents under `docs/004-notes/` other than this new scope handoff.

### 3. Define and validate persisted sort preferences

- [x] Add shared `HoldingsSortField`, `HoldingsSortDirection`, and sort-mode types in `libs/shared-types`.
- [x] Extend `HoldingsTableContextPreferenceDto` with optional strict fields for mode (`custom` or `field`), semantic field, and direction while keeping preference version 1 backward compatible.
- [x] Add schema refinement so field mode requires a valid field and direction, while Custom mode cannot carry contradictory active-field state.
- [x] Ensure the shared admin-market-data preference schema remains valid without enabling holdings sorting behavior there.
- [x] Add normalization and invalid/unsupported-field fallback without deleting stored preferences.

### 4. Migrate legacy holdings column preferences

- [x] Contextually migrate Dashboard `position` to Quantity, Accounts, and Allocation, preserving order and hidden state.
- [x] Contextually migrate Reports `position` to Accounts and add explicit Quantity without losing quantity that was previously embedded in the Ticker cell.
- [x] Migrate Reports `weight` to Allocation and all holdings-specific bare P&L/Unrealized/Daily identifiers to canonical Unrealized P&L and Daily change identifiers.
- [x] Improve Portfolio compact/detailed interoperability by using the same Quantity, Accounts, and Allocation identifiers where the fields overlap.
- [x] Infer Custom mode when a legacy context has a non-empty `rowOrder` but no sort preference.
- [x] Preserve unknown future fields and unrelated context preferences during PATCH merge behavior.

### 5. Build the shared sorting engine

- [x] Create a pure holdings sorting module shared by Dashboard, Portfolio, and Reports.
- [x] Implement a decorate-sort-undecorate pipeline that extracts the active primitive key once per visible row and never mutates source arrays.
- [x] Implement type-aware default directions and active-direction toggling.
- [x] Keep missing values last in both directions and add deterministic ticker, market, and account tie-breakers.
- [x] Sort Ticker by normalized ticker, then market and account identity.
- [x] Sort Average cost, Price, Unit P&L, Market value, Cost basis, and Unrealized P&L by reporting-currency values where available.
- [x] Sort Daily change by signed percentage; keep absolute percentage only in mover preset ranking.
- [x] Sort Allocation by the recalculated displayed percentage after filtering.
- [x] Sort Data health by quote severity, FX severity, price-freshness rank, and allocation fallback.
- [x] Compare ISO dividend dates without repeated `Date` construction in comparators.

### 6. Extend shared holdings settings state

- [x] Add normalized sort mode, field, direction, setters, and surface defaults to `useHoldingsColumnSettings` or a focused companion hook.
- [x] Persist exactly once per committed user sort interaction and never during render or initial preference hydration.
- [x] Keep local sorting responsive when persistence fails and expose the existing settings error path.
- [x] Make Reset Rows clear only saved holding order, Reset Columns preserve sorting, and Reset Sort restore the surface default.

### 7. Refactor shared column headers and responsive controls

- [x] Change `HoldingsColumnHeaderContent` so the drag target, sort button, and resize separator do not share click/drag behavior.
- [x] Add keyboard-operable sort buttons, visible active-direction icons, and `aria-sort` on owning header cells.
- [x] Add a shared mobile sort field selector and direction toggle with canonical localized labels.
- [x] Add the conditional desktop hidden-sort chip and allow it to change or reset the otherwise invisible sort.
- [x] Keep stable test IDs for existing drag/resize controls and add dedicated sort-control IDs.

### 8. Canonicalize holdings presentation terminology

- [x] Replace compound Position columns with explicit Quantity, Accounts, and Allocation columns where those metrics are displayed.
- [x] Standardize Average cost, Price, Unit P&L, Market value, Cost basis, Daily change, Unrealized P&L, Allocation, Data health, and Actions labels.
- [x] Put market code consistently in the Ticker cell and remove duplicated account/quantity text once explicit columns exist.
- [x] Update related holdings copy such as Open Positions, Largest Position, Top Position Weight, and Account position to Holding, Allocation, or Account holding as appropriate.
- [x] Apply terminology updates to Public Share without adding sorting controls there.
- [x] Apply canonical names to matching Analysis metrics while retaining analysis-specific Rank, Period change, and similar concepts.
- [x] Update English and zh-TW dictionaries, typed i18n keys, accessibility copy, internal column IDs, test IDs, fixtures, and assertions.
- [x] Leave backend position actions, replay-position history, open/closed position status, and other valid accounting uses unchanged.

### 9. Integrate Dashboard and Portfolio compact sorting

- [x] Replace Dashboard's local five-value sort model with the shared semantic sort model.
- [x] Preserve Largest, Highest Allocation, Best/Worst P&L, Stale Quotes, and FX Exposure preset behavior under the agreed precedence rules.
- [x] Split Position into explicit canonical columns and preserve currently visible information.
- [x] Sort before applying the top-holdings limit.
- [x] Reuse one memoized filtered/sorted group result across mobile and desktop rendering.
- [x] Precompute visible and sorted account holdings once per group rather than filtering or sorting them during both responsive render paths.

### 10. Integrate Portfolio detailed sorting

- [x] Add shared sort state and controls to `HoldingsTable` for aggregated, expanded, and accounts display modes.
- [x] Sort groups by aggregate displayed values in aggregated and expanded modes.
- [x] Sort each expanded group's visible account holdings independently with the same explicit field.
- [x] Sort all visible account holdings globally in Accounts mode for field sorts.
- [x] Implement Custom holding order in Accounts mode as holding order plus deterministic account name/ID order.
- [x] Compute allocation maps before key extraction and reuse them in sorting and rendering.
- [x] Remove duplicate child filtering across mobile and desktop paths.

### 11. Integrate Reports sorting

- [x] Replace Reports' local five-value sort model with the shared semantic model across Daily Review, Portfolio, and Market holdings contexts.
- [x] Add explicit Accounts and Quantity columns, move market code into Ticker, rename Weight to Allocation, and canonicalize the remaining columns.
- [x] Preserve preset filtering/ranking behavior and per-context preference isolation.
- [x] Sort the complete loaded report set before any top-N limit.
- [x] Keep report sorting client-side with the existing 1,000-row fetch ceiling.

### 12. Add focused automated coverage

- [x] Unit-test every semantic field in both directions, type-aware defaults, missing-last behavior, deterministic ties, and source-array immutability.
- [x] Test that sort-key extraction is linear and invoked once per row rather than inside each comparator call.
- [x] Test group, expanded-child, accounts-mode, Custom order, and top-N operation ordering.
- [x] Test preference schema validation, legacy inference, contextual column migration, unsupported-field fallback, persistence isolation, and failure behavior.
- [x] Component-test header sorting, `aria-sort`, icons, keyboard operation, drag/resize isolation, mobile synchronization, hidden-sort chip, presets, terminology, and reset behavior.
- [x] Run `/aaa` to add or update E2E tests covering the flows agreed in this scope session.
- [x] Add focused E2E coverage for Dashboard sort/reload persistence, Portfolio hierarchy and mobile sorting, and one Reports interaction with context isolation.

### 13. Verify performance and regressions

- [x] Re-run the 1,000-row pure-sort benchmark and require p95 below 10 ms.
- [x] Compare React commit time with the pre-change Dashboard/Reports baseline and require no more than a 20% regression.
- [x] Confirm no formatting, date parsing, FX conversion, allocation recomputation, or health-object construction occurs inside comparator calls.
- [x] Confirm no production sorting dependency or measurable bundle-weight increase was introduced.
- [x] If measured rendering exceeds the budget, first apply focused row memoization; evaluate virtualization only with evidence and separate scope approval.

### 14. Run repository verification

- [x] Run the smallest focused web/shared-type tests first.
- [x] Run `npx eslint .`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run test --prefix apps/web`.
- [x] Run `npm run test --prefix apps/api`.
- [x] Run `npm run test:integration:full:host` on Darwin or the lume VM shell.
- [x] Run `npm run test:e2e:bypass:mem --prefix apps/web`.
- [x] Run `npm run test:e2e:oauth:mem --prefix apps/web`.
- [x] Run `npm run test:http --prefix apps/api`.
- [x] Revisit this file and tick only deliverables that were actually implemented and verified.

## Performance Evidence

The final captures bind to production-source content hash `c1a4a4e696d5c70b78c19b70e2e5cf380600183aacf41823bbe3871c38ba6ad2`, with a clean production-source status at commit `fb7b0121a96afeafc24e4f960a3a1e875a6c274b`.

- The 1,000-row production adapter benchmark invokes the exported Dashboard, Portfolio, and Reports sort-key adapters inside the timed loop. Its p95 results range from 0.71 ms to 1.24 ms, below the 10 ms budget.
- The 1,000-row pure flat and grouped proxies range from 0.21 ms to 0.83 ms p95.
- Dashboard React sort-to-commit p95 improved from 529.07 ms to 199.94 ms. Reports improved from 670.05 ms to 81.64 ms. These React captures are representative render-regression sentinels at the surfaces' normal visible limits; they are not presented as 1,000-row end-to-end render measurements.
- The implementation adds no production sorting dependency. Filtering, displayed-metric derivation, sort-key extraction, sorting, and top-N limiting remain separate stages; formatting and date parsing do not occur inside comparators.

## Open Items

None.

## Out of Scope

- Sorting controls on Public Share or Unrealized P&L Analysis.
- Multi-column sorting.
- URL-addressable sort state.
- Report/API/database sorting contracts.
- Account-holding manual reorder preferences.
- Preemptive table virtualization.
- Global removal of valid accounting and inventory uses of Position.
- Rewriting frozen historical notes.

## References

- Evergreen glossary: `docs/001-architecture/glossary.md`
- Shared holdings settings: `apps/web/components/holdings/HoldingsColumnSettings.tsx`
- Dashboard and Portfolio compact holdings: `apps/web/components/dashboard/DashboardHoldingsPreview.tsx`
- Portfolio detailed holdings: `apps/web/components/portfolio/HoldingsTable.tsx`
- Reports holdings: `apps/web/components/reports/ReportsClient.tsx`
- Public Share holdings: `apps/web/app/share/[token]/page.tsx`
- Shared preference contracts: `libs/shared-types/src/index.ts`
- Linear tickets: none provided
- Scope debate note: none; no debate was required
