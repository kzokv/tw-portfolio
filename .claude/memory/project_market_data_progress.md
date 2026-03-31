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
| KZO-83 | Instrument catalog sync from FinMind | 2026-03-31 (pending merge) |

## Next up

**KZO-130** (daily refresh worker) — KZO-83 is complete (pending merge as of 2026-03-31).

## Backup/restore script gap

ADR Section 5-6 describes post-ingest backup automation (pg_dump, auto-restore to dev, manual scp to local) but no ticket scopes it. Needs to be folded into KZO-130 or a separate ops ticket.
