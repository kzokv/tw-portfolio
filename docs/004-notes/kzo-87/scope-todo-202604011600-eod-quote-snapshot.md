---
slug: kzo-87
source: scope-grill
created: 2026-04-01
tickets: [KZO-87]
required_reading:
  - docs/market-data-platform.md
  - docs/004-notes/005-market-data/04-canonical-types.md
superseded_by: null
---

# Todo: KZO-87 — EOD Quote Snapshot Resolution

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Agreed Decisions

1. **Scope narrowed** — quote snapshot resolution only. Snapshot materialization (Job 3) is a follow-up ticket.
2. **Field naming** — `close` not `price`. Honest for an EOD-first system.
3. **Enriched shape** — `{ close, previousClose?, change?, changePercent?, asOf, source, isProvisional }`. Derived fields (`previousClose`, `change`, `changePercent`) are `number | null` — nullable when ticker has < 2 bars in `daily_bars`.
4. **Derived fields computed in service** — single SQL query fetches latest 2 bars per ticker (window function, `PARTITION BY ticker ORDER BY bar_date DESC`). No double round-trip.
5. **`marketStatus` dropped** — `isProvisional` + `asOf` covers the freshness story. System has no live exchange connectivity; clock-derived market status is fragile (holidays, half-days).
6. **`isProvisional` logic** — weekend-aware date comparison in TST. If `bar_date < today` and today is a weekday, `isProvisional = true`. Weekends treat latest bar as non-provisional. Holiday false-positives accepted (cosmetic, not data-correctness).
7. **`asOf`** — always the bar's actual `bar_date`, not today's date. UI derives display: "Price as of {date}."
8. **REST endpoint** — `GET /quotes?tickers=2330,2317`, auth-required. Returns `Record<string, QuoteSnapshotDto | null>` (map keyed by ticker, explicit nulls for tickers with no bars).
9. **Mock provider retired** — delete `providers/marketData.ts` (`MockPrimaryProvider`, `MockFallbackProvider`, `getQuotesWithFallback`). Remove `getCachedQuotes`/`cacheQuotes` from persistence interface. These were placeholder scaffolding with hardcoded prices.
10. **Dashboard migration** — update `dashboard.ts` to accept `QuoteSnapshot[]` instead of `Quote[]`, use `close` instead of `unitPrice`.
11. **No Redis cache** — `daily_bars` is a local indexed table. Sub-millisecond for tens of tickers. Caching deferred until profiling shows need.

## Implementation Steps

### Service layer
- [x] Add `getLatestBars(tickers: string[], limit: number)` to persistence interface (`persistence/types.ts`)
- [x] Implement in `persistence/postgres.ts` — windowed query: `ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY bar_date DESC) WHERE rn <= $limit`
- [x] Implement in `persistence/memory.ts` — in-memory equivalent for unit tests
- [x] Create `apps/api/src/services/market-data/quoteSnapshotService.ts` — `resolveQuoteSnapshots(tickers: string[], persistence): Promise<Record<string, QuoteSnapshot | null>>`
  - Fetch latest 2 bars per ticker
  - Compute `previousClose`, `change`, `changePercent` (null if < 2 bars, null if `previousClose = 0`)
  - Compute `isProvisional`: weekend-aware TST date comparison against latest bar's `bar_date`
  - Return map with explicit nulls for tickers with 0 bars

### Types
- [x] Update `QuoteSnapshot` in `libs/domain/src/types.ts` — add `previousClose: number | null`, `change: number | null`, `changePercent: number | null`
- [x] Add `QuoteSnapshotDto` to `libs/shared-types/src/index.ts` — matches enriched shape for REST contract

### REST endpoint
- [x] Add `GET /quotes` route in `registerRoutes.ts` — auth-required, parses `tickers` query param, calls `resolveQuoteSnapshots`, returns `Record<string, QuoteSnapshotDto | null>`

### Mock provider retirement
- [x] Delete `apps/api/src/providers/marketData.ts`
- [x] Remove `getCachedQuotes` and `cacheQuotes` from `persistence/types.ts`, `persistence/postgres.ts`, `persistence/memory.ts`
- [x] Remove `resolveLatestQuotes` helper from `registerRoutes.ts`
- [x] Remove `Quote` type imports across the codebase

### Dashboard migration
- [x] Update `dashboard.ts` — accept `QuoteSnapshot[]` instead of `Quote[]`, use `close` instead of `unitPrice`
- [x] Update dashboard route in `registerRoutes.ts` to call `resolveQuoteSnapshots` instead of `resolveLatestQuotes`
- [x] Update any existing unit tests that use `Quote` fixtures to use `QuoteSnapshot` fixtures

### Test infrastructure (daily_bars seed — currently absent)
- [x] Add `daily_bars` storage to `MemoryPersistence` (`persistence/memory.ts`) — needed for unit tests
- [x] Add `/__e2e/seed-daily-bars` endpoint in `registerRoutes.ts` (dev/test only) — needed for E2E tests
- [x] Create fixture bar data — realistic TWSE bars (e.g., 2330 TSMC, multiple days) for unit + E2E use

### Tests
- [x] Unit tests for `quoteSnapshotService.ts` — happy path (2+ bars), single bar (nulls), zero bars (null), provisional logic (weekday vs weekend), `changePercent` with `previousClose = 0`
- [x] Integration test — insert fixture bars into `daily_bars`, call service, verify output
- [x] E2E test — seed bars via `/__e2e/seed-daily-bars`, hit `GET /quotes`, verify response shape
- [x] Update existing dashboard tests affected by `Quote` -> `QuoteSnapshot` migration

## Explicit Out-of-Scope

- Snapshot materialization (Job 3) — follow-up ticket
- `marketStatus` field — dropped, `isProvisional` + `asOf` sufficient
- Holiday-aware TWSE trading calendar
- Redis caching layer for quote snapshots
- Any FinMind API calls (this service reads `daily_bars` only)

## Implementation Notes

- **Holiday edge case:** On a TWSE holiday (weekday), `isProvisional` will be `true` all day, even after the 17:30 daily refresh runs (because FinMind returns no new bars for closed days). The price shown is correct; only the flag is overly cautious. Accepted for phase 1.
- **`changePercent` division guard:** If `previousClose = 0`, return `null` for all derived fields rather than dividing by zero.
- **Persistence query:** Use `ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY bar_date DESC)` for efficient batch fetch. The existing index `(ticker, bar_date)` supports this.

## References

- Linear ticket: [KZO-87](https://linear.app/kzokv/issue/KZO-87/implement-eod-quote-snapshot-and-valuation-policy-from-persisted)
- Architecture: `docs/market-data-platform.md` (Section 4: Read Paths)
- Canonical types: `docs/004-notes/005-market-data/04-canonical-types.md`
- Current mock provider: `apps/api/src/providers/marketData.ts` (to be deleted)
- Dashboard service: `apps/api/src/services/dashboard.ts`
- Persistence interface: `apps/api/src/persistence/types.ts`
