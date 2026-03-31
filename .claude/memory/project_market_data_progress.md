---
name: Market Data Platform progress
description: Ticket completion state, ordering decisions, and identified gaps for the Market Data Platform project
type: project
---

## Completed tickets (as of 2026-03-31)

| Ticket | Title | Completed |
|---|---|---|
| KZO-82 | Normalized market data contract + schema | 2026-03-26 |
| KZO-122 | ADR: store topology + environment policy | 2026-03-25 |
| KZO-123 | user_monitored_tickers join table + settings UI | 2026-03-30 |
| KZO-124 | Migrate unit_price to NUMERIC(20,2) | 2026-03-30 |
| KZO-126 | Backfill job queue + pg-boss + FinMind client | 2026-03-31 |
| KZO-127 | Glossary rename symbol→ticker | 2026-03-30 |

## Next up

**KZO-83** (instrument catalog sync from FinMind) before **KZO-130** (daily refresh worker).

**Why:** ADR Section 3 prescribes catalog → user selection → backfill → daily refresh. Without the full ~1,000 TWSE catalog, the monitored set is near-empty and daily refresh is a no-op. Analysis frozen at `docs/004-notes/005-market-data/analysis-202603311000-kzo83-before-kzo130.md`.

## Backup/restore script gap

ADR Section 5-6 describes post-ingest backup automation (pg_dump, auto-restore to dev, manual scp to local) but no ticket scopes it. Needs to be folded into KZO-130 or a separate ops ticket.

## Current instrument catalog state

`market_data.instruments` contains only ~4 hardcoded entries + provisional records. No `sector_raw`/`industry_raw` columns, no `listed_date` from FinMind, no full TWSE catalog.
