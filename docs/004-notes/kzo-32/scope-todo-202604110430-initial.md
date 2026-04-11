---
slug: kzo-32
source: scope-grill
created: 2026-04-11
tickets: [KZO-32]
required_reading: []
superseded_by: null
---

# Todo: KZO-32 — Build reconciliation queue UI

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also read `AGENTS.md` at repo root and the touched subtrees before making any changes.

## Context

The backend is fully complete — `PATCH /portfolio/dividends/postings/:id/reconciliation` supports all four statuses, enforces note requirement for `explained`, fires `dividend_reconciliation_changed` SSE, and uses optimistic locking via `version`. No new API work is needed.

The existing calendar already has:
- One-click "Mark matched" inline button (keep this — do NOT remove it)
- `pendingReview` badge for `open` status
- SSE subscription for live updates

### Critical constraint discovered during scope-grill

`POST /portfolio/dividends/postings` (amounts edit) **always hardcodes `reconciliation_status = "open"` and clears `reconciliation_note`** in both the service layer (`services/dividends.ts` ~line 308) and Postgres persistence (`postgres.ts` ~line 1614). The `PATCH .../reconciliation` route is the only path to a non-`open` status. The reconciliation section in the drawer MUST have its own independent save button — it must never share the amounts form submit.

## Implementation Steps

- [x] **Step 1 — Add `matched` and `explained` badge types**
  - Add `"matched"` and `"explained"` to `CalendarBadge` type in `DividendCalendarClient.tsx`
  - Fix `resolveBadge()` precedence: check all four statuses before the variance check
    ```
    resolved  → "resolved"
    matched   → "matched"     ← new, before variance
    explained → "explained"   ← new, before variance
    open      → "pendingReview"
    variance  → "postedVariance"
    else      → "posted"
    ```
  - Add `badgeClassName` and `resolveBadgeLabel` cases for `"matched"` and `"explained"`
  - Add `badge.matched` and `badge.explained` i18n strings in both EN and zh-TW in `apps/web/features/dividends/i18n.ts` (under `badge.*`, separate from the existing `form.reconciliation.status*` strings)

- [x] **Step 2 — Reconciliation section in `DividendPostingForm` drawer**
  - Add a reconciliation section below the source lines section, shown only when `isEditMode && row.ledgerEntry.postingStatus === 'posted' || row.ledgerEntry.postingStatus === 'adjusted'`
  - Section contains:
    - Status selector: `open` / `matched` / `explained` / `resolved` (pre-populated from `row.ledgerEntry.reconciliationStatus`)
    - Note field (textarea, max 500 chars): shown always, required and validated when status is `explained`
    - Own **"Save reconciliation" button** — fires `PATCH /portfolio/dividends/postings/:id/reconciliation` via `updateDividendReconciliation()` in `dividendService.ts`
    - This button is completely independent from the amounts form submit (`<form onSubmit>`)
  - The reconciliation save uses the current `row.ledgerEntry.id` — no version param needed (reconciliation PATCH does not use optimistic locking)
  - On success: call `onSaved()` to refresh the snapshot (same as amounts save)
  - Error display: reuse the existing `formError` display pattern
  - i18n: all strings already exist under `dividends.form.reconciliation.*` — wire them up

- [x] **Step 3 — Reconciliation-only mode for stock/mixed dividends**
  - In `DividendRowCard`, change `editDisabled` logic: the Edit button should always be enabled if there is a ledger entry — remove the `eventType !== "CASH"` gate
  - In `DividendPostingForm`, gate the amounts fields on event type (already partially done via `canShowCashField` / `canShowStockField`), but ensure the reconciliation section still renders for stock/mixed entries
  - When `editDisabled` (i.e. `row.event.eventType !== "CASH"` with existing ledger): hide the amounts fields and deductions/source-lines sections; show only the reconciliation section and `dict.dividends.action.stockEditDisabled` as the explanatory label — do NOT add a new i18n key
  - The drawer title already shows ticker + accountId — no change needed there

- [x] **Step 4 — Wire up SSE refresh after reconciliation save**
  - Verify that calling `onSaved()` after the reconciliation PATCH triggers `refreshSnapshot()` correctly
  - The existing `useEventStream` subscription (`dividend_reconciliation_changed`) should also cause a refresh — confirm no double-refresh race

## Out of Scope

- Cross-month dividend review / date-range filtering → KZO-136
- Reconciliation for trade events or cash ledger entries → KZO-31
- Any changes to `PATCH /portfolio/dividends/postings/:id/reconciliation` backend route
- Removing the inline "Mark matched" button from the row card — keep it
- Bulk reconciliation actions

## Key Files

| File | Change |
|---|---|
| `apps/web/components/dividends/DividendCalendarClient.tsx` | Badge types, `resolveBadge()`, `editDisabled` logic |
| `apps/web/components/dividends/DividendPostingForm.tsx` | Reconciliation section + independent save button |
| `apps/web/features/dividends/i18n.ts` | New `badge.matched`, `badge.explained` in EN + zh-TW |
| `apps/web/lib/i18n/types.ts` | Add new badge keys to `AppDictionary` type if needed |

## References

- Linear ticket: KZO-32 — https://linear.app/kzokv/issue/KZO-32
- Related: KZO-136 (date-range review view, depends on this)
- Related: KZO-31 (cross-entity reconciliation model)
- Critical constraint: `apps/api/src/services/dividends.ts` ~line 308 — amounts edit hardcodes `reconciliation_status = "open"`
- Canonical reconciliation PATCH: `apps/api/src/routes/registerRoutes.ts` ~line 1674
