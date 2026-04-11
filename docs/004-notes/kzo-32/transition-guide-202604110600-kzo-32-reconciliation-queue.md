# Transition Guide — KZO-32: Reconciliation Queue UI

**Ticket:** KZO-32  
**Date:** 2026-04-11  
**Affects:** `DividendCalendarClient.tsx`, `DividendPostingForm.tsx`, dividend i18n, dividend E2E tests

---

## Summary

KZO-32 adds a reconciliation queue UI to the dividend calendar. Users can now mark posted dividend entries as Matched, Explained, or Resolved directly from the posting drawer. This guide documents the behavioral changes that users and developers need to know.

---

## 1. New Badge Types: Matched (sky blue) and Explained (indigo)

Two new `CalendarBadge` values were added to `DividendCalendarClient.tsx`:

| Badge | Color | CSS classes | Condition |
|---|---|---|---|
| `matched` | Sky blue | `border-sky-200 bg-sky-50 text-sky-700` | `reconciliationStatus === "matched"` |
| `explained` | Indigo | `border-indigo-200 bg-indigo-50 text-indigo-700` | `reconciliationStatus === "explained"` |

These join the existing `resolved` (green), `pendingReview` (amber), `postedVariance` (rose), and `posted` (slate) badges.

**i18n strings added** to `apps/web/features/dividends/i18n.ts` under `badge.*`:
- EN: `matched: "Matched"`, `explained: "Explained"`
- zh-TW: `matched: "相符"`, `explained: "已說明"`

---

## 2. Badge Precedence: Reconciliation Status Beats Variance

`resolveBadge()` precedence was rewritten. The new order is:

```
resolved → matched → explained → open → variance → posted
```

**Before KZO-32:** `matched` and `explained` statuses were not handled, so they fell through to the `hasVariance()` check. A `matched` row with a numeric discrepancy would incorrectly render as `postedVariance` (rose/red) instead of `Matched` (sky blue).

**After KZO-32:** Any non-`open` reconciliation status takes precedence over the variance check. Once a user marks a row Matched or Explained, the variance color no longer appears regardless of the numeric discrepancy.

**`postedVariance` is now logically unreachable** given the current `DividendReconciliationStatus` union (`open | matched | explained | resolved`). It is kept in place for future status expansions — do not strip it as dead code.

---

## 3. Stock/Mixed Dividend Edit Button: No Longer Disabled

**Before KZO-32:** The Edit button on `DividendRowCard` was disabled with a tooltip for `STOCK` and `CASH_AND_STOCK` event types. Users could not open the posting drawer at all.

**After KZO-32:** The Edit button is enabled for all event types when a ledger entry exists (`canEdit = row.ledgerEntry !== null`). The `editDisabled` derivation and tooltip have been removed.

The drawer itself is now the gatekeeper: when opened for a non-CASH event type with an existing ledger entry, it renders in **reconcile-only mode** — amounts fields, deductions section, and source lines section are hidden, and only the reconciliation section and a read-only label (`dict.dividends.action.stockEditDisabled`) are shown.

**Computed as:** `reconcileOnlyMode = isEditMode && row.event.eventType !== "CASH"`

---

## 4. Reconciliation Section in the Drawer (Cash + Stock Modes)

A new reconciliation section was added to `DividendPostingForm.tsx` as a **sibling of the amounts `<form>`**, never inside it.

**Visible when:** `isEditMode && (postingStatus === "posted" || postingStatus === "adjusted")`

The section contains:
- Status selector (`open` / `matched` / `explained` / `resolved`), pre-populated from `row.ledgerEntry.reconciliationStatus`
- Note textarea (max 500 chars), required when status is `explained`
- "Save reconciliation" button (`type="button"`) — calls `PATCH /portfolio/dividends/postings/:id/reconciliation` directly via `updateDividendReconciliation()` in `dividendService.ts`

---

## 5. Reconciliation Save Is an Independent PATCH — Never Bundled with Amounts

**Critical constraint:** `POST /portfolio/dividends/postings` (the amounts edit path) hardcodes `reconciliation_status = "open"` and clears `reconciliation_note` in both the service layer (`apps/api/src/services/dividends.ts` ~line 308) and Postgres persistence (`apps/api/src/persistence/postgres.ts` ~line 1614).

The **only** path to a non-`open` status is `PATCH /portfolio/dividends/postings/:id/reconciliation`.

The "Save reconciliation" button is `type="button"` and lives outside the amounts `<form onSubmit>`. Any refactor that moves it inside the form, or wraps it in a shared submit handler, will **silently reset reconciliation to `open`** every time amounts are saved — with no error signal to the user.

---

## 6. Dirty-State Guard Covers Both Amounts and Reconciliation

`isDirty` in `DividendPostingForm.tsx` now ORs amounts-dirty and reconcile-dirty:

```ts
const isDirty = amountsDirty || reconcileDirty;
```

The unsaved-changes confirmation guard fires if either the amounts fields or the reconciliation status/note have been changed but not saved.

---

## 7. Cancel Button Lives Outside the Amounts Form

The Cancel button was moved OUT of the amounts `<form onSubmit>` to the outer container div. It uses `data-testid="dividend-cancel"` and renders in both full-edit mode and reconcile-only mode. Tests that find the Cancel button by testid are unaffected; tests that assumed Cancel was a submit child of the form will need updating.

---

## 8. Double Refresh After Reconciliation Save Is Intentional

After `handleSaveReconciliation()` calls `await onSaved()` (which triggers `refreshSnapshot()` and closes the drawer), the existing `useEventStream` subscription may also fire `dividend_reconciliation_changed`, triggering a second `refreshSnapshot()`. Both refreshes read the same snapshot and set the same state — there is no race, and no de-dup logic was added. This is intentional.

---

## 9. E2E Seed Pattern for Reconciliation Status

There is no dedicated E2E seed endpoint for `reconciliationStatus`. The established pattern is `DividendsArrange.seedPostedDividendWithReconciliation()`:

1. Call `seedPostedDividend()` to create the ledger entry
2. PATCH `/portfolio/dividends/postings/:id/reconciliation` using `TestEnv.apiBaseUrl` (not `apiUrl()`)

Do not roll a new seed helper — reuse `seedPostedDividendWithReconciliation()`.

---

## Out of Scope (Not in KZO-32)

- Cross-month date-range dividend review → KZO-136
- Reconciliation for trade events or cash ledger entries → KZO-31
- Bulk reconciliation actions
- The inline "Mark matched" button — unchanged
