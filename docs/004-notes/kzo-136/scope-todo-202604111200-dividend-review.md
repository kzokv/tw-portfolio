---
slug: kzo-136
source: scope-grill
created: 2026-04-11
tickets: [KZO-136]
required_reading: []
superseded_by: docs/004-notes/kzo-136/scope-todo-202604121200-dividend-review-v2.md
---

# Todo: KZO-136 — Dividend Review View

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also read `docs/004-notes/kzo-136/scope-todo-202604111200-dividend-review.md` (this file) and ensure KZO-135 has landed before starting frontend work.

## Dependencies (must land first)

- **KZO-135** — pagination + server-side sort + full-set aggregates for `GET /portfolio/dividends/ledger`. Do not start frontend implementation until KZO-135 is merged.
- **KZO-32** — drawer + `DividendPostingForm` ✅ already merged.

---

## Implementation Steps

### API — can start immediately (no KZO-135 dependency)

- [ ] Add `ticker` query param to `dividendLedgerQuerySchema` in `registerRoutes.ts`; propagate through `listDividendLedgerEntriesByPaymentDate` in both `memory.ts` and `postgres.ts`
- [ ] New `GET /portfolio/dividends/ledger/years` endpoint — returns distinct non-null payment years (ascending) for the authenticated user; no query params needed

### API — coordinate with KZO-135

- [ ] Confirm KZO-135 aggregates spec includes `byMonth` (YYYY-MM → receivedCashAmount, posted+adjusted only), `byTicker` (ticker → receivedCashAmount, posted+adjusted only), `totalExpectedCashAmount`, `totalReceivedCashAmount`, `openCount` for the full filtered set
- [ ] Confirm `sortBy` supports: `paymentDate`, `ticker`, `accountId`, `expectedCashAmount`, `receivedCashAmount`, `variance`, `reconciliationStatus`; `sortOrder`: `asc | desc`; default `paymentDate DESC`

### Frontend

- [ ] Add Recharts dependency (`npm install recharts -w apps/web`)
- [ ] Add "View all dividends →" navigation link on `/dividends` calendar page (`DividendCalendarClient.tsx`) — uses existing `viewAllLink` i18n string, navigates to `/dividends/review`
- [ ] New route `apps/web/app/dividends/review/page.tsx` — server component; fetches initial data with current-year defaults; renders `DividendReviewClient` with initial snapshot
- [ ] New `apps/web/components/dividends/DividendReviewClient.tsx` — main client component containing:
  - Filter bar:
    - Quick-select preset strip (Current Year active by default, Last Year, This Month, Last Month, Current Quarter, Last Quarter, dynamic Year XXXX list from `/dividends/ledger/years`)
    - Custom from/to `<input type="date">` — updates when preset selected
    - Ticker text input (server-side filter)
    - Account dropdown (server-side filter)
    - Status dropdown: All statuses / Needs Reconciliation (`postingStatus=posted&reconciliationStatus=open`) / Open / Matched / Explained / Resolved
    - Apply button triggers re-fetch at page 1
  - URL query param sync for all filter/sort/page state (deep-linking support)
  - Stats tiles row: Total Expected, Total Received, Variance, Open Items — sourced from `response.aggregates` (full filtered set)
  - Two bar charts (lazy-loaded via `next/dynamic`):
    - "Received by Month" — `aggregates.byMonth`, with `?` tooltip: "Total cash received per payment month within the selected date range. Helps identify seasonal dividend patterns."
    - "Received by Ticker" — `aggregates.byTicker`, with `?` tooltip: "Total cash received per stock or ETF within the selected date range. Shows which holdings contribute most to dividend income."
  - Sortable table (desktop lg+):
    - Columns: Payment Date, Ticker, Account, Expected, Received, Variance, Status, Actions
    - All columns sortable — clicking header sends `sortBy`/`sortOrder` to API, resets to page 1
    - Active sort column highlighted; arrow indicates direction
  - Card grid (mobile, <lg) — same data, stacked layout
  - Pagination controls (page/total from API response)
  - Inline "Mark Matched" button — visible only on rows where `reconciliationStatus === "open"`; calls existing `updateDividendReconciliation` service
  - Row click → opens `Drawer` + `DividendPostingForm` (reuse existing components verbatim)
  - `useEventStream({ enabled: true, eventTypes: ["dividend_reconciliation_changed"] })` — on event, patch the matching row in local state by `dividendLedgerEntryId`; row stays visible with updated status if it no longer matches active filter
- [ ] New `apps/web/features/dividends/DividendReviewCharts.tsx` — lazy-loadable Recharts wrapper (imported via `next/dynamic` in `DividendReviewClient`)
- [ ] Add i18n strings to `apps/web/features/dividends/i18n.ts` — all new labels in both `en` and `zh-TW`:
  - Page title/description
  - Filter labels (date range, ticker, account, status)
  - Preset button labels
  - "Needs Reconciliation" filter label
  - Stat tile labels
  - Chart titles + tooltip text
  - Table column headers
  - Breadcrumb label

---

## Explicit Out of Scope

- Aggregate tax reporting or export (separate ticket)
- Changes to existing `/dividends` calendar view
- `postingStatus` as a standalone exposed filter (subsumed by "Needs Reconciliation" preset)
- Reconciliation for trade events or cash ledger entries (KZO-31)
- New sidebar nav entry (no sidebar change)

---

## Architecture Notes

- **Stats + charts reflect full filtered set** — sourced from `response.aggregates`, not computed from `response.entries` (which is paginated)
- **Charts are lazy-loaded** — `next/dynamic(() => import('./DividendReviewCharts'))` to avoid adding Recharts to the initial bundle
- **Sort is server-side** — all column sort triggers API re-fetch at page 1; do not attempt client-side sort
- **`paymentDate=null` entries excluded** — date-range filter naturally excludes them; review view does not have a TBD section
- **SSE in-place patch** — on `dividend_reconciliation_changed`, patch row by `dividendLedgerEntryId`; update `reconciliationStatus` + `version`; do not re-fetch; row stays in list even if status no longer matches active filter
- **Recharts bar charts** — `aggregates.byMonth`/`byTicker` only sum `receivedCashAmount` for `postingStatus=posted|adjusted` entries (enforced server-side in aggregation query)

---

## References

- Linear ticket: KZO-136
- Depends on: KZO-135 (pagination + sort + aggregates)
- Drawer component: `apps/web/components/ui/Drawer.tsx`
- Posting form: `apps/web/components/dividends/DividendPostingForm.tsx` (reuse verbatim)
- Calendar client (reference): `apps/web/components/dividends/DividendCalendarClient.tsx`
- SSE hook: `apps/web/hooks/useEventStream.ts`
- i18n: `apps/web/features/dividends/i18n.ts`
