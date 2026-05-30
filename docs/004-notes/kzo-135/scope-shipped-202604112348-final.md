---
slug: kzo-135
type: scope-shipped
created: 2026-04-11
tickets: [KZO-135]
supersedes: scope-todo-202604111205-initial.md
---

# Shipped: KZO-135 — Dividend Ledger Pagination, Sorting, Filtering & Aggregates

> Frozen snapshot. Do not edit after merge.
> Scope doc: [`scope-todo-202604111205-initial.md`](scope-todo-202604111205-initial.md)

---

## What Shipped

- **Pagination + sorting** on `GET /portfolio/dividends/ledger`: new `page`, `limit`, `sortBy`, `sortOrder` query params.
- **New `ticker` filter** on the same endpoint.
- **`DividendLedgerAggregates`** returned alongside paginated rows — computed over the full filtered set before slicing.
- **New endpoint** `GET /portfolio/dividends/ledger/years` — returns the distinct years present in the ledger for the authenticated user.

All changes are API-only. The web service layer is unchanged (KZO-136 will consume `total` and `aggregates`).

---

## Response Shape

`GET /portfolio/dividends/ledger` now returns:

```ts
{
  ledgerEntries: DividendLedgerEntryWithDetails[];
  total: number;                  // Count of matching rows across ALL pages
  aggregates: DividendLedgerAggregates;
}
```

### `DividendLedgerAggregates` (from `libs/shared-types/src/index.ts`)

```ts
type CurrencyAmounts = Record<string, number>;
// e.g. { "TWD": 12345.67, "USD": 456.78 }

type CurrencyExpectedReceived = Record<string, { expected: number; received: number }>;
// e.g. { "TWD": { expected: 1000, received: 980 } }

interface DividendLedgerAggregates {
  totalExpectedCashAmount: CurrencyAmounts;
  totalReceivedCashAmount: CurrencyAmounts;
  openCount: number;
  byMonth: Record<string, CurrencyExpectedReceived>;   // key: "YYYY-MM"
  byTicker: Record<string, CurrencyExpectedReceived>;  // key: ticker symbol
}
```

Aggregates are computed over the **full filtered set** (before pagination slicing), so `total`, `openCount`, and currency sums reflect the entire filtered result — not just the current page.

---

## Query Parameters

All 10 parameters accepted by `GET /portfolio/dividends/ledger`:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `fromPaymentDate` | `string?` | — | ISO date, inclusive |
| `toPaymentDate` | `string?` | — | ISO date, inclusive |
| `accountId` | `string?` | — | Filter to one account |
| `reconciliationStatus` | `string?` | — | `open` \| `matched` \| `explained` |
| `postingStatus` | `string?` | — | Posting status enum |
| `ticker` | `string?` | — | **New in KZO-135** |
| `page` | `number` | `1` | 1-indexed |
| `limit` | `number` | `50` | Max 500; **changed from old default of 500** |
| `sortBy` | `string` | `"paymentDate"` | See sort columns below |
| `sortOrder` | `"asc" \| "desc"` | `"desc"` | |

---

## Sort Columns

The `sortBy` enum accepts exactly these 6 values:

```ts
type DividendLedgerSortColumn =
  | "paymentDate"          // event.payment_date
  | "ticker"               // dividend_events.ticker
  | "account"              // account display name
  | "expectedCashAmount"   // dividend_ledger_entries.expected_cash_amount
  | "receivedCashAmount"   // sum of DIVIDEND_RECEIPT cash_ledger_entries
  | "reconciliationStatus" // dividend_ledger_entries.reconciliation_status
```

A stable `id ASC` tiebreaker is always appended to every sort (both Memory and Postgres backends).

---

## Persistence Interface Changes (`apps/api/src/persistence/types.ts`)

### Method rename

```
listDividendLedgerEntriesByPaymentDate(userId, accountId?, fromPaymentDate, toPaymentDate, limit)
  →  listDividendLedgerEntries(userId: string, opts: DividendLedgerListOptions)
```

Old positional signature (5 params) replaced with a single **options object**.

### New types

```ts
export interface DividendLedgerListOptions {
  accountId?: string;
  fromPaymentDate?: string;
  toPaymentDate?: string;
  reconciliationStatus?: DividendLedgerEntry["reconciliationStatus"];
  postingStatus?: DividendPostingStatus;
  ticker?: string;
  page: number;
  limit: number;
  sortBy: DividendLedgerSortColumn;
  sortOrder: "asc" | "desc";
}

export interface DividendLedgerListResult {
  ledgerEntries: DividendLedgerEntryWithDetails[];
  total: number;
  aggregates: DividendLedgerAggregates;
}

export type DividendLedgerEntryWithDetails = DividendLedgerEntry & {
  deductions: Store["accounting"]["facts"]["dividendDeductionEntries"];
  sourceLines: DividendSourceLine[];
};
```

### All call sites updated

The rename touched every caller in a single commit (grep-verified before merge):

- `apps/api/src/routes/registerRoutes.ts` (route handler)
- `apps/api/src/persistence/memory.ts` (implementation)
- `apps/api/src/persistence/postgres.ts` (implementation)
- `apps/api/test/integration/divFilters.integration.test.ts` (5 call sites)

---

## New Persistence Method: `listDividendLedgerYears`

```ts
listDividendLedgerYears(userId: string): Promise<{ years: number[] }>
```

Returns the distinct calendar years present in non-superseded, non-reversed dividend ledger entries with a non-null `paymentDate`, sorted descending.

Endpoint: `GET /portfolio/dividends/ledger/years` → `{ years: number[] }`

---

## Backward Compatibility

The response shape change is **additive**. The existing web `unwrapLedger` helper in `apps/web/features/dividends/services/dividendService.ts` reads only `.ledgerEntries` from the response — it continues to work unchanged.

`total` and `aggregates` are new fields that KZO-136 will wire into the web UI.

---

## Out of Scope

| Item | Reason |
|---|---|
| Web service layer (`dividendService.ts`, `DividendQuery` type) | Owned by KZO-136 |
| Cash ledger pagination | Deferred to KZO-137 |
| `variance` as a sort column | Out of scope per grilled spec |
| Production auth code (`app.ts`, `registerRoutes.ts` auth plumbing) | Out of scope |

---

## Stale Reference Check

Grepped `docs/` for `listDividendLedgerEntriesByPaymentDate`:

- **`docs/004-notes/kzo-135/scope-todo-202604111205-initial.md`** — the pre-implementation scope doc; frozen snapshot, not updated.
- **`docs/004-notes/kzo-37/scope-todo-202604091700-initial.md`** (line 105) — references the old method name in a historical context. Frozen snapshot per `doc-management.md` — not updated.
- **`docs/004-notes/kzo-31/scope-todo-202604111200-reconciliation-filter.md`** — frozen snapshot, not updated.

No evergreen docs (`docs/*.md`) reference the old method name. No updates required.
