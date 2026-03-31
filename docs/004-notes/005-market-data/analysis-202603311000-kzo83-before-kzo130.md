# Analysis: KZO-83 Before KZO-130 Ordering Decision

**Date:** 2026-03-31
**Status:** Frozen snapshot
**Tickets:** KZO-83, KZO-130
**Related:** KZO-122 ADR, KZO-126, KZO-129

## Decision

KZO-83 (instrument catalog sync from FinMind) must be implemented before KZO-130 (daily refresh worker).

## Execution Order

| Order | Ticket | Rationale |
|---|---|---|
| 1 | KZO-83 | Populate full TWSE catalog — unlocks everything downstream |
| 2 | KZO-130 | Daily refresh cron + backup/restore scripts from ADR Section 5-6 |
| 3 | KZO-129 | Ticker picker (blocked by KZO-83, optional but improves data quality) |

## Reasoning

### 1. ADR Section 3 prescribes this sequence

The KZO-122 ADR explicitly describes the progression:

1. Instrument reference sync (periodic, all symbols) populates `market_data.instruments` — powers the symbol selection UI
2. Users configure monitored symbols, selecting from the full TWSE instrument list
3. When a new symbol enters the monitored set, an async backfill job is enqueued

Daily refresh is downstream of this chain. Without step 1, the monitored set stays near-empty.

### 2. Daily refresh without a catalog is a no-op

`market_data.instruments` currently contains only data migrated from the old `public.symbols` table — a handful of hardcoded entries (2330, 0050, 00919, 0056) plus provisional records created ad-hoc when users entered trades. No `name`, no `sector_raw`/`industry_raw`, no `listed_date` from FinMind. The full ~1,000 TWSE catalog is not present.

KZO-130 fetches new bars for the "distinct union of monitored symbols across all users." That's ~4 tickers today. The cron job would make ~8 FinMind calls daily and do nothing useful.

### 3. KZO-129 is also blocked on KZO-83

The ticker picker (replacing free-text input with a catalog-backed typeahead) requires a populated instrument catalog. This is a data quality gate.

### 4. Backup/restore becomes meaningful only with real data

The ADR's backup plan (post-ingest `pg_dump -n market_data` → auto-restore to dev → manual scp to local) produces useful dumps only when `market_data` contains the full catalog + backfilled bars.

## Observation: Backup/Restore Script Gap

The KZO-122 ADR (Section 5-6) describes the following automation, but **no ticket currently scopes it**:

- Post-ingest cron script (runs after daily refresh completes)
- `pg_dump -n market_data` → `market_data_latest.dump`
- Prod → dev auto-restore (same QNAP host, shared filesystem)
- `npm run market-data:backfill` (prod) and `npm run market-data:restore` (dev/local)
- Ledger backup with 30-day rotation

The natural home for this is KZO-130, since the daily refresh IS the ingest event that triggers the backup pipeline. Alternatively, a separate ops ticket could scope the backup/restore cron independently.

### Bootstrapping sequence (from ADR, not yet implemented)

1. Deploy `market_data` schema migrations — **done**
2. Run KZO-83 catalog sync → populate full instrument catalog
3. Run initial backfill for monitored symbols (KZO-126 infra — **done**)
4. First `pg_dump -n market_data` → dump now has catalog + bars
5. Dev/local restore from that dump
6. KZO-130 daily refresh → re-dump → auto-restore cycle begins

## FinMind Client Gap

The existing FinMind client (from KZO-126) covers:
- `fetchDailyBars()` → `TaiwanStockPrice`
- `fetchDividendEvents()` → `TaiwanStockDividend`

KZO-83 requires a new method for instrument reference metadata (e.g., `TaiwanStockInfo` or equivalent). This is a new API call, not yet in the client.
