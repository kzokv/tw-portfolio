---
name: Market Data Platform progress
description: Ticket completion state, ordering decisions, and identified gaps for the Market Data Platform project
type: project
---

## Completed tickets (as of 2026-04-21, KZO-155 complete)

### Market Data Platform (epic)
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
| KZO-87 | EOD quote snapshot resolution | 2026-04-02 |
| KZO-20 | EOD market data valuation enrichment | 2026-04-05 |
| KZO-133 | app_config table + repair_available_at DTO field | 2026-04-15 |

### Dividends, cash ledger, snapshots (parallel tracks)
| Ticket | Title | Completed |
|---|---|---|
| KZO-37 | Dividend calendar + posting UI | 2026-04-08 |
| KZO-28 | Cash ledger API + page | 2026-04-08 |
| KZO-27 | Cash ledger entry rules reference doc | 2026-04-08 |
| KZO-32 | Reconciliation queue UI | 2026-04-09 |
| KZO-31 | Reconciliation filter params on dividend ledger endpoint | 2026-04-09 |
| KZO-135 | Pagination, sorting, filtering, aggregates on dividend ledger endpoint | 2026-04-10 |
| KZO-136 | Dividend review view | 2026-04-11 |
| KZO-137 | Cash ledger pagination, sorting, filtering, mobile cards | 2026-04-12 |
| KZO-134 | ETF distribution source-aware tax & NHI projection | 2026-04-12 |
| KZO-115 | Per-holding daily snapshots + mutation-scoped recompute + UI | 2026-04-14 |

### KZO-141 epic (users, roles, invites, sharing — in progress)
| Ticket | Title | Status |
|---|---|---|
| KZO-143 | Foundations — role, invites, session_version, INITIAL_ADMIN_EMAIL | Complete 2026-04-16 |
| KZO-144 | Admin management portal — shell + users + invites + audit log | Complete 2026-04-17 |
| KZO-145 | User-to-user share grant UI — schema, API, /sharing page, AAA specs | Complete 2026-04-18 |
| KZO-146 | User-to-user portfolio sharing — switcher UX | Complete 2026-04-18 (merged to dev: `78824b6`) |
| KZO-147 | Anonymous share tokens — public read-only route | Complete (merged to dev) |
| KZO-149 | Hard-purge cascade extension — anonymous_share_tokens cascade | Complete 2026-04-19 |
| KZO-142 | Admin settings UI — GET/PATCH /admin/settings + settings tab | Complete 2026-04-19 |
| KZO-148 | Admin impersonation — support-debug mode | Complete 2026-04-20 (docs landed `ebfb149`) |
| KZO-151 | Sharing notifications i18n + detail.kind discriminator | Complete 2026-04-20 (`7c9a92a`, `dd478ab`, `80fd2fb`) |
| KZO-152 | Cron: prune terminal anonymous_share_tokens (90d retention) | Complete 2026-04-21 (`508360b`) |
| KZO-153 | Deferred admin CLI integration tests + migration 030 collision detection | Complete 2026-04-21 (`34e6737`) |
| KZO-155 | Extract sliding-window rate limiters into apps/api/src/lib/ | Complete 2026-04-21 (this worktree) |

## Next up

- Notification preferences UI (mute by source, snooze escalation)
- Email digest of unread failure notifications
- Backup/restore script for market_data (ADR §5-6 gap, still unscoped)

## Known gaps

- **Backup/restore**: ADR describes post-ingest backup automation (pg_dump, auto-restore to dev, manual scp to local) — no ticket scopes it. Needs a separate ops ticket.
- **Legacy test drift** under `apps/api/test/{integration,unit}/` (~14 pre-existing type errors surfaced when the new test tsconfig was briefly widened) — cleanup ticket pending.
- **Notification i18n**: partially addressed by KZO-151 for sharing notifications; remaining notification surfaces still emit English-only. Repo-wide localization pass still open.
- **Rate-limit bucket eviction**: ~~open~~ — closed by KZO-155. Both buckets now evict via `registerInviteStatusEviction` + `registerAnonymousShareEviction` helpers.
