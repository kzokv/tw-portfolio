---
slug: kzo-185
source: scope-grill
created: 2026-05-01
tickets: [KZO-185]
required_reading:
  - docs/004-notes/kzo-169/scope-todo-202604300100-market-code-selector.md
  - docs/004-notes/kzo-169/transition-202505010300-market-code-selector.md
superseded_by: null
---

# Todo: KZO-185 — pgboss back-compat removal

> **For agents starting a fresh session:** read this file, KZO-185 + KZO-169 Linear ticket descriptions, and the two `required_reading` docs above (KZO-169 scope-todo and transition note). The grilled scope materially expands the ticket-as-written: KZO-185 is NOT a 5-line cleanup, it is a Tier 2 PR that fixes 3 still-broken producers, changes 1 persistence interface method signature, 1 service return type, and 1 walker input type. The original "Low priority" framing is wrong.

## Context summary

KZO-169 introduced producer-stamped `marketCode` on backfill jobs but only updated 4 of 7 producers. The worker's `?? resolveMarketCode(ticker)` fallback (always returns `"TW"`) silently masks the gap for the other 3 producers (daily-refresh cron, snapshots-generate auto-trigger, recompute-confirm auto-trigger). Removing the fallback without fixing those producers breaks production. This ticket bundles both — fix all producers AND retire the fallback in one PR.

The "back-compat" merged in PR #153 is not a Zod union (the ticket description was aspirational); it is a single-line `?? resolveMarketCode(ticker)` fallback in `apps/api/src/services/market-data/backfillWorker.ts:88` plus an optional `marketCode?: MarketCode` field on `BackfillJobData`.

## Decisions (locked via scope-grill 2026-05-01)

- **D1.** Bundle producer fixes into KZO-185. No two-ticket split. Tier 2 (Squad) execution.
- **D2.** Change return shapes upstream. `getAllMonitoredTickers(): Promise<{ticker, marketCode}[]>` and `SnapshotGenerationResult.tickersNeedingBackfill: { ticker, marketCode }[]`. Producers stamp directly from those results — no per-ticker `getInstrument()` lookups. Required input change: `SnapshotTradeInput.marketCode: string` to flow marketCode through the walker.
- **D3.** Worker validation via Zod. `BackfillJobDataSchema = z.object({ ticker, marketCode: z.enum(["TW","US","AU"]), userId?, trigger, startDate?, endDate?, includeBars?, includeDividends?, batchId? })`. Parse at handler entry BEFORE the existing `try` block so the failure path doesn't run side effects (status updates, SSE) on shape errors. ZodError is the typed error. Pg-boss retries 3x then terminal failed (~7 min total cost; bounded).
- **D4.** Manual operator pre-flight check; PR description only (no runbook entry — this is one-shot).
- **D5.** Test strategy: 3 suite-4 unit extensions + 1 new suite-5 integration spec. No new E2E. Producer audit covered by the worker-level Zod gatekeeper.
- **D6.** `resolveMarketCode()` function and `marketResolution.ts` file: KEEP. Used by `/market-data/price` route (`registerRoutes.ts:3062`) — KZO-170 placeholder. KZO-185 only removes the worker import + dep.
- **D7.** CATALOG_SYNC handler: NO WORK. Audit confirmed no back-compat code there. The original ticket description's reference to it is incorrect.
- **D8.** No DDL migration. KZO-169 already added the `market_code` columns this work consumes.
- **D9.** Linear priority bump: Low → Medium. Add `api`, `db` labels.

## Implementation Steps

### Phase 1 — Type / interface changes

- [x] Add `marketCode: string` field to `SnapshotTradeInput` (`apps/api/src/persistence/types.ts:475`)
- [x] Change `Persistence.getAllMonitoredTickers()` signature to `Promise<{ticker: string; marketCode: MarketCode}[]>` (`apps/api/src/persistence/types.ts:785`)
- [x] Change `BackfillJobData.marketCode: MarketCode` (no longer optional) in `apps/api/src/services/market-data/backfillWorker.ts`. Strip the back-compat block comment (lines 13–16). Remove `resolveMarketCode` from `BackfillWorkerDeps` (line 32).
- [x] Change `SnapshotGenerationResult.tickersNeedingBackfill` to `{ticker: string; marketCode: MarketCode}[]` (`apps/api/src/services/snapshotGeneration.ts:21`)

### Phase 2 — Persistence implementations

- [x] `postgres.ts` `getSnapshotGenerationInputs` (line 2669): add `market_code` to trade SELECT (`postgres.ts:2683`); include in row type and result mapping
- [x] `postgres.ts` `getAllMonitoredTickers` (line 6133): change SELECT from `SELECT DISTINCT i.ticker` to `SELECT DISTINCT i.ticker, i.market_code`; update return type and `result.rows.map`. Update the comment that says "Returns ticker only — provider workers re-resolve market via getInstrument()" — that fallback path is being removed.
- [x] `memory.ts` `getSnapshotGenerationInputs` (line 1658): mirror — source `marketCode` from the in-memory trade event
- [x] `memory.ts` `getAllMonitoredTickers` (line 2365): return type changes from `Promise<string[]>` → `Promise<{ticker, marketCode}[]>`. Body still returns `[]` — the empty array is shape-compatible.

### Phase 3 — Walker

- [x] Update `walkPositionHistory` and parents in `apps/api/src/services/snapshotGeneration.ts` so `tickersNeedingBackfill` carries `(ticker, marketCode)` pairs. Source `marketCode` from `groupTrades[0].marketCode` (the (account, ticker) pair has a single marketCode by currency-coupling rule). Use a `Map<composite-key, {ticker, marketCode}>` internally; spread the `.values()` to the array result. Apply to both `generateHoldingSnapshots` (line 100) and `recomputeSnapshotsForTicker` (line 161).

### Phase 4 — Producer fixes (the 3 still-broken sites)

- [x] `apps/api/src/services/market-data/dailyRefreshEnqueue.ts` — destructure `{ticker, marketCode}` from monitored result; stamp on payload; singletonKey becomes `${ticker}:${marketCode}`
- [x] `apps/api/src/routes/registerRoutes.ts:3901` (snapshots-generate auto-backfill) — destructure `{ticker, marketCode}` from `result.tickersNeedingBackfill`; stamp on payload; composite singletonKey (NB: current code has no `singletonKey:` option — add one for consistency with sibling producers)
- [x] `apps/api/src/routes/registerRoutes.ts:4009` (recompute-confirm auto-backfill) — same pattern as 3901

### Phase 5 — Worker cleanup

- [x] `apps/api/src/services/market-data/backfillWorker.ts`:
  - Add `BackfillJobDataSchema` Zod schema at module scope
  - At handler entry (BEFORE the existing `try` block on line 114), parse: `const data = BackfillJobDataSchema.parse(job.data);` — ZodError propagates straight to pg-boss, no side effects on shape errors
  - Use the parsed `data` for downstream destructure and reschedule (`boss.send(BACKFILL_QUEUE, data, ...)` on line 102, not `job.data`)
  - Remove `?? resolveMarketCode(ticker)` fallback (line 88); replace with direct `data.marketCode`
  - Remove the back-compat TODO/comment (lines 13–16, 85–87)
  - Remove `resolveMarketCode` from destructured deps (line 60)
- [x] `apps/api/src/plugins/pgBoss.ts`:
  - Remove `resolveMarketCode` import (line 8)
  - Remove `resolveMarketCode` from `backfillDeps` (line 43)

### Phase 6 — Tests

- [x] **Suite 4 (unit) — `apps/api/test/unit/backfill-handler-branching.test.ts`**: add a test case for old-shape `job.data` (no `marketCode`) — assert `BackfillJobDataSchema.parse` throws `ZodError`, no `daily_bars` upsert, no SSE event published, no instrument status change, no batch tracker update. Per `.claude/rules/typed-transient-error-catch-audit.md`, also assert the existing catch block does not swallow ZodError (it should propagate cleanly because the parse is BEFORE the try).
- [x] **Suite 4 — `apps/api/test/unit/daily-refresh-enqueue.test.ts`**: extend existing test to assert `boss.send` payload includes `marketCode`; assert `singletonKey` is composite `${ticker}:${marketCode}`. Audit any test fixtures that build monitored-ticker mocks (now `{ticker, marketCode}[]` shape).
- [x] **Suite 4 — `apps/api/test/unit/snapshotGeneration.test.ts`**: extend to assert `tickersNeedingBackfill` carries `{ticker, marketCode}` pairs. Update any `SnapshotTradeInput` fixtures that need the new field. Add a test fixture covering same-ticker-different-market (e.g. BHP/AU + BHP/US in the same user's accounts) to verify the walker emits two distinct entries.
- [x] **Suite 5 (Postgres integration) — `apps/api/test/integration/snapshotGenerationPostgres.integration.test.ts`**: audit existing assertions on `tickersNeedingBackfill`; extend any that assert on string-array shape.
- [x] **Suite 5 — NEW `apps/api/test/integration/backfill-old-shape-rejection.integration.test.ts`**: per `.claude/rules/integration-test-persistence-direct.md`, use `PostgresPersistence` directly (no `buildApp` — Redis ECONNREFUSED). Setup pattern follows `backfill-repair.integration.test.ts` or `backfill-retry.integration.test.ts`. Test:
  1. `INSERT INTO pgboss.job (name, data, ...) VALUES ('finmind-backfill', '{"ticker":"2330","userId":"u1","trigger":"daily_refresh"}'::jsonb, ...)` — old shape, no marketCode
  2. Invoke handler via `boss.fetch(BACKFILL_QUEUE)` + direct call to `createBackfillHandler(deps)([job])` (or via `boss.work` + manual fetch)
  3. Assert: handler throws ZodError; no rows in `daily_bars` for ticker; `instruments.bars_backfill_status` unchanged; pg-boss state transitions to `failed` after `retryLimit` exhausted (or assert immediately if testing the synchronous handler call). Cover the audit trail (no SSE event, no `update_backfill_status` call).
- [x] Audit `apps/web/test/**` and `apps/api/test/**` for any fixtures that build `SnapshotGenerationResult` literals or `SnapshotTradeInput` literals — add `marketCode` field.

### Phase 7 — Pre-flight + PR description

- [x] Verify the JSONB SQL syntax against the project's pgboss schema before publishing in PR description:
  ```sql
  SELECT COUNT(*) AS old_shape_jobs
  FROM pgboss.job
  WHERE name = 'finmind-backfill'
    AND state IN ('created','retry','active','retry_after')
    AND NOT (data ? 'marketCode');
  ```
- [x] PR description includes: <!-- authored in .worklog/team/pr-description-draft.md (Task #9 — Wave 2 Technical Writer) -->
  - Pre-flight SQL above (operator instructions: run against production DB ≥24h after KZO-169 deploy; expected `0`; do not merge until confirmed)
  - Behavioral deltas section: "no user-visible behavior change; producer audit fixes 3 latent old-shape sites; singleton-key consistency benefits same-ticker daily-refresh + manual backfill collisions"
  - Per `.claude/rules/pr-bound-docs-review-compliance.md`: `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block of suite results), `## Risk/Rollback`. CI gate `pr-gate.yml` enforces these.

### Phase 8 — Pre-push gate + Linear update

- [x] Run the canonical pre-push gate per `.claude/rules/full-test-suite.md`:
  ```bash
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```
- [x] Verify all 8 suites green; capture Evidence block for PR description <!-- Task #7 (senior-qa SWEEP) + Task #8 (validator iter 2) — all 8 suites green -->
- [ ] Linear: bump KZO-185 priority Low → Medium; add `api`, `db` labels; assignee Keith C <!-- not yet confirmed — post-PR open action -->
- [ ] After PR opens: link PR to KZO-185 via Linear attachment <!-- pending PR creation -->

## Out of scope

- DDL migration — KZO-169 already shipped the schema columns
- CATALOG_SYNC handler audit — confirmed no back-compat code
- `resolveMarketCode()` function deletion — KZO-170 placeholder, still load-bearing for `/market-data/price`
- Pg-boss per-job retry override — accept the ~7 min retry cost on shape errors
- Fixing `/market-data/price` route's `resolveMarketCode("AAPL") === "TW"` correctness gap — KZO-170 scope
- E2E test additions — no user-visible behavior change

## Open Items

- (none)

## References

- Linear: KZO-185 (this ticket); KZO-169 (parent — back-compat introduced); KZO-170/172 (forward — US/AU ingestion that depends on no fallback)
- Sibling docs: `docs/004-notes/kzo-169/scope-todo-202604300100-market-code-selector.md`, `docs/004-notes/kzo-169/transition-202505010300-market-code-selector.md`
- Relevant rules: `.claude/rules/integration-test-persistence-direct.md`, `.claude/rules/typed-transient-error-catch-audit.md`, `.claude/rules/full-test-suite.md`, `.claude/rules/pr-bound-docs-review-compliance.md`, `.claude/rules/migration-strategy.md` (no migration here, but the rationale on additions vs new files applies if anyone proposes one), `.claude/rules/agent-team-workflow.md`
