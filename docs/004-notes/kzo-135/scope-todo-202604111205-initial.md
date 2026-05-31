---
slug: kzo-135
source: scope-grill
created: 2026-04-11
tickets: [KZO-135]
required_reading: []
superseded_by: null
---

# Todo: KZO-135 — Add pagination to dividends/ledger API endpoint

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Read this file for the full locked scope before writing any code.

## Scope boundary

This ticket is **API-only**. The web service layer (`fetchDividendLedger`, `DividendQuery`, `unwrapLedger`) is owned by KZO-136. Do not touch `apps/web/features/dividends/services/dividendService.ts` or web types.

Cash ledger pagination is **out of scope** — deferred to KZO-137. Do not touch `GET /portfolio/cash-ledger` or `CashLedgerClient`.

## Implementation Steps

### 1. Persistence interface — rename + extend

- [ ] Rename `listDividendLedgerEntriesByPaymentDate` → `listDividendLedgerEntries` on the persistence interface in `apps/api/src/persistence/types.ts`
- [ ] Grep all callers repo-wide before closing (`grep -r "listDividendLedgerEntriesByPaymentDate" --include="*.ts" .`); update every caller
- [ ] Add new params to the interface signature:
  - `page: number` (1-indexed)
  - `limit: number`
  - `sortBy: "paymentDate" | "ticker" | "account" | "expectedCashAmount" | "receivedCashAmount" | "reconciliationStatus"`
  - `sortOrder: "asc" | "desc"`
  - `ticker?: string`
- [ ] Update return type to:
  ```ts
  Promise<{
    ledgerEntries: DividendLedgerEntryWithDetails[];
    total: number;
    aggregates: DividendLedgerAggregates;
  }>
  ```

### 2. Shared-types — new aggregate shape

- [ ] Add `DividendLedgerAggregates` type to `libs/shared-types`:
  ```ts
  type CurrencyAmounts = Record<string, number>;
  type CurrencyExpectedReceived = Record<string, { expected: number; received: number }>;

  interface DividendLedgerAggregates {
    totalExpectedCashAmount: CurrencyAmounts;
    totalReceivedCashAmount: CurrencyAmounts;
    openCount: number;
    byMonth: Record<string, CurrencyExpectedReceived>; // key: "YYYY-MM"
    byTicker: Record<string, CurrencyExpectedReceived>; // key: ticker symbol
  }
  ```
- [ ] Rebuild `@tw-portfolio/shared-types`

### 3. Route schema — update `dividendLedgerQuerySchema`

- [ ] Add to `dividendLedgerQuerySchema` in `registerRoutes.ts`:
  - `page: z.coerce.number().int().positive().default(1)`
  - `limit: z.coerce.number().int().positive().max(500).default(50)`
  - `sortBy: z.enum([...]).default("paymentDate")`
  - `sortOrder: z.enum(["asc", "desc"]).default("desc")`
  - `ticker: z.string().optional()`
- [ ] Remove the old `limit` field (was default 500)

### 4. Memory backend — `MemoryPersistence.listDividendLedgerEntries`

- [ ] Apply all existing filters (paymentDate range, accountId, reconciliationStatus, postingStatus, superseded/reversed exclusion)
- [ ] Apply `ticker` filter: look up `dividendEventId` → `store.marketData.dividendEvents` → filter by `event.ticker`
- [ ] Apply `sortBy`/`sortOrder`: sort the full filtered set before slicing
  - `account` sort: look up account display name from store
  - All other sorts: direct field access
  - Always use `id` as final stable tiebreaker
- [ ] Compute aggregates over the **full filtered set** (before slicing):
  - `totalExpectedCashAmount` and `totalReceivedCashAmount`: currency-keyed sums
  - `openCount`: count where `reconciliationStatus === "open"`
  - `byMonth`: group by `paymentDate.substring(0, 7)`, then by `cashCurrency`, accumulate `expected`/`received`
  - `byTicker`: group by `ticker`, then by `cashCurrency`, accumulate `expected`/`received`
- [ ] Capture `total = filteredSet.length`
- [ ] Slice for current page: `filteredSet.slice((page - 1) * limit, page * limit)`
- [ ] Then fetch deductions + source lines for the current page rows only (same as before)
- [ ] Return `{ ledgerEntries, total, aggregates }`

### 5. Postgres backend — `PostgresPersistence.listDividendLedgerEntries`

- [ ] **Query 1 — aggregate + count** (full filtered set):
  - `SELECT COUNT(*) as total, SUM(expected_cash_amount) FILTER (...) as ..., GROUP BY cash_currency, ...`
  - Add `WHERE de.ticker = $n` if `ticker` param provided
  - Returns `total`, `totalExpectedCashAmount` (grouped by currency), `totalReceivedCashAmount` (grouped by currency), `openCount`, `byMonth` (GROUP BY to_char(payment_date, 'YYYY-MM'), cash_currency), `byTicker` (GROUP BY de.ticker, cash_currency)
  - Note: may need 2–3 aggregate sub-queries (totals + byMonth + byTicker) since GROUP BY dimensions differ
- [ ] **Query 2 — paginated rows**:
  - Same WHERE clause as Query 1
  - Add ORDER BY based on `sortBy`/`sortOrder`:
    - `paymentDate` → `event.payment_date`
    - `ticker` → `de.ticker`
    - `account` → `acc.name` (or account display name column)
    - `expectedCashAmount` → `dle.expected_cash_amount`
    - `receivedCashAmount` → received subquery alias
    - `reconciliationStatus` → `dle.reconciliation_status`
  - Always append `dle.id` as final stable tiebreaker
  - `LIMIT $n OFFSET (page - 1) * limit`
- [ ] **Query 3 — deductions** for current page rows only (existing pattern, unchanged)
- [ ] **Query 4 — source lines** for current page rows only (existing pattern, unchanged)
- [ ] Return `{ ledgerEntries, total, aggregates }`

### 6. New endpoint — `GET /portfolio/dividends/ledger/years`

- [ ] Register route in `registerRoutes.ts`: `app.get("/portfolio/dividends/ledger/years", ...)`
- [ ] Add `listDividendLedgerYears(userId: string): Promise<{ years: number[] }>` to persistence interface
- [ ] **Memory implementation**: scan all non-superseded, non-reversed ledger entries with non-null `paymentDate`; extract `parseInt(entry.paymentDate.substring(0, 4))`; deduplicate; sort descending
- [ ] **Postgres implementation**: `SELECT DISTINCT EXTRACT(YEAR FROM event.payment_date)::int FROM dividend_ledger_entries dle JOIN ... WHERE ... AND event.payment_date IS NOT NULL AND dle.is_superseded = false AND ... ORDER BY 1 DESC` — apply same superseded/reversed filters as main query
- [ ] Return `{ years: number[] }`

### 7. Tests

- [ ] Unit tests: update existing `listDividendLedgerEntriesByPaymentDate` test references to renamed method; add cases for `ticker` filter, `sortBy`/`sortOrder`, `page`/`limit`, aggregate shape
- [ ] Integration tests: update `GET /portfolio/dividends/ledger` tests for new response shape (`total`, `aggregates` fields); add `ticker` filter test; add `/years` endpoint test
- [ ] Confirm all existing tests still pass after rename (full test suite per `full-test-suite.md` rule)

## Out of Scope

- Cash ledger pagination (→ KZO-137)
- `CashLedgerClient` UI changes
- Web service layer (`dividendService.ts`, `DividendQuery` type) — owned by KZO-136
- `variance` as a sort column
- Tax reporting / export

## Open Items

- [ ] KZO-137: Cash ledger pagination — requires migrating cash ledger off `loadUserStore` to a persistence-backed implementation; cursor vs offset decision pending

## References

- Linear: KZO-135, KZO-136, KZO-137, KZO-28
- Scope-grill session: 2026-04-11
