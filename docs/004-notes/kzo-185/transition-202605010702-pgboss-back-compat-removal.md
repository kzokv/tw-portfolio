---
slug: kzo-185
type: transition-note
created: 2026-05-01T07:02Z
ticket: KZO-185
status: frozen
---

# Transition Note: KZO-185 — pgboss back-compat removal

> **Frozen document.** Do not edit after merge. Records what was true at the time KZO-185 shipped.

## Tickets

- **KZO-185** (this PR) — pgboss `finmind-backfill` back-compat fallback removal + 3 producer fixes
- **KZO-169** (predecessor) — introduced `marketCode` on backfill job payloads; the fallback this PR removes was the compatibility shim landed in KZO-169 PR #153

## What changed

### Behavioral changes since previous deploy (KZO-169)

1. **Old-shape `finmind-backfill` jobs now ZodError → terminal failed.** Any pgboss job in the queue that carries `{ ticker, trigger, ... }` without a `marketCode` field will throw `ZodError` at handler entry, retry 3× (~7 min), then terminal-failed. Previously: silently defaulted to `marketCode = "TW"`.

2. **Daily-refresh `singletonKey` is composite.** `dailyRefreshEnqueue.ts` now uses `${ticker}:${marketCode}` as the singletonKey (was bare `ticker` before this PR). Beneficial: manual backfill and daily-refresh jobs for the same ticker but different markets no longer compete for the same singleton slot.

3. **`getAllMonitoredTickers()` return shape changed.** Persistence method now returns `{ ticker: string; marketCode: string }[]` (was `string[]`). Any caller that destructured a bare string must be updated. All in-repo callers were updated in this PR.

4. **`SnapshotGenerationResult.tickersNeedingBackfill` shape changed.** Was `string[]`, now `{ ticker: string; marketCode: string }[]`. The snapshot walker now emits composite-keyed entries so cross-listed tickers (e.g. BHP/AU + BHP/US) produce two distinct backfill requests.

5. **`SnapshotTradeInput` gains required `marketCode` field.** Any persistence layer or test that builds a `SnapshotTradeInput` literal must include `marketCode`. All in-repo sites updated.

6. **`resolveMarketCode` removed from `BackfillWorkerDeps` and `pgBoss.ts`.** The import and the dep injection of `resolveMarketCode` are gone from the backfill plumbing. `marketResolution.ts` is retained — `resolveMarketCode` is still used by the `/market-data/price` route (KZO-170 placeholder).

### No user-visible behavior changes

All changes are in the API pipeline (pgboss job processing, cron producer, snapshot walker). No UI, no new routes, no changed HTTP contracts.

## Renamed types / changed signatures

| Symbol | Before | After |
|---|---|---|
| `Persistence.getAllMonitoredTickers()` | `Promise<string[]>` | `Promise<{ ticker: string; marketCode: string }[]>` |
| `SnapshotGenerationResult.tickersNeedingBackfill` | `string[]` | `{ ticker: string; marketCode: string }[]` |
| `SnapshotTradeInput` | no `marketCode` field | `marketCode: string` (required) |
| `BackfillJobData.marketCode` | `marketCode?: MarketCode` (optional) | `marketCode: MarketCode` (required) |
| `BackfillWorkerDeps.resolveMarketCode` | present | removed |

## Operator pre-flight SQL

Run against production DB **≥24h after KZO-169 deploy** and confirm `0` before merging:

```sql
SELECT COUNT(*) AS old_shape_jobs
FROM pgboss.job
WHERE name = 'finmind-backfill'
  AND state IN ('created','retry','active','retry_after')
  AND NOT (data ? 'marketCode');
```

Expected: `0`. Block merge until confirmed. If the count is non-zero, old-shape jobs are still in the queue; allow more time for them to drain through retry cycles before deploying this PR.

Post-deploy monitoring query (first 24h):

```sql
SELECT COUNT(*) FROM pgboss.job
WHERE name = 'finmind-backfill' AND state = 'failed';
```

An unexpected spike here (above baseline) indicates old-shape jobs that made it through despite pre-flight confirmation, or a producer regression.

## Files changed (scope summary)

**Source:**
- `apps/api/src/persistence/types.ts` — interface changes (slices 1, 2)
- `apps/api/src/persistence/postgres.ts` — `getAllMonitoredTickers` + `getSnapshotGenerationInputs` (slice 2)
- `apps/api/src/persistence/memory.ts` — mirror changes (slice 2)
- `apps/api/src/services/snapshotGeneration.ts` — walker Map refactor, result type (slices 1, 3)
- `apps/api/src/services/market-data/dailyRefreshEnqueue.ts` — producer fix + composite singletonKey (slice 4)
- `apps/api/src/routes/registerRoutes.ts` — 2 auto-trigger producer fixes + composite singletonKey (slice 4)
- `apps/api/src/services/market-data/backfillWorker.ts` — Zod schema, fallback removal, deps cleanup (slice 5)
- `apps/api/src/plugins/pgBoss.ts` — remove `resolveMarketCode` import + dep injection (slice 5)

**Tests:**
- `apps/api/test/unit/backfill-handler-branching.test.ts` — extended
- `apps/api/test/unit/daily-refresh-enqueue.test.ts` — extended
- `apps/api/test/unit/snapshotGeneration.test.ts` — extended + fixture update
- `apps/api/test/integration/snapshotGenerationPostgres.integration.test.ts` — assertion updates
- `apps/api/test/integration/backfill-old-shape-rejection.integration.test.ts` — **new**

**Docs:**
- `docs/001-architecture/backend-db-api.md` — stale forward note retired in-place
- `docs/004-notes/kzo-185/scope-todo-202605010307-pgboss-back-compat-removal.md` — checkboxes ticked

## Forward-looking notes

- **KZO-170 (US ingestion) / KZO-172 (AU ingestion):** `BackfillJobDataSchema` already includes `"US"` and `"AU"` in the `marketCode` enum. No worker changes needed when those tickets ship.
- **`resolveMarketCode` / `marketResolution.ts`:** Still present. Load-bearing for the `/market-data/price` route (`registerRoutes.ts:3062`). KZO-170 will replace this placeholder when real per-market price resolution lands.
- **`resolveMarketCode` usage in KZO-169 transition note (`docs/004-notes/kzo-169/transition-202505010300-market-code-selector.md` lines 121–122):** That note is frozen; the reference to KZO-185 as future work is now fulfilled.
