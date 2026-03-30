---
slug: kzo-124
source: scope-grill
created: 2026-03-30
tickets: [KZO-124]
required_reading: []
superseded_by: null
---

# Todo: KZO-124 — Migrate unit_price from INTEGER to NUMERIC(20,2)

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also read `AGENTS.md` and the `.claude/rules/migration-strategy.md` rule.

## Key Decisions

- **NUMERIC(20,2)** not (20,4) — ledger needs TWD cents precision only; market_data keeps 4dp for dividends/NAVs
- **Fees stay INTEGER** — commission/tax are invoiced in whole TWD by TWSE brokers
- **No decimal library** — `Number()` coercion from Postgres NUMERIC is safe within realistic TWD value ranges
- **Hard-code 2dp rounding** — configurable precision is a follow-up ticket
- **`roundToDecimal` must use `parseFloat(value.toFixed(n))`** — not `Math.round(x * 100) / 100` (broken at .5 boundaries due to IEEE 754)
- **Validate at API boundary** — reject >2dp with `z.number().positive().multipleOf(0.01)`, no silent truncation

## Implementation Steps

### Database
- [x] Create `db/migrations/020_decimal_prices.sql` — ALTER COLUMN for `trade_events.unit_price`, `lots.total_cost_amount`, `lot_allocations.allocated_cost_amount` to `NUMERIC(20,2)` (note: `realized_pnl_amount` is computed, not a column — omitted from migration)
- [x] Update `db/migrations/baseline_current_schema.sql` — change CREATE TABLE definitions to use `NUMERIC(20,2)` for the same columns

### Domain layer (`libs/domain/src/`)
- [x] Add `roundToDecimal(value: number, places: number): number` to `money.ts` — use `parseFloat(value.toFixed(n))`. Do NOT modify existing `applyRounding`
- [x] `lot.ts`: Remove `Number.isInteger()` check from `assertNonNegativeCost` — keep `>= 0` check
- [x] `lot.ts`: Replace `Math.round()` with `roundToDecimal(x, 2)` in `normalizeLotsForWeightedAverage` cost distribution
- [x] `lot.ts`: Round `averageCostAmount` to 2dp in `summarizeOpenLots`

### Service layer (`apps/api/src/services/`)
- [x] `portfolio.ts`: Wrap `quantity * unitPrice` in `roundToDecimal(..., 2)` in cost basis computation
- [x] `dashboard.ts`: Wrap `quantity * unitPrice` in `roundToDecimal(..., 2)` in cost/proceeds accumulation; round final aggregated totals to 2dp before API response
- [x] `accountingStore.ts`: Wrap `quantity * unitPrice` in `roundToDecimal(..., 2)` in net proceeds calculation; round holdings costBasisAmount in `rebuildHoldingProjection`
- [x] Realized P&L: Round to 2dp at computation time
- [x] `recompute.ts`: Wrap `quantity * unitPrice` in `roundToDecimal(..., 2)` in fee recalculation and settlement
- [x] `replayPositionHistory.ts`: Wrap `quantity * unitPrice` in `roundToDecimal(..., 2)` in lot cost, proceeds, and settlement

### API routes (`apps/api/src/routes/`)
- [x] `registerRoutes.ts`: Change `unitPrice` validation from `z.number().int().positive()` to `z.number().positive().multipleOf(0.01)` in POST transaction schema (both schemas)
- [x] `registerRoutes.ts`: Change PATCH route `unitPrice` coercion from `.int().positive()` to `.positive().multipleOf(0.01)`

### Persistence layer
- [x] Verify `Number(row.unit_price)` coercion in `postgres.ts` handles NUMERIC strings correctly — also added `Number()` coercion for `total_cost_amount` and `allocated_cost_amount` reads (Postgres returns NUMERIC as strings)

### Test fixtures & demo data
- [x] Add decimal-price test cases to unit tests (e.g., ETF at 152.35)
- [x] Add decimal-price test cases to integration tests (+ >2dp rejection test)
- [x] Update `demoData.ts`: Change 0050 ETF `unitPrice` to realistic decimals (185.50, 189.25, 192.10)
- [x] Add domain tests for `roundToDecimal` edge cases (.5 boundary, negative values, float artifacts)
- [x] Add lot allocation tests with decimal costs (buy, distribute, sell)

### Verification
- [x] Run all 7 test suites (see `.claude/rules/full-test-suite.md`)

## Out of Scope

- Fee engine changes (commission/tax remain INTEGER)
- User-configurable rounding precision (follow-up ticket created)
- Decimal library / string-based arithmetic
- UI display formatting changes
- NUMERIC(20,4) for ledger columns — 2dp is sufficient for TWD

## References

- Linear ticket: KZO-124
- Market data precedent: `db/migrations/018_market_data_schema.sql` (NUMERIC(20,4) for OHLC)
- Lot allocation: `libs/domain/src/lot.ts`
- Fee engine: `libs/domain/src/fee.ts`, `libs/domain/src/money.ts`
- Follow-up ticket: KZO-128 — configurable rounding precision
