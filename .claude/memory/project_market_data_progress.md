---
name: Market Data Platform progress
description: Ticket completion state, ordering decisions, and identified gaps for the Market Data Platform project
type: project
---

## Completed tickets (as of 2026-04-01)

| Ticket | Title | Completed |
|---|---|---|
| KZO-82 | Normalized market data contract + schema | 2026-03-26 |
| KZO-122 | ADR: store topology + environment policy | 2026-03-25 |
| KZO-123 | user_monitored_tickers join table + settings UI | 2026-03-30 |
| KZO-124 | Migrate unit_price to NUMERIC(20,2) | 2026-03-30 |
| KZO-126 | Backfill job queue + pg-boss + FinMind client | 2026-03-31 |
| KZO-127 | Glossary rename symbol→ticker | 2026-03-30 |
| KZO-83 | Instrument catalog sync from FinMind | 2026-03-31 |
| KZO-129 | Searchable instrument combobox | 2026-04-01 |
| KZO-130 | Daily refresh worker for monitored symbols | 2026-04-01 |
| KZO-132 | Notification center + daily refresh SSE handling | 2026-04-01 |

## Next up

Follow-up tickets from KZO-132 (out of scope):
1. Wire backfill failures into notification center as `source: 'backfill'`
2. Wire recompute failures into notification center as `source: 'recompute'`
3. Notification preferences UI (mute by source, snooze escalation)
4. Email digest of unread failure notifications

## Backup/restore script gap

ADR Section 5-6 describes post-ingest backup automation (pg_dump, auto-restore to dev, manual scp to local) but no ticket scopes it. Needs to be folded into KZO-130 or a separate ops ticket.
