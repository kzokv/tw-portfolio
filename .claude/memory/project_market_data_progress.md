---
name: Market Data Platform progress
description: Ticket completion state, ordering decisions, and identified gaps for the Market Data Platform project
type: project
---

## Completed tickets (as of 2026-04-18, KZO-146 pre-PR)

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
| KZO-145 | User-to-user share grant UI — schema, API, /sharing page, AAA specs | Complete 2026-04-18 (merged to dev: `fc77731` → `04ffd18`) |
| KZO-146 | User-to-user portfolio sharing — switcher UX | **In active worktree (2026-04-18)** — implementation complete, code-review-then-fix done, 7-suite green, pre-PR |
| KZO-147 | Anonymous share tokens — public read-only route | Scoped, not started |
| KZO-148 | Admin impersonation — support-debug mode | Scoped, not started |
| KZO-142 | Admin settings UI — GET/PATCH /settings | Scoped (repositioned), not started |

## Next up

- KZO-146 PR merge (portfolio switcher UX + 6 HTTP + 8 UI E2E AAA specs, including 2 stretch)
- KZO-147 anonymous share tokens
- KZO-148 admin impersonation (unblocked by KZO-146's `isSharedContext` flag; will pair with a future `isImpersonating` flag)
- Notification preferences UI (mute by source, snooze escalation)
- Email digest of unread failure notifications
- Backup/restore script for market_data (ADR §5-6 gap, still unscoped)

## Known gaps

- **Backup/restore**: ADR describes post-ingest backup automation (pg_dump, auto-restore to dev, manual scp to local) — no ticket scopes it. Needs a separate ops ticket.
- **Legacy test drift** under `apps/api/test/{integration,unit}/` (~14 pre-existing type errors surfaced when the new test tsconfig was briefly widened) — cleanup ticket pending.
- **Notification i18n**: server emits English-only titles/bodies; zh-TW users see English. Deferred — belongs with a repo-wide notification-localization pass.
