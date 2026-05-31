---
slug: kzo-136
source: scope-grill
created: 2026-04-12
tickets: [KZO-136]
required_reading: []
superseded_by: null
---

# Todo: KZO-136 — Dividend Review View (v2)

> **For agents starting a fresh session:** read this file in full before starting. Ensure KZO-135 is merged (pagination + sort + full-set aggregates on `GET /portfolio/dividends/ledger`) before starting frontend work. KZO-32 (drawer + DividendPostingForm) is already merged.

## Dependencies (must land first)

- **KZO-135** ✅ merged — pagination, server-side sort, `ticker` filter, `byMonth`/`byTicker`/`totalExpected`/`totalReceived`/`openCount` aggregates, `GET /portfolio/dividends/ledger/years`
- **KZO-32** ✅ merged — `Drawer` + `DividendPostingForm`

---

## Implementation Steps

### API — make date params optional (new scope from v2 grill)

- [x] In `registerRoutes.ts`: make `fromPaymentDate` and `toPaymentDate` optional in `dividendLedgerQuerySchema` (both currently required strings)
- [x] In `postgres.ts` `listDividendLedgerEntries`: when `fromPaymentDate`/`toPaymentDate` absent, replace the date-range WHERE clause with `AND payment_date IS NOT NULL` (preserves existing TBD-entry exclusion; do NOT drop the null check)
- [x] In `memory.ts` `listDividendLedgerEntries`: same — when dates absent, filter to entries where `paymentDate !== null` only
- [x] In `apps/web/features/dividends/services/dividendService.ts`: make `fromPaymentDate`/`toPaymentDate` optional on `DividendQuery`; update `buildQuery()` to omit these params from URLSearchParams when absent

### Frontend — navigation entry point

- [x] Add "View all dividends →" link to `DividendCalendarClient.tsx` — navigates to `/dividends/review`; use existing `viewAllLink` i18n key

### Frontend — route and server component

- [x] Create `apps/web/app/dividends/review/page.tsx` — server component; fetches initial data with current-year defaults (fromPaymentDate = Jan 1 of current year, toPaymentDate = Dec 31 of current year, page 1, sortBy = paymentDate, sortOrder = desc); renders `<DividendReviewClient>` with initial snapshot + i18n

### Frontend — main client component

- [x] Create `apps/web/components/dividends/DividendReviewClient.tsx` — main orchestration client component containing all sections below; manages all filter/sort/page state; syncs state to URL via `router.replace` (replaceState, not push) on every change

#### Filter bar

- [x] **Preset strip** — horizontally scrollable chip row (single row, `overflow-x: auto`, no wrapping); ordered: Yesterday · This Week · Last 7 Days · Last 30 Days · This Month · Last Month · Current Quarter · Last Quarter · Current Year · Last Year · [Year XXXX from `/ledger/years`] · Unspecified · Custom; active preset highlighted; clicking any non-Custom preset instantly triggers re-fetch
- [x] **Preset date resolution logic** — pure util function `resolvePresetDates(preset, today)` → `{ from: string | null, to: string | null }`:
  - Yesterday: from = yesterday, to = yesterday
  - This Week: from = Monday of current calendar week, to = today
  - Last 7 Days: from = today−6, to = today
  - Last 30 Days: from = today−29, to = today
  - This Month: first → last day of current month
  - Last Month: first → last day of previous month
  - Current Quarter: first day of current quarter → today
  - Last Quarter: first → last day of previous quarter
  - Current Year: Jan 1 → Dec 31 of current year
  - Last Year: Jan 1 → Dec 31 of previous year
  - Year XXXX: Jan 1 → Dec 31 of that year
  - Unspecified: from = null, to = null
  - Custom: from/to = user-entered values
- [x] **Date inputs** — always visible; `from` and `to` `<input type="date">`; read-only when any non-Custom preset is active (show resolved range); editable only when Custom is active; auto-applies on blur/close; partial range (one field empty): hold last valid query state + show inline error on empty field; selecting Custom activates editable mode
- [x] **Ticker input** — text `<input>`; auto-applies on blur or Enter keypress; clears to empty resets ticker filter
- [x] **Account dropdown** — populated from user accounts; auto-applies on selection change; "All accounts" default
- [x] **Status dropdown** — options: All / Needs Reconciliation (`postingStatus=posted&reconciliationStatus=open`) / Open / Matched / Explained / Resolved; auto-applies on selection change
- [x] **No Apply button anywhere**
- [x] **Mobile stacking order**: preset strip (full width, scroll) → from/to date row → ticker input (full width) → account + status (2-column row)

#### Stats tiles

- [x] Four stat tiles sourced from `response.aggregates`: Total Expected (`totalExpectedCashAmount`), Total Received (`totalReceivedCashAmount`), Variance (computed frontend: expected − received per currency), Open Items (`openCount`); multi-currency totals displayed per currency

#### Chart section (lazy-loaded)

- [x] Load `DividendReviewCharts` via `next/dynamic(() => import('./DividendReviewCharts'), { ssr: false })` to keep Recharts out of initial bundle
- [x] Tab switcher above chart area: Monthly / Accumulated / By Ticker; Monthly active by default; tab state is local UI state (not URL-synced)
- [x] Pass `aggregates.byMonth` and `aggregates.byTicker` as props to charts component

#### Table (desktop lg+)

- [x] Columns: Payment Date · Ticker · Account · Expected · Received · Variance · Status · Actions
- [x] All columns server-side sortable — clicking header sends `sortBy`/`sortOrder` to API, resets to page 1; active sort column highlighted with direction arrow
- [x] Default sort: paymentDate DESC

#### Card grid (mobile, < lg)

- [x] Stacked cards showing same data as table rows; same click-to-open-drawer behaviour

#### Row interactions

- [x] Inline "Mark Matched" button — visible only when `reconciliationStatus === "open"`; calls `updateDividendReconciliation`; on success patches row in local state
- [x] Row click → opens `Drawer` + `DividendPostingForm` (reuse verbatim from KZO-32)
- [x] Pagination controls: page / total from API response

#### SSE

- [x] `useEventStream({ enabled: true })` — on `dividend_reconciliation_changed` event, patch matching row in local state by `dividendLedgerEntryId`; update `reconciliationStatus` + `version`; row stays visible even if status no longer matches active filter

### Frontend — charts component

- [x] Create `apps/web/components/dividends/DividendReviewCharts.tsx` (lazy-loaded via next/dynamic)
- [x] Add Recharts dependency: `npm install recharts -w apps/web`

#### Shared chart utilities

- [x] `bucketByGranularity(byMonth, granularity)` — pure function grouping `Record<"YYYY-MM", CurrencyExpectedReceived>` into quarter or year buckets by summing; month granularity = passthrough
  - Quarter key format: "2026-Q1"
  - Year key format: "2026"
- [x] `computeCumulative(bucketed, currency)` — produces `{ label, expected, received }[]` sorted chronologically with running totals
- [x] `formatYAxis(value)` — auto k/M suffix: ≥1,000,000 → "1.2M", ≥1,000 → "50k", else raw number
- [x] `CurrencySelector` — dropdown component; hidden when `currencies.length <= 1`; shows currency code options derived from keys present in the aggregate data

#### Monthly bar chart

- [x] Recharts `BarChart` with two `Bar` components (expected, received) — grouped bars per time period
- [x] Per-chart granularity toggle: Month / Quarter / Year (3-button group in chart header)
- [x] Per-chart `CurrencySelector` (independent, not shared with other charts)
- [x] `onClick` on `Legend` to toggle series visibility (Recharts controlled legend)
- [x] y-axis: `tickFormatter={formatYAxis}`
- [x] Empty state: "No data for this period" when bucketed data is empty

#### Accumulated area chart

- [x] Recharts `AreaChart` with two `Area` components (cumulative expected, cumulative received) — `fillOpacity` for filled area
- [x] Per-chart granularity toggle: Month / Quarter / Year (3-button group in chart header)
- [x] Per-chart `CurrencySelector` (independent)
- [x] `onClick` on `Legend` to toggle series visibility
- [x] y-axis: `tickFormatter={formatYAxis}`
- [x] When "Unspecified" preset active: both time-series charts default granularity to Year (set by parent passing `defaultGranularity` prop, applied on mount and when Unspecified activates)
- [x] < 2 data points: show "Range too narrow for accumulated view" note instead of chart
- [x] Empty state: "No data for this period"

#### By Ticker grouped bar chart

- [x] Recharts `BarChart` with two `Bar` components (expected, received) — grouped bars per ticker
- [x] Sort tickers by received descending before rendering
- [x] Show all tickers (no cap)
- [x] Per-chart `CurrencySelector` (independent)
- [x] `onClick` on `Legend` to toggle series visibility
- [x] y-axis: `tickFormatter={formatYAxis}`
- [x] Empty state: "No data for this period"

### i18n

- [x] Add all new strings to `apps/web/features/dividends/i18n.ts` (both `en` and `zh-TW`):
  - Page title / description / breadcrumb
  - All preset button labels (Yesterday, This Week, Last 7 Days, Last 30 Days, Unspecified, Custom — plus existing ones)
  - Filter labels: ticker, account, status, date range from/to
  - "Needs Reconciliation" filter label
  - Stat tile labels (Total Expected, Total Received, Variance, Open Items)
  - Chart tab labels (Monthly, Accumulated, By Ticker)
  - Chart tooltips (help text for each chart)
  - Granularity toggle labels (Month, Quarter, Year)
  - "No data for this period" / "Range too narrow for accumulated view"
  - Table column headers
  - Partial date range inline error message

### E2E tests

- [x] Create `apps/web/test/specs/dividend-review.spec.ts` (or `specs-oauth/` if auth mode requires it — check existing suite placement)
- [x] **Filter auto-apply scenarios:**
  - Preset click (e.g. "Last 7 Days") auto-applies: URL updates, table re-fetches, date inputs populate with resolved range
  - Custom preset: enter both dates, blur away, verify fetch fires with correct params
  - Partial custom range: clear "to" date, verify table holds last state + inline error visible on empty field
  - Ticker input: type ticker, press Enter, verify filtered results
  - Status dropdown: change selection, verify immediate re-fetch
- [x] **Chart interaction scenarios:**
  - Click "Accumulated" tab: area chart renders (no BarChart)
  - Click "By Ticker" tab: grouped bar chart renders
  - Granularity toggle (Month → Quarter): chart re-buckets client-side — assert no extra network request fired
  - Click legend item: series toggles hidden/visible
  - Currency selector: if multiple currencies present, change selection, verify chart data updates
  - Select "Unspecified" preset: both time-series charts default to Year granularity
- [x] **Table interaction scenarios:**
  - Click sortable column header: correct `sortBy`/`sortOrder` params in next request, page resets to 1
  - Navigate to page 2: correct `page=2` param in request, different rows render
  - "Mark Matched" on open row: button disappears, row status badge updates to "matched"
  - Row click: drawer opens with correct ticker + account in header
- [x] **Deep link scenario:** navigate to `/dividends/review?sortBy=ticker&sortOrder=asc&status=open` — verify filter bar reflects these values and table is sorted/filtered accordingly
- [x] **SSE scenario:** trigger a reconciliation status change (via direct API call or `/__e2e` helper if available), verify row patches in-place without full page re-fetch
- [x] **Navigation scenario:** on `/dividends` calendar page, click "View all dividends →", verify navigation to `/dividends/review`

---

## Explicit Out of Scope

- Aggregate tax reporting or export (separate ticket)
- Changes to existing `/dividends` calendar view
- `postingStatus` as a standalone exposed filter (subsumed by "Needs Reconciliation" preset)
- Reconciliation for trade events or cash ledger entries (KZO-31)
- New sidebar nav entry
- Multi-select on status dropdown
- Chart granularity state synced to URL (local UI state only)

---

## Architecture Notes

- **Stats + charts reflect full filtered set** — sourced from `response.aggregates`, not from paginated `response.entries`
- **Granularity bucketing is pure client-side** — `byMonth` is the API's unit; quarter/year grouping is a frontend reduce; no API call on granularity change
- **Cumulative computation is client-side** — sort `byMonth` keys chronologically, compute running sum per currency
- **URL sync uses `replaceState`** — every filter/sort/page change calls `router.replace` to avoid history pollution; Back button returns to `/dividends`
- **"Unspecified" must maintain `paymentDate IS NOT NULL`** — absence of date params does NOT include TBD entries; the persistence layer must add this explicit filter
- **SSE in-place patch** — on `dividend_reconciliation_changed`, patch row by `dividendLedgerEntryId`; row stays in list even if status no longer matches active filter
- **Recharts lazy-loaded** — imported via `next/dynamic({ ssr: false })` to avoid bundle bloat; skeleton/spinner shown while loading
- **Currency selector visibility** — hidden when `Object.keys(aggregates.byMonth).flatMap(...)` yields only one distinct currency; shown when ≥ 2 currencies present

---

## References

- Linear ticket: KZO-136
- Supersedes: `docs/004-notes/kzo-136/scope-todo-202604111200-dividend-review.md`
- Drawer component: `apps/web/components/ui/Drawer.tsx`
- Posting form: `apps/web/components/dividends/DividendPostingForm.tsx`
- Calendar client (reference): `apps/web/components/dividends/DividendCalendarClient.tsx`
- SSE hook: `apps/web/hooks/useEventStream.ts`
- i18n: `apps/web/features/dividends/i18n.ts`
- Aggregates type: `DividendLedgerAggregates` in `libs/shared-types/src/index.ts`
