---
slug: holdings-requests-bugs
source: scope-grill
created: 2026-07-16
tickets: []
required_reading: []
superseded_by: docs/notes/holdings-requests-bugs/scope-todo-202607161055-posted-transaction-mcp.md
---

# Todo: Holdings Requests And User-Discovered Bugs

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Decisions

- Add ticker selection to Top Holdings, Portfolio Holdings, and every holdings table reused on report pages.
- Persist one user-scoped global selection keyed by `marketCode:ticker`. Selection is ticker-level and includes every account holding that ticker; account child rows cannot be selected independently.
- Store selection as an explicit `all` or `custom` mode. `all` has no explicit ticker IDs and means every visible ticker. Checking one inline ticker control enters `custom`; removing the last custom ticker returns to `all`.
- Provide synchronized inline desktop/mobile controls and a searchable, market-grouped ticker picker on every relevant table. The picker uses the full aggregated holdings universe, retains unavailable saved entries until removal/reset, and exposes a Reset to all action.
- Calculate totals from the intersection of the global selection and rows visible after the current table's market/account filters, search, and Top Holdings limit. In `all` mode, total every visible row.
- Show visible-versus-globally-selected counts plus total cost, market value, and unrealized P&L in an unframed responsive summary strip above the rows. Keep the strip independent of column visibility and ordering.
- Sum existing reporting-currency row values rather than recomputing financial values in the browser. Evaluate completeness independently for each metric and label available subtotals as partial with included/eligible counts when quotes or FX are missing.
- Keep global ticker selection separate from table layout preferences. Persist column order, visibility, width, mobile summary count, row order, filters, Top Holdings limit, and layout style under stable per-table contexts.
- Migrate existing version-1 `holdings.shared` preferences idempotently into the new contexts without a visible reset. Context PATCHes must merge atomically in memory and Postgres so stale mounted clients cannot overwrite sibling contexts.
- Persist the Portfolio Holdings compact/detailed style instead of keeping it in local component state.
- Make the existing fee-profile Save action validate and PATCH the complete editable profile. Keep edit mode open with an inline error on failure; on success, replace local data with the response and then exit edit mode.
- Traditional Chinese discount conversion remains a UI-boundary concern. Persist the canonical discount percentage expected by the API.
- Fee-profile changes affect future estimates and transactions only. Existing booked commission, tax, cost basis, cash movement, realized P&L, and fee-policy snapshots remain immutable. Historical recomputation is out of scope.
- Add read-only live transaction values for gross trade value and settlement: BUY cash out is gross plus effective commission and tax; SELL net proceeds is gross minus effective commission and tax. A manual fee override takes precedence over an estimate.
- Keep gross/net transaction values informational. Do not add a redundant total field to the transaction payload. If fees are unavailable, show gross while marking settlement unavailable.
- Add canonical `bookedCostAmount` to BUY transaction-history responses using `round(quantity * unitPrice, 2) + commissionAmount + taxAmount`. Show it in desktop and mobile ticker history; SELL rows show an em dash.
- Add the existing aggregate weighted-average cost per share to the ticker hero in the ticker's native price currency. Show unavailable when there is no open position; do not add another backend calculation.
- Keep explicit Ex-dividend date and Payment date labels visible below `xl`, where desktop headers are absent. Use event-specific labels in Paying Today and Ex-dividend Today, and show Payment date: TBD when unresolved.
- Present CASH, STOCK, and CASH_AND_STOCK event types throughout the dividend Overview. Stock-capable rows show expected stock quantity, authoritative ratio when available, and Needs action when entitlement calculation is unresolved. Mixed events show cash and stock in one event row.
- Extend the top Expected and Received metrics with stock-event/posting counts and per-ticker share quantities. Never sum shares of different tickers into one headline quantity.
- Show complete cash/stock entitlement information in This Month, Paying Today, Ex-dividend Today, Needs Action, and Recent Receipts. Recent Receipts distinguishes received cash, received stock, and cash in lieu.
- Extend dividend Review desktop and mobile presentations with event type, expected stock, received stock, distribution ratio/state, and stock variance. Cash-only rows show unavailable stock values.
- Before posting, expected stock rows show received stock as Pending and stock variance as unavailable. After posting, stock variance is `received - expected`.
- Dividend posting, correction, lot accounting, entitlement formulas, and destructive replay semantics are unchanged by this scope.

## Implementation Steps

- [x] Add versioned shared preference contracts for global holdings selection and stable per-table layout contexts, with backward-compatible parsing of the existing version-1 payload.
- [x] Add a deterministic, idempotent migration from `holdings.shared` into Top Holdings, Portfolio Holdings, report holdings, and Portfolio style contexts while preserving compatible legacy column/row settings.
- [x] Context-merge `holdingsTableSettings.contexts` and the global selection atomically in memory and Postgres persistence; add parity and concurrent/stale-context regression tests.
- [x] Extract a shared holdings-selection state hook that hydrates server preferences, persists `all/custom` state, retains unavailable identities, and synchronizes updates across mounted tables.
- [x] Build reusable inline selection controls and a searchable, market-grouped picker for desktop tables and mobile holding cards, including Reset to all and unavailable-entry removal.
- [x] Build a pure selected-holdings summary helper that applies visible-row semantics, aggregates reporting-currency cost/market/P&L values, and returns independent partial-data counts.
- [x] Build the responsive summary strip with scope counts and the three financial metrics, then integrate selection, picker, and totals into Top Holdings, Portfolio Holdings, and every reused report holdings table without selecting account child rows.
- [x] Split holdings layout settings into stable per-table contexts, persist the Portfolio compact/detailed style, and verify column order, width, visibility, row order, filters, mobile count, and Top Holdings count survive remount, reload, and a new app build.
- [x] Wire fee-profile Save to the existing PATCH endpoint for the complete profile, preserve canonical discount conversion, add pending/error states, and refresh local/shell data from the server response without recomputing historical transactions.
- [x] Add gross trade value and BUY cash-out/SELL net-proceeds presentation to the shared transaction card using manual overrides before estimates and existing canonical two-decimal gross rounding.
- [x] Extend the transaction-history shared contract and ticker-details mapping with canonical BUY `bookedCostAmount`; render and test the column/field on desktop and mobile while leaving SELL unavailable.
- [x] Add aggregate native-currency average cost per share to the ticker hero summary with responsive layout and no-position behavior.
- [x] Align This Month date-label breakpoints with its desktop headers, use explicit labels in today highlights, and cover known/TBD payment dates at mobile, tablet, constrained desktop, and wide desktop widths.
- [x] Extract reusable dividend event-type and cash/stock entitlement presentation helpers with localized Cash, Stock, Cash + Stock, expected/received shares, ratio, unresolved, pending, and variance copy.
- [x] Extend Overview Expected/Received metrics with per-ticker stock summaries and overflow counts; update This Month and today highlights for cash-only, stock-only, mixed, and unresolved events.
- [x] Extend Needs Action with specific stock issues and Recent Receipts with received cash/stock/cash-in-lieu details.
- [x] Extend Review desktop columns and mobile cards with event type, expected stock plus ratio/state, received stock, and post-only stock variance while retaining existing cash reconciliation fields.
- [x] Add focused web unit/component tests for selection modes, picker/inline synchronization, visible-row totals, partial metrics, preference migration, fee saves, transaction totals, booked cost, ticker average cost, dividend date labels, and stock-dividend presentations.
- [x] Add focused API unit, HTTP, memory, and Postgres integration coverage for holdings preference context merges, fee-profile discount persistence, and transaction-history booked cost.
- [x] Run `/aaa` to add or update E2E tests covering persisted holdings selection/layout workflows, fee-profile form submission, transaction calculated totals, ticker detail additions, and responsive dividend cash/stock workflows.
- [x] Run the smallest relevant test scopes first, then complete all eight repository-required suites before declaring full validation.
- [x] Revisit this file after implementation and mark only delivered steps with `- [x]`; leave undelivered scope visible for follow-up.

## Open Items

- [x] No product-scope items remain. The user-approved no-ticket path uses `waiver:linear-ticket`, `Approved-by: @kzokv`, and `Scope: both` for commit and PR naming.

## References

- Holdings table: `apps/web/components/portfolio/HoldingsTable.tsx`
- Top Holdings: `apps/web/components/dashboard/DashboardHoldingsPreview.tsx`
- Report holdings: `apps/web/components/reports/ReportsClient.tsx`
- Holdings preferences: `apps/web/components/holdings/HoldingsColumnSettings.tsx`
- Preference persistence: `apps/api/src/persistence/memory.ts`, `apps/api/src/persistence/postgres.ts`
- Fee-profile settings: `apps/web/components/settings/AccountsSettingsClient.tsx`, `apps/web/features/settings/components/AccountsListSection.tsx`
- Transaction form and history: `apps/web/components/portfolio/AddTransactionCard.tsx`, `apps/web/components/portfolio/TransactionHistoryTable.tsx`
- Ticker hero: `apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx`
- Dividend Overview and Review: `apps/web/components/dividends/DividendCalendarClient.tsx`, `apps/web/components/dividends/DividendReviewClient.tsx`, `apps/web/components/dividends/DividendReviewDrawer.tsx`
- Shared contracts: `libs/shared-types/src/index.ts`
- Canonical transaction math: `apps/api/src/services/replayPositionHistory.ts`
- Prior dividend scope: `docs/notes/dividend-issues-improvements/scope-todo-202607101031-dividend-improvements.md`
- Validation evidence: `docs/notes/holdings-requests-bugs/validation-evidence-20260716.md`
- Scope debate note: none
- Linear tickets: none provided
