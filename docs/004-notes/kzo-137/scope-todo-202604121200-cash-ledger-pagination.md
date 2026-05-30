---
slug: kzo-137
source: scope-grill
created: 2026-04-12
tickets: [KZO-137]
required_reading: []
superseded_by: null
---

# Todo: KZO-137 — Cash Ledger Pagination

> **For agents starting a fresh session:** read all files listed in
> `required_reading` above before starting implementation. Key files:
> `apps/api/src/persistence/types.ts`, `apps/api/src/persistence/memory.ts`,
> `apps/api/src/persistence/postgres.ts`,
> `apps/api/src/routes/registerRoutes.ts` (line 1502),
> `apps/web/features/cash-ledger/`.
> Follow the KZO-135 dividend ledger pattern throughout.

## Implementation Steps

### Backend — persistence types
- [ ] Add `CashLedgerSortColumn` type to `persistence/types.ts`
      (`"entryDate" | "entryType" | "amount" | "currency" | "accountId"`)
- [ ] Add `CashLedgerListOptions` interface to `persistence/types.ts`
      (fromEntryDate?, toEntryDate?, accountId?, entryType[]?,
       page, limit, sortBy: CashLedgerSortColumn, sortOrder: "asc"|"desc")
- [ ] Add `CashLedgerListResult` interface to `persistence/types.ts`
      (entries: CashLedgerEntry[], total: number,
       summary: { accountId: string; currency: string; amount: number }[])
- [ ] Add `listCashLedgerEntries(userId, opts): Promise<CashLedgerListResult>`
      to the `Persistence` interface

### Backend — MemoryPersistence
- [ ] Implement `listCashLedgerEntries` in `memory.ts`:
      filter → compute summary over full set → sort with tiebreaker
      (`bookedAt DESC NULLS LAST, id ASC`) → count total → slice page

### Backend — PostgresPersistence
- [ ] Implement `listCashLedgerEntries` in `postgres.ts`:
      shared WHERE params ($1=userId, $2=accountId, $3=fromEntryDate,
      $4=toEntryDate, $5=entryType[]); static SORT_COLUMNS allowlist;
      Query A: COUNT(*) → total;
      Query B: GROUP BY account_id, currency → summary;
      Query C: paginated SELECT with ORDER BY + tiebreaker
      (`booked_at DESC NULLS LAST, id ASC`) + LIMIT/OFFSET

### Backend — route
- [ ] Update `cashLedgerQuerySchema` in `registerRoutes.ts`:
      add `page` (default 1), `sortBy` (default "entryDate"),
      `sortOrder` (default "desc"); change `limit` default 500 → 50
- [ ] Update `GET /portfolio/cash-ledger` handler to call
      `app.persistence.listCashLedgerEntries(userId, opts)`;
      keep `loadUserStore` call for enrichment maps;
      enrich `result.entries`; return `{ entries: enriched, summary, total }`

### Frontend — types and service
- [ ] Add `total: number` to `CashLedgerListResponse` in
      `features/cash-ledger/types.ts`
- [ ] Add `page?`, `sortBy?`, `sortOrder?` to `CashLedgerQuery`
- [ ] Update `cashLedgerService.ts` to pass `page`, `sortBy`, `sortOrder`

### Frontend — CashLedgerClient
- [ ] Add `page`, `sortBy`, `sortOrder`, `total` to component state
      (initialize from `initialData.total`, default page 1)
- [ ] Update `refresh()` callback to pass current `page`, `sortBy`,
      `sortOrder` (SSE events stay on current page)
- [ ] Reset `page` to 1 on filter change
- [ ] Add `PAGE_SIZE = 50` constant
- [ ] Add sortable column headers for entryDate, entryType, amount,
      currency, accountId (↑↓ indicators; ticker and side unsortable)
- [ ] Add "Page X of Y" prev/next pagination UI
      (`Math.ceil(total / PAGE_SIZE)`, disable prev on page 1,
      disable next on last page)

### Frontend — i18n
- [ ] Add pagination keys to `cash-ledger/i18n.ts`:
      `page`, `of`, `previous`, `next`, `totalSuffix`
      (follow dividend i18n shape in `features/dividends/i18n.ts`)

### Unit tests
- [ ] Add `apps/api/test/unit/cashLedgerPagination.test.ts`:
      cover filter combinations, sort by each column, page slicing,
      summary = full-set aggregate (not page slice), tiebreaker stability
- [ ] Review `apps/api/test/unit/cash-ledger.test.ts` — update any
      summary assertions that assumed page-slice behaviour

### E2E tests (extend existing AAA infrastructure)
- [ ] Extend `libs/test-e2e/src/pages/cash-ledger/CashLedgerPage.ts`:
      add selectors for pagination controls (prev/next, page indicator)
      and sortable column headers
- [ ] Extend `libs/test-e2e/src/assistants/cash-ledger/CashLedgerActions.ts`:
      add `goToNextPage()`, `goToPrevPage()`, `sortByColumn(col, order)`
- [ ] Extend `libs/test-e2e/src/assistants/cash-ledger/CashLedgerAssert.ts`:
      add `assertCurrentPage(n)`, `assertTotalPages(n)`,
      `assertSortIndicator(col, order)`,
      `assertSummaryReflectsFullSet()` (summary unchanged across pages)
- [ ] Add pagination describe block to
      `apps/web/tests/e2e/specs/cash-ledger-aaa.spec.ts`:
      - first page loads 50 entries, shows correct total
      - next/prev navigation works
      - sort by each sortable column changes row order
      - summary totals are identical on page 1 and page 2
      - filter change resets to page 1
      - SSE event keeps current page

## Open Items
*(none)*

## References
- Linear: KZO-137
- Pattern reference: `apps/api/src/persistence/types.ts` (DividendLedgerListOptions/Result)
- Pattern reference: `apps/api/src/persistence/memory.ts:408` (listDividendLedgerEntries)
- Pattern reference: `apps/api/src/persistence/postgres.ts:1879` (listDividendLedgerEntries)
- Pattern reference: `apps/web/components/dividends/DividendReviewClient.tsx:389` (pagination UI)
- Pattern reference: `apps/api/test/unit/dividendLedgerPagination.test.ts`
- Pattern reference: `apps/web/tests/e2e/specs/dividend-review-aaa.spec.ts`
