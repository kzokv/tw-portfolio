---
slug: kzo-20
source: scope-grill
created: 2026-04-04
tickets: [KZO-20]
required_reading: []
superseded_by: null
---

# Todo: KZO-20 — EOD Market Data Valuation Enrichment

> **For agents starting a fresh session:** read this file and the KZO-20 Linear ticket before starting implementation.

## Context

Holdings and portfolio summary already consume persisted market data via `resolveQuoteSnapshots()` → `market_data.daily_bars` for `currentUnitPrice`, `marketValueAmount`, and `unrealizedPnlAmount`. However, the daily change fields (`change`, `changePercent`, `previousClose`) computed by `QuoteSnapshot` are discarded before reaching the DTO. KZO-20 surfaces these fields and adds portfolio-level daily change.

## Implementation Steps

### Backend — Shared Types (`libs/shared-types/src/index.ts`)

- [x] Add to `DashboardOverviewHoldingDto`: `change: number | null`, `changePercent: number | null`, `previousClose: number | null`, `quoteStatus: "current" | "provisional" | "missing"`
- [x] Add to `DashboardOverviewSummaryDto`: `dailyChangeAmount: number | null`, `dailyChangePercent: number | null`

### Backend — Dashboard Service (`apps/api/src/services/dashboard.ts`)

- [x] In `buildDashboardOverview`, pass through `change`, `changePercent`, `previousClose` from `QuoteSnapshot` to each holding DTO (currently only `quote.close` is used)
- [x] Derive `quoteStatus` per holding: `"missing"` when no quote, `"provisional"` when `QuoteSnapshot.isProvisional === true`, `"current"` otherwise
- [x] Compute portfolio-level `dailyChangeAmount` as `sum(quantity × change)` across all holdings
- [x] Compute portfolio-level `dailyChangePercent` as `dailyChangeAmount / previousMarketValue × 100` where `previousMarketValue = sum(quantity × previousClose)`
- [x] Null-propagation: if any holding has `quoteStatus === "missing"`, set portfolio-level `dailyChangeAmount` and `dailyChangePercent` to `null`

### Frontend — Dashboard Components (`apps/web/`)

- [x] Per-holding: display `change` / `changePercent` with green/red color coding, separate from unrealized P&L
- [x] Portfolio summary: display `dailyChangeAmount` / `dailyChangePercent` with green/red color coding
- [x] `quoteStatus === "missing"`: visible indicator (badge/tooltip: "no market data")
- [x] `quoteStatus === "provisional"`: subtle indicator (clock icon or dimmed text)
- [x] `quoteStatus === "current"`: no extra treatment

### Integration Tests (`apps/api/test/integration/`)

- [x] Happy path: holdings with 2+ seeded bars → all change fields populated, `quoteStatus: "current"`, portfolio summary has `dailyChangeAmount` and `dailyChangePercent`
- [x] Single bar: ticker with 1 bar → `currentUnitPrice` populated, `change`/`changePercent`/`previousClose` null, `quoteStatus: "current"`
- [x] Missing quote: ticker with no bars → all valuation fields null, `quoteStatus: "missing"`, portfolio summary change fields null
- [x] Mixed: some holdings with quotes + one without → per-holding correct, portfolio summary nulled out

## Scope Boundary

- **In scope:** `GET /dashboard/overview` route only (backend + frontend)
- **Out of scope:** enriching `GET /portfolio/holdings`, real-time/intraday quotes, dividend changes (KZO-90)

## References

- Linear ticket: KZO-20
- Key files: `libs/shared-types/src/index.ts`, `apps/api/src/services/dashboard.ts`, `apps/api/src/services/market-data/quoteSnapshotService.ts`, `apps/api/src/routes/registerRoutes.ts`
