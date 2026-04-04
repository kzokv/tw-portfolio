---
slug: kzo-90
source: scope-grill
created: 2026-04-03
tickets: [KZO-90]
required_reading: []
superseded_by: null
---

# Todo: KZO-90 — Dividend Event Ingestion Baseline

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also read the KZO-90 Linear ticket description for full context.

## Key Decisions (from scope grill)

- Dividend-only re-ingestion (job type + admin endpoint) deferred to KZO-133
- `POST /dividend-events` removed — dividend events come from providers only
- Loose FinMind typing — only 3 new fields on `FinMindDividendRow`, raw row as `Record<string, unknown>` for JSONB passthrough
- `saveDividendEventTx` (private) keeps separate type from ingestion path — different bounded contexts, new columns as NULL
- `raw_provider_data` verified via raw SQL in integration tests (not via loadStore)
- No dedicated backfill worker integration test — upsert + mapper tests provide transitive coverage
- Integration test seeding switches from removed POST route to `upsertDividendEvents`

## Implementation Steps

### Schema & Types

- [ ] New migration file (019+): add 4 nullable columns to `market_data.dividend_events` — `fiscal_year_period TEXT`, `announcement_date DATE`, `total_distribution_shares NUMERIC`, `raw_provider_data JSONB`
- [ ] Expand `DividendRecord` (market-data/types.ts): add `fiscalYearPeriod`, `announcementDate`, `totalDistributionShares`, `rawProviderData: Record<string, unknown>`
- [ ] Expand `DividendEvent` (store.ts): add 3 optional typed fields (`fiscalYearPeriod?`, `announcementDate?`, `totalDistributionShares?`). No `rawProviderData`.

### FinMind Mapper

- [ ] Add 3 fields to `FinMindDividendRow` interface: `year` (string), `AnnouncementDate` (string), `ParticipateDistributionOfTotalShares` (number)
- [ ] Update `fetchDividendEvents()` mapper: extract 3 typed fields + pass full raw row as `rawProviderData` via spread (`{ ...row } as Record<string, unknown>`)

### Write Path

- [ ] `upsertDividendEvents()` (upserts.ts): add 4 columns to INSERT + ON CONFLICT UPDATE SET. `raw_provider_data` uses full replace (not JSONB merge).
- [ ] `saveDividendEventTx()` (postgres.ts, private): add 4 new columns as NULL to INSERT and ON CONFLICT UPDATE SET. Parameter indices shift — verify carefully.

### Read Path

- [ ] `loadStore()` (postgres.ts): add `fiscal_year_period`, `announcement_date`, `total_distribution_shares` to SELECT. Map to `DividendEvent` optional fields. Skip `raw_provider_data`.

### Route Removal

- [ ] Remove `POST /dividend-events` route from `registerRoutes.ts`
- [ ] Remove `dividendEventSchema` (Zod validation for the POST body)
- [ ] Remove `createDividendEvent` function (if standalone)
- [ ] Remove `saveDividendEvent` public method from persistence interface (`persistence/types.ts`)
- [ ] Remove `saveDividendEvent` implementation from `postgres.ts`
- [ ] Remove `saveDividendEvent` implementation from `memory.ts`
- [ ] Verify `GET /dividend-events` still works

### Test Changes

- [ ] 4 integration tests switch seeding from `POST /dividend-events` to `upsertDividendEvents`: `dividends.integration.test.ts:32`, `:135`, `dashboard.integration.test.ts:96`, `:128`
- [ ] Unit test: FinMind mapper extracts 3 new typed fields + rawProviderData passthrough
- [ ] Integration test: `upsertDividendEvents` writes all 4 new columns — verify JSONB contents via raw SQL (`SELECT raw_provider_data FROM market_data.dividend_events WHERE id = $1`)
- [ ] Integration test: `loadStore()` returns 3 new optional fields on `DividendEvent`
- [ ] Verify existing backfill-related tests still pass (nullable columns, optional type fields — nothing should break)

## Open Items

- [ ] KZO-133 note: `getAllMonitoredTickers()` filters on `bars_backfill_status = 'ready'` — dividend-only re-ingestion may need a variant without that filter

## References

- Linear ticket: [KZO-90](https://linear.app/kzokv/issue/KZO-90)
- Deferred work: KZO-133 (admin endpoint + dividend-only re-ingestion)
- Current migration: `db/migrations/018_market_data_schema.sql`
- FinMind mapper: `apps/api/src/services/market-data/finmindClient.ts`
- Upsert layer: `apps/api/src/services/market-data/upserts.ts`
- Postgres store: `apps/api/src/persistence/postgres.ts`
- Routes: `apps/api/src/routes/registerRoutes.ts`
