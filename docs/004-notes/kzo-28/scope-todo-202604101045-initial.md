---
slug: kzo-28
source: scope-grill
created: 2026-04-10
tickets: [KZO-28]
required_reading: [docs/001-architecture/cash-ledger-rules.md]
superseded_by: null
---

# Todo: KZO-28 — Build Cash Ledger API and Page

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also read `docs/004-notes/kzo-28/scope-todo-202604101045-initial.md` (this file) for the full locked scope.

## Implementation Steps

### API

- [ ] Add `GET /portfolio/cash-ledger` route handler in `apps/api/src/routes/registerRoutes.ts`
  - Zod query schema: `fromEntryDate?`, `toEntryDate?`, `accountId?`, `entryType[]?` (all 6 schema types accepted), `limit` (default 500, max 500)
  - Read via `loadUserStore` → `listCashLedgerEntries(store)` from `accountingStore.ts` — no new persistence method needed
  - Filter in memory: by `entry_date` range, `accountId`, `entryType[]`
  - Enrich each entry using Maps built from store data (O(1) lookups, zero extra DB cost):
    - All entries: `ticker` (string), `side` ("BUY" | "SELL" | null)
    - Settlement entries (`TRADE_SETTLEMENT_IN/OUT`): `tradeDetail: { quantity, unitPrice, commissionAmount, taxAmount }`
    - Dividend entries (`DIVIDEND_RECEIPT/DEDUCTION`): `dividendDetail: { expectedCashAmount, receivedCashAmount, deductionTotal }`
  - Compute `summary: Array<{ accountId, currency, amount }>` — filtered subtotal (SUM of visible entries grouped by accountId + currency, not a true running balance)
  - Return `{ entries, summary }`
- [ ] Define response DTO types (inline in route or add to `libs/shared-types`)

### Web — Types & i18n

- [ ] Extend `AppSection` union with `"cash-ledger"` in `apps/web/lib/i18n/types.ts`
- [ ] Add `shellTitle` and `shellDescription` cases for `"cash-ledger"` in the switch statements in `apps/web/components/layout/AppShell.tsx`
- [ ] Add cash ledger i18n strings to the app dictionary: page title, page description, column headers (Date, Type, Amount, Currency, Account, Ticker), entry type display names for all 6 types, empty state, drawer labels

### Web — Navigation

- [ ] Add `Wallet` icon to `iconMap` in `apps/web/components/layout/SideNavigation.tsx`
- [ ] Add "Cash Ledger" nav item (5th position, `id: "cash-ledger"`, `href: "/cash-ledger"`) to `navigationItems` in `apps/web/components/layout/AppShell.tsx`

### Web — Service Layer

- [ ] Create `apps/web/features/cash-ledger/services/cashLedgerService.ts`
  - Export `fetchCashLedgerEntries(query: CashLedgerQuery): Promise<CashLedgerListResponse>`

### Web — Page (server component)

- [ ] Create `apps/web/app/cash-ledger/page.tsx`
  - `requireSession()`
  - Fetch initial snapshot (no filters, limit 500) + `getDictionary(locale)` in parallel
  - Render `<AppShell section="cash-ledger" isDemo={session.isDemo}><CashLedgerClient initialEntries={...} dict={...} locale={...} /></AppShell>`

### Web — Client Component

- [ ] Create `apps/web/features/cash-ledger/components/CashLedgerClient.tsx`
  - Filter toolbar: date range pickers (fromEntryDate/toEntryDate), account selector, entry type multi-select (show 4 active types in UI; all 6 accepted by API)
  - Table columns: entry date, ticker, type display name, side, amount (signed, currency-formatted), currency, account name
  - Summary bar: totals per (accountId, currency) — labeled "Total", not "Balance"
  - SSE subscription via `useEventStream({ enabled: true })`: refresh on `recompute_complete`, `dividend_posted`, `dividend_updated`
  - Drawer state: `drawerEntry: EnrichedCashLedgerEntry | null`

### Web — Drawer Component

- [ ] Create `apps/web/features/cash-ledger/components/CashLedgerDrawer.tsx`
  - Settlement entries (`TRADE_SETTLEMENT_IN/OUT`): ticker, side, date, quantity, unit price, commission, tax, net settlement amount
  - Dividend entries (`DIVIDEND_RECEIPT/DEDUCTION`): ticker, date, expectedCashAmount, receivedCashAmount, deductionTotal — no link to /dividends

### Tests

- [ ] API unit tests: filter logic (date range, accountId, entryType[]), enrichment correctness (ticker/side/tradeDetail/dividendDetail), summary computation
- [ ] E2E: `/cash-ledger` page loads with seeded entries; entry type filter narrows results; drawer opens for a settlement entry (shows trade detail); drawer opens for a dividend entry (shows dividend detail)

## Open Items

- [ ] KZO-135: Add pagination to `GET /portfolio/cash-ledger` (deferred — ship limit-500 first, then revisit cursor vs offset)

## References

- Linear: KZO-28, KZO-135
- Architecture: `docs/001-architecture/cash-ledger-rules.md`
- Scope-grill session: 2026-04-10
