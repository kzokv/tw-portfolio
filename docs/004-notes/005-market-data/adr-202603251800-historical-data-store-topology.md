# ADR: Historical Market Data Store Topology and Environment Policy

**Date:** 2026-03-25
**Status:** Locked (frozen reference snapshot)
**Ticket:** [KZO-122](https://linear.app/kzokv/issue/KZO-122/define-historical-market-data-store-topology-and-environment-policy)
**Related:** [KZO-82](https://linear.app/kzokv/issue/KZO-82/define-normalized-market-data-contract-and-persistence-schema)

## Decision Summary

KZO-122 establishes the phase-1 storage topology, write ownership, read paths, environment policy, and backup strategy for historical market data. Decisions were locked through a structured grill session on 2026-03-25.

---

## 1. Physical Topology

**Decision: Same Postgres instance, dedicated `market_data` schema.**

- The existing Postgres instance gains a `market_data` schema alongside the `public` schema (which owns the transaction ledger).
- Cross-schema joins are supported natively (`public.lots JOIN market_data.daily_bars`).
- A separate microservice was considered and rejected for phase 1. Ingestion runs as a scheduled job inside the existing Fastify API, with module isolation at `apps/api/src/services/market-data/`.

**Why not a separate DB or microservice:**
- Phase 1 data volume is small (~1,000 symbols, daily EOD bars).
- Cross-schema joins are needed for valuation queries (KZO-20, KZO-87).
- A separate service adds deployment, monitoring, and coordination overhead with zero benefit at current scale.
- Can be extracted later if ingestion grows (intraday data, multiple providers).

---

## 2. Write Ownership

### Ledger-owned (`public` schema)

| Table | Owned data |
|---|---|
| `trade_events` | Transaction execution price (`unit_price`) — immutable per trade |
| `dividend_ledger_entries` | Per-account dividend postings (amounts received) |
| `dividend_deduction_entries` | Typed deductions (withholding, fees) |
| `lots` | Weighted-average inventory (account + symbol scoped) |
| `cash_ledger_entries` | Settlement cash and dividend cash |
| `daily_portfolio_snapshots` | Materialized portfolio NAV (see Section 4) |

### Market-data-owned (`market_data` schema)

| Table | Owned data |
|---|---|
| `instruments` | TWSE instrument reference metadata (all ~1,000 symbols) |
| `daily_bars` | Raw OHLCV daily bars (not adjusted) |
| `dividend_events` | Dividend event reference (ex-date, pay-date, amount-per-unit, source) |

### Key boundary

- **Transaction execution price** is ledger-owned, not reconstructed from historical bars.
- **Dividend events** (reference data from providers) live in `market_data`. Dividend **postings** (accounting: how much the user received, deductions) live in `public`. The ledger references the market data event via FK: `public.dividend_ledger_entries.dividend_event_id -> market_data.dividend_events.id`.
- **Adjusted prices are not stored.** Raw prices are stored in `market_data.daily_bars`. Adjusted prices are computed on the fly using split event data from FinMind (`TaiwanStockDividendResult`). This halves API budget and eliminates retroactive adjustment staleness.

---

## 3. Ingestion Model

### Provider

- **FinMind** is the sole provider for phase 1.
- Datasets: `TaiwanStockPrice` (daily OHLCV, since 1994), `TaiwanStockDividend` (since 2005).
- Rate limit: 600 requests/hour with authentication token.
- One request returns a symbol's full date range (no pagination needed).

### Demand-driven backfill

Historical bars are **not** backfilled for all ~1,000 TWSE symbols. Backfill is triggered only for symbols users care about:

1. **Instrument reference sync** (periodic, all symbols) populates `market_data.instruments` with metadata — this powers the symbol selection UI.
2. **Users configure monitored symbols** in the settings page, selecting from the full TWSE instrument list.
3. **Symbols with open positions** are auto-included in the monitored set, even if deselected from the watchlist.
4. When a new symbol enters the monitored set (user selection or first trade), an **async backfill job** is enqueued.
5. The user is **notified via SSE** when backfill completes. No waiting required — the user saves settings and the system handles it in the background.

### Backfill status

Per-symbol tracking: `pending -> backfilling -> ready -> failed`.

Partial success is kept — if 45/50 symbols succeed and 5 fail, the 45 are marked `ready` and the 5 are retried independently.

### Rate limit priority

Daily refresh has **priority** over backfill in the 600 req/hr budget. Fresh daily bars for existing symbols matter more than historical backfill for new ones. Implementation should use a priority queue: daily refresh jobs run first, backfill jobs fill remaining budget.

### Daily refresh scope

The daily refresh job fetches new bars for the **distinct union of monitored symbols across all users** — not per-user. `market_data.daily_bars` is shared, not user-scoped.

### Demo users

Demo users receive **fixture/seed data only**. No real FinMind API calls are triggered by demo sessions.

### Trading hours gap

FinMind updates at **17:30 TST**. Between market close (13:30) and the FinMind update, the UI shows: "Today's data not yet available, refreshes at 17:30". This aligns with the `isProvisional` / `asOf` pattern from KZO-87.

---

## 4. Read Paths

| Consumer | Data source | Schema(s) |
|---|---|---|
| Historical price charts | `market_data.daily_bars` | `market_data` only |
| Value-over-time charts | `public.daily_portfolio_snapshots` (materialized) | `public` only (pre-joined) |
| Dividend event calendar | `market_data.dividend_events` | `market_data` only |
| Received dividends / P&L | `public.dividend_ledger_entries` JOIN `market_data.dividend_events` | Cross-schema |
| Valuation-by-date | `public.daily_portfolio_snapshots` lookup | `public` only |

### Portfolio snapshot materialization (Option B)

Value-over-time and valuation-by-date queries read from **materialized `daily_portfolio_snapshots`**, not computed on the fly.

- A post-ingest job runs after daily bars land.
- For each user/account, it reconstructs positions at that date, multiplies by close price, and stores the snapshot row.
- Phase 1 (single/few users): trivial compute cost.
- **Migration to lazy/hybrid (Option C) is schema-compatible** — the snapshot table is identical regardless of write strategy. When user count warrants it, switch to compute-on-first-request without schema changes.

---

## 5. Environment Policy

### Network topology

```
QNAP (192.168.2.xxx)     <- LAN ->  Mac Host (192.168.2.yyy)  <- VM bridge ->  Lume VM (192.168.64.x)
  [prod + dev postgres]                                                          [local dev postgres]
```

Lume VM can reach QNAP directly (confirmed: VM pings QNAP). VM software: Lume.

### Environment matrix

| Environment | Postgres location | Market data source | Calls FinMind? |
|---|---|---|---|
| **Production** | `twp-prod-postgres` on QNAP | Daily ingest job (runs after 17:30 TST FinMind update) | **Yes** — sole writer |
| **Dev** | `twp-dev-postgres` on QNAP | Auto-restore from prod dump (QNAP shared filesystem, runs after ingest) | No |
| **Local** | `twp-local-postgres` on Lume VM | Manual restore via `scp` from QNAP | No |

### Snapshot distribution

**Prod -> Dev (automatic, same QNAP host):**
```bash
# Runs as part of the post-ingest cron, after daily bars land
docker exec twp-prod-postgres pg_dump -U $USER -n market_data --format=custom $DB \
  > /share/backups/market_data/market_data_latest.dump

docker exec -i twp-dev-postgres pg_restore -U $USER -n market_data --clean --if-exists -d $DB \
  < /share/backups/market_data/market_data_latest.dump
```

**Prod -> Local (manual, over LAN):**
```bash
scp user@192.168.2.xxx:/share/backups/market_data/market_data_latest.dump ./
pg_restore -h localhost -p 5732 -n market_data --clean --if-exists -d $DB market_data_latest.dump
```

Only the `market_data` schema is restored to dev/local. The ledger (`public` schema) is not distributed.

### Bootstrapping (first-time setup)

1. Deploy `market_data` schema migration to prod
2. Run initial backfill job against FinMind (prod only, demand-driven for monitored symbols)
3. `pg_dump -n market_data` from prod -> `/share/backups/`
4. Dev and local restore from that dump
5. Daily: ingest new bars -> re-dump -> auto-restore to dev

Scripted as `npm run market-data:backfill` (prod) and `npm run market-data:restore` (dev/local).

---

## 6. Backup and Retention

### Backup scheme

| Schema | Strategy | Retention | File naming |
|---|---|---|---|
| `public` (ledger) | Daily timestamped `pg_dump` | 30-day rotation | `ledger_YYYYMMDD_HHMM.dump` |
| `market_data` | Latest-only `pg_dump` (also serves as dev/local restore source) | Single latest file | `market_data_latest.dump` |

### Schedule

Both backups run after the daily bar ingest completes (post-17:30 TST).

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M)

# Ledger (critical, timestamped, 30-day rotation)
docker exec twp-prod-postgres pg_dump -U $USER -n public --format=custom $DB \
  > /share/backups/ledger/ledger_${TIMESTAMP}.dump
find /share/backups/ledger/ -name "*.dump" -mtime +30 -delete

# Market data (latest-only, also serves as restore source)
docker exec twp-prod-postgres pg_dump -U $USER -n market_data --format=custom $DB \
  > /share/backups/market_data/market_data_latest.dump
```

### Storage

- Primary: QNAP `/share/backups/` (same host as Postgres)
- Future: replicate to cloud storage for disk-failure resilience (destination TBD)

### Retention policy

- Ledger backups: 30-day rotation (mutable schema — need point-in-time recovery after bad deletes)
- Market data: indefinitely retained in the live database (no pruning of old daily bars)
- Market data backup: latest snapshot only (reconstructible from FinMind if lost)

---

## 7. Edge Cases Resolved

| Edge case | Resolution |
|---|---|
| Backfill failure midway | Per-symbol status tracking (`pending/backfilling/ready/failed`). Partial success kept. Failed symbols retried independently. |
| Delisted symbols | Flag to user: "Symbol XXXX appears delisted, last data: YYYY-MM-DD". Historical data retained. Daily refresh stopped for that symbol. |
| Ticker changes / corporate actions | Deferred for phase 1. Add `status_reason` field on instrument reference for manual flagging. |
| Stock splits / adjusted prices | Store raw prices only. Compute adjusted on the fly using split event data from `TaiwanStockDividendResult`. |
| Rate limit contention (backfill vs refresh) | Daily refresh has priority. Backfill fills remaining 600 req/hr budget. |
| Trading hours data gap | UI shows "today's data not yet available, refreshes at 17:30" between market close and FinMind update. |
| Demo users | Fixture/seed data only. No real FinMind API calls. |
| User deselects a monitored symbol | If open positions exist, keep refreshing. Monitored set = explicit selections UNION symbols with open positions. |
| Burst selection (user selects 150 symbols at once) | Queued processing. User notified via SSE on completion. No blocking wait. |
| Multi-user symbol overlap | `market_data.daily_bars` is shared. Daily refresh fetches the distinct union of monitored symbols across all users. |

---

## 8. Deferred Decisions

| Topic | Status | Notes |
|---|---|---|
| Ticker changes / corporate actions | Deferred to post-phase-1 | Add `status_reason` field for manual flagging |
| Auto-refresh for local dev | Manual `scp` for now | Scriptable via `npm run market-data:restore` |
| Cloud backup destination | TBD | Replicate QNAP backups to cloud for disk-failure resilience |
| Lazy/hybrid snapshot materialization | Schema-compatible migration path | Switch from Option B to C when user count warrants |
| Separate microservice extraction | Not needed for phase 1 | Extract ingestion to a separate service if scale demands it |
