# Debate: instrument_type Column Strategy for KZO-83

**Date:** 2026-03-31  
**Status:** Resolved — unanimous consensus  
**Decision:** Option A (keep both columns, classify at sync time)  
**Vote:** 5/5 (Architect, DBA, Backend, Frontend, QA)  
**Rounds:** 1 (consensus reached immediately)

---

## Contested Question

When adding raw FinMind fields (`type_raw`, `industry_category_raw`) to `market_data.instruments` for the TWSE catalog sync (KZO-83), what is the best strategy for the existing `instrument_type` column (STOCK/ETF/BOND_ETF)?

## Approaches Evaluated

| Option | Description | Supporters |
|--------|-------------|------------|
| **A** | Keep both columns — classify at sync time | **5/5** |
| B | Drop instrument_type — classify at read time | 0/5 |
| C | PostgreSQL generated column (GENERATED ALWAYS AS) | 0/5 |
| D | Mapping table (category_mappings joined at query time) | 0/5 |
| E | Drop from instruments, classify at trade creation boundary only | 0/5 |

## Decision: Option A

Add `type_raw TEXT NULL` and `industry_category_raw TEXT NULL` to `market_data.instruments`. Keep `instrument_type` as a regular column (relaxed to nullable). The catalog sync function calls `classifyInstrument()` and writes all three columns during upsert.

### Schema Change

```sql
ALTER TABLE market_data.instruments
  ADD COLUMN type_raw TEXT,
  ADD COLUMN industry_category_raw TEXT;

ALTER TABLE market_data.instruments
  ALTER COLUMN instrument_type DROP NOT NULL;
```

### What Changes

- **Migration:** Add two raw columns, relax `instrument_type` NOT NULL
- **Sync function:** New code calling `classifyInstrument()`, writing all three columns in upsert
- **Upsert query:** Extend `postgres.ts:1584-1609` with new columns

### What Does NOT Change

- All persistence read paths (`getInstrument`, `getMonitoredSet`, `listInstrumentsCatalog`)
- All service layer consumers (`store.ts`, `portfolio.ts`, `dashboard.ts`)
- Route definitions and Zod schemas (`registerRoutes.ts:1494`)
- Domain types (`InstrumentRef`, `InstrumentDef`) — remain non-null for classified instruments
- DTO contracts (`InstrumentOptionDto`, `InstrumentCatalogItemDto`, `MonitoredTickerDto`)
- Frontend components (`InstrumentCatalogSheet`, `AddTransactionCard`, `AppShell`)
- All existing test fixtures (33+ seed calls across 5 test files)

## Key Arguments by Role

### Architect — Boundary Clarity
The sync function is the Ports & Adapters boundary between FinMind (external) and the domain model (internal). Classification belongs at this adapter, not scattered across read paths (B) or pushed to a different bounded context (E). Raw columns = external port; `instrument_type` = internal classification. Both coexist in the same row for auditability.

### DBA — Generated Column Killed
Option C is technically feasible (PostgreSQL GENERATED ALWAYS AS can reference `ticker` for Bond ETF detection via `LIKE '%B'`). Three operational problems kill it:
1. **No ALTER expression syntax** — changing classification requires DROP + ADD column (destructive DDL)
2. **Upsert rejection** — PostgreSQL rejects writes to generated columns; existing upsert logic must be rewritten
3. **NULL cascade** — identical to Option B's blast radius through domain types and DTOs

Option A keeps classification in code (redeploy + re-sync), not DDL (migration).

### Backend — Service Boundary Preserved
Persistence read methods are data mappers, not business logic hosts. Option B places `classifyInstrument()` (business rules: ETN exclusion, ticker-suffix heuristics) in every `get*()` method. Option A confines it to the single write path (sync function). SQL `WHERE instrument_type = $type` filtering preserved — broken by B and E.

### Frontend — Zero DTO Blast Radius
Three non-null DTO contracts depend on materialized `instrument_type`:
- `InstrumentOptionDto.instrumentType: InstrumentType` — trade creation dropdown (line 114)
- `InstrumentCatalogItemDto.instrumentType: InstrumentType` — catalog type filter (line 40)
- `MonitoredTickerDto.instrumentType: InstrumentType | null` — already nullable for provisionals

Option E shatters both non-null contracts. The frontend needs classified types at **instrument selection time**, not trade creation time — the type label appears in the ticker dropdown before any trade is submitted.

### QA — Zero Test Fixture Changes
33+ `_seedInstrument` / `seedInstrument` calls across `monitored-tickers.test.ts` (17), `monitored-tickers.integration.test.ts` (11), and `monitored-tickers-aaa.spec.ts` (5) all pass `instrumentType` directly. Under Option A, none change. Under B/E, all break. Under C, MemoryPersistence must independently reimplement classification logic — creating a divergence risk with no test catching SQL/TS mismatches.

## Rejected Options — Key Reasons

| Option | Fatal Flaw |
|--------|-----------|
| B (read-time classify) | Breaks SQL filtering on `listInstrumentsCatalog`. Forces `classifyInstrument()` into every persistence read method. Widens `InstrumentType` to nullable across 10+ files. |
| C (generated column) | No ALTER expression syntax — logic changes require destructive DDL. Upsert must exclude column. NULL cascade = same blast radius as B. Dual implementation (SQL + TS) with no cross-path test. |
| D (mapping table) | Bond ETF detection requires cross-column logic (`industry_category_raw` + `ticker`). Can't express in a pure category→type mapping. Over-engineered for ~57 categories. |
| E (trade boundary only) | Breaks `GET /instruments?type=ETF` route and catalog type filter UI. Frontend needs type at instrument selection, not trade creation. |

## Evaluation Scorecard

| Criterion | A | B | C | D | E |
|-----------|---|---|---|---|---|
| Blast radius | **~2 files** | 10+ files | ~3 files + DDL | 5+ files | 10+ files |
| Data integrity | Re-sync recovers | Always fresh | Always fresh | JOIN-dependent | Partial (trades only) |
| Schema cleanliness | Redundant but explicit | Pure | Auto-derived | Normalized | Minimal |
| Testability | **Zero fixture changes** | All fixtures break | Dual-impl risk | New JOIN fixtures | All fixtures break |
| Future flexibility | Code change + re-sync | Code change only | DDL migration | Table update | Code change |
| Query ergonomics | **Native SQL filter** | App-side classify | Native SQL filter | JOIN | No filter on instruments |
| Provisional handling | **Natural** | Type widening required | Type widening required | JOIN returns NULL | No type until trade |

## Staleness Mitigation

If classification logic changes, two recovery paths:

1. **Re-run catalog sync** — the sync function overwrites `instrument_type` for all non-provisional instruments
2. **One-liner backfill** (DBA-provided):
```sql
UPDATE market_data.instruments SET instrument_type = (
  CASE WHEN industry_category_raw IS NULL THEN instrument_type
       WHEN industry_category_raw IN ('ETF','上櫃ETF','上櫃指數股票型基金(ETF)')
         THEN CASE WHEN ticker LIKE '%B' THEN 'BOND_ETF' ELSE 'ETF' END
       WHEN industry_category_raw IN ('ETN','指數投資證券(ETN)','Index','大盤','存託憑證','受益證券','所有證券')
         THEN NULL
       ELSE 'STOCK'
  END
);
```

## Nullable Boundary

- `instruments.instrument_type` becomes **nullable** (unmappable categories like ETN, provisional instruments)
- `trade_events.instrument_type` stays **NOT NULL** — trades cannot be created for unclassified instruments
- Guard at trade creation: if `instrument.type` is null, reject with 400

## Participants

| Role | Agent | Model | Position |
|------|-------|-------|----------|
| Moderator | moderator | opus | Non-voting |
| Architect | architect | opus | Option A |
| DBA | dba | opus | Option A |
| Backend | backend | opus | Option A |
| Frontend | frontend | sonnet | Option A |
| QA | qa | sonnet | Option A |
