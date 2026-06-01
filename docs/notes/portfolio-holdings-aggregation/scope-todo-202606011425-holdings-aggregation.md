---
slug: portfolio-holdings-aggregation
source: scope-grill
created: 2026-06-01
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Portfolio Holdings Aggregation

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Aggregate holding groups by `(ticker, marketCode/currency)`.
- Keep existing account-level `holdings` API field for compatibility.
- Add a new grouped holdings field such as `holdingGroups` with parent rows and account child rows.
- Parent rows show native trading math plus explicit reporting-currency fields.
- Child rows show account-level data, mirror parent table columns, and link to account-scoped ticker pages.
- Average cost is all-in weighted average cost including fees and taxes.
- `/dashboard`, `/portfolio`, `/tickers/[ticker]`, and `/share/[token]` are V1 implementation surfaces.
- Holdings toolbar uses shadcn-style `ToggleGroup` for display mode and dropdown/popover controls for market, accounts, status, and columns.
- Allocation basis supports `Market value | Cost basis`, persists as a user display preference, and defaults to market value.
- Missing quotes fall back to cost basis for allocation where appropriate and are labeled.
- V1 includes aggregated-holdings chart work for dashboard, portfolio, ticker, and share pages.
- Non-V1 route analytics are captured as roadmap notes.

## Implementation Steps

- [x] Add shared DTOs for grouped holdings: parent row, account child row, reporting fields, FX status, and allocation basis.
- [x] Implement API-owned aggregation by `(ticker, marketCode/currency)` while preserving current account-level `holdings` semantics.
- [x] Calculate parent native fields: quantity, all-in weighted average cost, current unit price, cost basis, market value, unrealized P&L, day change, dividend dates, and quote status.
- [x] Calculate explicit reporting fields: reporting cost basis, reporting market value, reporting unrealized P&L, reporting allocation percent, reporting currency, and FX status.
- [x] Implement missing-quote allocation fallback to cost basis with a UI-visible degradation label.
- [x] Add persisted allocation-basis user preference with default `market value`.
- [x] Update dashboard holdings table to render aggregated parent rows and expandable account child rows.
- [x] Update dashboard allocation chart and biggest movers to consume grouped holdings and the selected allocation basis.
- [x] Update portfolio holdings table with grouped rows, expansion, shadcn-style filter toolbar, column controls, market/account/status filters, and allocation-basis toggle.
- [x] Update ticker detail route so `/tickers/{ticker}?marketCode={marketCode}` defaults to aggregated ticker/market view.
- [x] Update account-scoped ticker links to use `/tickers/{ticker}?marketCode={marketCode}&accountId={accountId}`.
- [x] Add ticker account breakdown table and account contribution chart.
- [x] Update ticker price vs average cost chart to use aggregated average cost by default.
- [x] Update public share view to show aggregated holdings and a public-safe allocation chart without account child rows.
- [x] Capture route-by-route future analytics roadmap for `/transactions`, `/dividends`, `/cash-ledger`, `/settings/tickers`, and `/admin`.
- [x] Run `/aaa` to add or update E2E tests covering grouped holdings, expansion, toolbar filters, allocation-basis persistence, ticker aggregate/account navigation, and public share aggregation.
- [x] Add focused unit tests for aggregation math, FX/reporting semantics, missing quote fallback, and persisted preference behavior.

## Open Items

- [x] Confirm final DTO field names before implementation starts. Final fields live in `libs/shared-types/src/index.ts`.
- [x] Confirm whether grouped holdings should be cached/memoized on the API read path if dashboard payload generation becomes slow. V1 keeps aggregation on the existing overview read path and leaves caching as a future performance optimization if payload generation becomes measurable.

## Implementation Notes

- Authenticated overview payloads now expose `holdingGroups` while preserving `holdings`.
- Dashboard and portfolio reuse the grouped table; portfolio defaults to the compact aggregated mode, dashboard uses expanded grouped rows.
- Public share payloads expose grouped ticker/market rows only. Cost basis, average cost, and account child identities remain private.
- Route analytics and chart ideas beyond the V1 surfaces are captured in `route-analytics-roadmap-20260601.md`.

## References

- Scope debate note: none
- Linear tickets: none
