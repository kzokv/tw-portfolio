---
slug: kzo-185
type: design
created: 2026-05-01
authors: [architect-team-lead]
ticket: KZO-185
required_reading:
  - docs/004-notes/kzo-185/scope-todo-202605010307-pgboss-back-compat-removal.md
  - docs/004-notes/kzo-169/scope-todo-202604300100-market-code-selector.md
  - docs/004-notes/kzo-169/transition-202505010300-market-code-selector.md
---

# KZO-185 Implementation Design (Tier 2 — Squad)

## Why this design exists

The scope-todo locks every architectural decision (D1–D9). This document does NOT re-debate them. It translates Phases 1–8 of the scope-todo into concrete task assignments, pins file paths and line numbers verified against the worktree HEAD, and identifies the parallel-able split between Implementer (source) and QA (tests).

## Slice table

| # | Slice | Layers | Key Behaviors | E2E Coverage |
|---|---|---|---|---|
| 1 | Type / interface changes | TS interfaces | `SnapshotTradeInput.marketCode`, `getAllMonitoredTickers` return shape, `SnapshotGenerationResult.tickersNeedingBackfill` shape, `BackfillJobData.marketCode` required, drop `BackfillWorkerDeps.resolveMarketCode` | N/A — no UI |
| 2 | Persistence implementations | Postgres SQL, memory in-memory | mirror new shapes in `getSnapshotGenerationInputs` and `getAllMonitoredTickers` for both backends | N/A — no UI |
| 3 | Walker | TS service | `walkPositionHistory` parents flow `(ticker, marketCode)` pairs out as `tickersNeedingBackfill` | N/A — no UI |
| 4 | Producer fixes | Fastify routes, cron service | `dailyRefreshEnqueue`, `snapshots/generate`, `recompute/confirm` stamp `marketCode` + composite singletonKey | N/A — no UI |
| 5 | Worker cleanup | Zod, pg-boss handler | Zod schema parse at handler entry BEFORE existing try block; remove fallback + import | N/A — no UI |
| 6 | Tests | vitest unit, vitest integration | extend 3 unit tests; add 1 new Postgres integration spec; audit fixtures | N/A — no UI |
| 7 | PR description | docs only | pre-flight SQL + behavioral deltas + git-pr-flow.md compliance | N/A — no UI |

**UI gate check:** No slice touches React/Next.js/CSS. All E2E cells are correctly N/A.

## Task split — Tier 2 parallel Phase 1 + Phase 2

Per `agent-team-workflow.md`, Tier 2 launches Implementer (Task #1) and QA (Task #2) simultaneously. QA's TDD-red imports against the new shapes drive the Implementer's interface work.

### Task #1 — Fullstack Implementer (Source)

Owns slices 1–5. **Does NOT** touch test files except updating implementation-coupled tests that break due to source-shape changes (per `implementer-qa-test-ownership.md`).

### Task #2 — Senior QA (Tests)

Owns slice 6 entirely. May write TDD-red imports against shapes the Implementer has not yet landed; the Implementer extracts/lands those shapes per `agent-team-workflow.md`'s "QA's TDD-red imports can drive helper extraction" guidance.

## File-by-file change log

All file paths are relative to the worktree root `/Users/lume/repos/tw-portfolio/.claude/worktrees/kzo-185`.

### Slice 1 — Types & interfaces (Implementer)

**`apps/api/src/persistence/types.ts`**
- Line 475 — `SnapshotTradeInput`: add `marketCode: string` field. Required (no `?`). Source it via the BookedTradeEvent.marketCode that already exists in `apps/api/src/types/store.ts:36`.
- Line 785 — `getAllMonitoredTickers()`: change return from `Promise<string[]>` to `Promise<{ ticker: string; marketCode: string }[]>`. Use `string` (not `MarketCode`) for consistency with the existing siblings on line 787 (`getManualSelections`). The Zod enum at the worker entry is the validation gate — D2 + D3 in scope-todo.

**`apps/api/src/services/snapshotGeneration.ts`**
- Line 21 — `SnapshotGenerationResult.tickersNeedingBackfill`: change from `string[]` to `{ ticker: string; marketCode: string }[]`.

**`apps/api/src/services/market-data/backfillWorker.ts`**
- Lines 13–16 — strip the back-compat block comment.
- Line 17 — change `marketCode?: MarketCode;` to `marketCode: MarketCode;` (no longer optional).
- Line 32 — remove `resolveMarketCode: (ticker: string) => MarketCode;` from `BackfillWorkerDeps`.
- Line 60 — remove `resolveMarketCode` from the destructure.
- Lines 85–87 — strip the TODO/comment.
- Line 88 — replace `job.data.marketCode ?? resolveMarketCode(ticker)` with `data.marketCode` (after the Zod parse — see slice 5).

### Slice 2 — Persistence implementations (Implementer)

**`apps/api/src/persistence/postgres.ts`**
- Line 2683 — `getSnapshotGenerationInputs`: add `market_code` to the SELECT projection, the row type generic on the query, and the `tradesResult.rows.map` projection that produces `SnapshotTradeInput` (line 2728). Source: `trade_events.market_code` (KZO-169 column already exists; no DDL needed per D8).
- Line 6133 — `getAllMonitoredTickers`: change SELECT from `SELECT DISTINCT i.ticker` (line 6157) to `SELECT DISTINCT i.ticker, i.market_code`. Update row type generic to `{ ticker: string; market_code: string }`. Update return mapping (line 6167) to `result.rows.map((row) => ({ ticker: row.ticker, marketCode: row.market_code }))`. Update the comment on lines 6134–6138 — the "provider workers re-resolve via getInstrument()" sentence is being retired.

**`apps/api/src/persistence/memory.ts`**
- Line 1658 — `getSnapshotGenerationInputs`: add `marketCode: t.marketCode` to the trades.map projection at line 1687. `BookedTradeEvent.marketCode` is already present on the in-memory shape (`apps/api/src/types/store.ts:36`).
- Line 2365 — `getAllMonitoredTickers`: change return type to `Promise<{ ticker: string; marketCode: string }[]>`. Body still returns `[]` (shape-compatible) — memory backend has no users-monitored-tickers state.

### Slice 3 — Walker (Implementer)

**`apps/api/src/services/snapshotGeneration.ts`**
- Line 60 — replace `const tickersNeedingBackfill = new Set<string>();` with a `Map<string, { ticker: string; marketCode: string }>` keyed by `${ticker}:${marketCode}` (composite key — same convention as `singletonKey` in dailyRefreshEnqueue / backfillWorker). Reasoning: cross-listed tickers (BHP/AU + BHP/US in one user) must surface as TWO entries, not collapse on `ticker`.
- Lines 80, 86 — replace `add(ticker)` with `set(${ticker}:${marketCode}, { ticker, marketCode })`. Source `marketCode` from `groupTrades[0].marketCode` (the (account, ticker) pair has a single marketCode per the currency-coupling rule already enforced at line 193 via `priceCurrency`).
- Line 100 — replace `[...tickersNeedingBackfill]` with `[...tickersNeedingBackfill.values()]`.
- Lines 145–149 — same Map conversion in `recomputeSnapshotsForTicker`. Source `marketCode` from `inputs.trades[0].marketCode` (we know `inputs.trades.length > 0` from line 126).
- Line 161 — `[...tickersNeedingBackfill.values()]`.
- Line 127 — early-return literal `tickersNeedingBackfill: []` is already shape-compatible (empty array works for both `string[]` and `{ticker, marketCode}[]`).

### Slice 4 — Producer fixes (Implementer)

**`apps/api/src/services/market-data/dailyRefreshEnqueue.ts`**
- Line 20 — `tickers` is now `{ ticker, marketCode }[]`. Update the empty-check at line 21 to use `tickers.length === 0` (works as-is).
- Line 30 — destructure inside the map: `tickers.map(({ ticker, marketCode }) => ...)`.
- Line 33 — payload becomes `{ ticker, marketCode, trigger: "daily_refresh", startDate, batchId } satisfies BackfillJobData`.
- Line 34 — `singletonKey` becomes `${ticker}:${marketCode}` (composite).
- Line 39 — keep `tickers: tickers.length` log line; no behavioral change there.

**`apps/api/src/routes/registerRoutes.ts`**
- Line 3899 (snapshots-generate auto-trigger):
  - Replace `for (const ticker of result.tickersNeedingBackfill)` with `for (const { ticker, marketCode } of result.tickersNeedingBackfill)`.
  - Line 3901 — payload becomes `{ ticker, marketCode, trigger: "first_trade", includeBars: true }`.
  - Add `singletonKey: ${ticker}:${marketCode}` as a 3rd-arg option to `boss.send(...)`. The current call site does not pass options — this is a NEW addition for parity with sibling producers (D2 footnote in scope-todo line 57).
- Line 4007 (recompute-confirm auto-trigger):
  - Same destructure change.
  - Line 4009 — payload includes `marketCode`.
  - Add `singletonKey: ${ticker}:${marketCode}` option to `boss.send(...)`.

### Slice 5 — Worker cleanup (Implementer)

**`apps/api/src/services/market-data/backfillWorker.ts`**

Insert a Zod schema at module scope (top of file, after imports):

```ts
import { z } from "zod";

const BackfillJobDataSchema = z.object({
  ticker: z.string(),
  marketCode: z.enum(["TW", "US", "AU"]),
  userId: z.string().optional(),
  trigger: z.enum(["user_selection", "first_trade", "retry", "daily_refresh", "repair"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  includeBars: z.boolean().optional(),
  includeDividends: z.boolean().optional(),
  batchId: z.string().optional(),
});
```

Refactor the handler entry:

```ts
return async ([job]: JobWithMetadata<BackfillJobData>[]): Promise<void> => {
  // Parse BEFORE the existing try block so ZodError propagates straight to pg-boss
  // without running side effects (status updates, SSE events) on shape errors.
  // Per .claude/rules/typed-transient-error-catch-audit.md: ZodError is the typed error;
  // the existing catch on line 217 only re-throws — verify it does not swallow ZodError.
  const data = BackfillJobDataSchema.parse(job.data);
  const { ticker, marketCode: market, userId, trigger, startDate, endDate, includeBars = true, includeDividends = true, batchId } = data;
  // ... rest unchanged ...
};
```

In `rescheduleAfterRateLimit` (line 102), change `boss.send(BACKFILL_QUEUE, job.data, ...)` to `boss.send(BACKFILL_QUEUE, data, ...)` so the parsed (validated) payload is what's enqueued for retry.

Remove imports/usages of `resolveMarketCode`:
- Line 32 — already in slice 1.
- Line 60 — already in slice 1.

**`apps/api/src/plugins/pgBoss.ts`**
- Line 8 — remove `import { resolveMarketCode } from "../services/market-data/marketResolution.js";`.
- Line 43 — remove `resolveMarketCode,` from `backfillDeps`.

**Do NOT touch `apps/api/src/services/market-data/marketResolution.ts`** — it still exports `resolveMarketCode` for `/market-data/price` route (KZO-170 placeholder per D6).

### Slice 6 — Tests (QA)

**Unit (suite 4):**

1. `apps/api/test/unit/backfill-handler-branching.test.ts` — add a test case "rejects old-shape job.data (no marketCode) before any side effects":
   - Pass `job.data = { ticker: "2330", trigger: "daily_refresh" }` (no marketCode).
   - Assert handler throws ZodError.
   - Assert `upsertDailyBars` not called (mock spy zero invocations).
   - Assert `eventBus.publishEvent` not called.
   - Assert `updateBackfillStatus` not called.
   - Assert `updateBatchTickerResult` not called.
   - Per `typed-transient-error-catch-audit.md`: also verify the existing catch (line 217) does NOT swallow ZodError — assertion form: ZodError propagates up (handler throws, doesn't return cleanly).

2. `apps/api/test/unit/daily-refresh-enqueue.test.ts` — extend existing tests:
   - Mock `getAllMonitoredTickers` to return `[{ ticker: "2330", marketCode: "TW" }, { ticker: "AAPL", marketCode: "US" }]`.
   - Assert `boss.send` payload includes `marketCode`.
   - Assert `singletonKey === "${ticker}:${marketCode}"`.
   - Audit existing fixtures — replace `string[]` returns with `{ticker, marketCode}[]`.

3. `apps/api/test/unit/snapshotGeneration.test.ts` — extend:
   - Update any `SnapshotTradeInput` literal fixtures to include `marketCode`.
   - Assert `tickersNeedingBackfill` shape: `{ticker, marketCode}` pairs.
   - **NEW test fixture** — same-ticker-different-market: build a user with two accounts, one holding BHP/AU and one holding BHP/US (or use any two-marketCode pair), assert walker emits TWO distinct `tickersNeedingBackfill` entries.

**Integration (suite 5):**

4. `apps/api/test/integration/snapshotGenerationPostgres.integration.test.ts` — audit existing assertions on `tickersNeedingBackfill`. Any that asserts on `string[]` shape needs updating to `{ticker, marketCode}[]`. Test seeding may need to pass `market_code` through trade_events INSERTs (already done in KZO-169 — verify).

5. **NEW** `apps/api/test/integration/backfill-old-shape-rejection.integration.test.ts` — per `integration-test-persistence-direct.md`:
   - Setup pattern: follow `backfill-repair.integration.test.ts` or `backfill-retry.integration.test.ts`. Use `PostgresPersistence` directly (NOT `buildApp` — Redis ECONNREFUSED).
   - Seed a user, trade event (with market_code), instrument row.
   - Insert an OLD-SHAPE job directly via raw SQL: `INSERT INTO pgboss.job (id, name, data, state, ...) VALUES (gen_random_uuid(), 'finmind-backfill', '{"ticker":"2330","userId":"u1","trigger":"daily_refresh"}'::jsonb, 'created', ...)`.
   - Build the handler via `createBackfillHandler(deps)` and invoke it directly with the fetched job.
   - Assert: handler throws `ZodError`. No rows in `market_data.daily_bars` for ticker. `instruments.bars_backfill_status` unchanged. No SSE event published (mock event bus, assert zero `publishEvent` calls).
   - Audit trail: zero `updateBackfillStatus` calls, zero `updateBatchTickerResult` calls.

**Fixture audit:**

6. Grep for `SnapshotGenerationResult` and `SnapshotTradeInput` fixture literals across `apps/api/test/**` and `apps/web/test/**`:
   ```bash
   grep -rln "tickersNeedingBackfill\|SnapshotTradeInput" apps/api/test apps/web/test libs/test-* 2>/dev/null
   ```
   Update each to include `marketCode` field.

### Slice 7 — PR description (Technical Writer, Wave 2)

PR body MUST include the following sections per `pr-bound-docs-review-compliance.md`:

- `## Problem` — KZO-169 introduced producer-stamped marketCode but only updated 4 of 7 producers; the worker fallback masks the gap; cleanup removes the fallback after fixing the remaining producers.
- `## Solution` — bullet list: type/interface changes (slice 1), Zod handler-entry validation (slice 5), 3 producer fixes (slice 4), persistence + walker propagation (slices 2 + 3).
- `## Testing` — Evidence block with concrete pre-push gate output:
  ```
  npx eslint . --max-warnings=0    [PASS]
  npm run typecheck                [PASS]
  Suite 3 (web unit):              X passed
  Suite 4 (api unit):              X passed
  Suite 5 (api integration:host):  X passed (incl. NEW backfill-old-shape-rejection)
  Suite 6 (E2E bypass):            X passed
  Suite 7 (E2E oauth):             X passed
  Suite 8 (api HTTP):              X passed
  ```
- `## Risk/Rollback`:
  - Risk: any in-flight pgboss job still on the old shape at deploy time → handler throws ZodError → pg-boss retries 3x → terminal failed. The pre-flight SQL gates this.
  - Rollback: revert the PR; the `?? resolveMarketCode(ticker)` fallback restores back-compat for any old-shape jobs.
- **Pre-flight SQL** (for operator):
  ```sql
  SELECT COUNT(*) AS old_shape_jobs
  FROM pgboss.job
  WHERE name = 'finmind-backfill'
    AND state IN ('created','retry','active','retry_after')
    AND NOT (data ? 'marketCode');
  ```
  Operator instructions: run against production DB ≥24h after KZO-169 deploy; expected `0`; do not merge until confirmed.

## Out of scope (per scope-todo §Out of scope)

- DDL migration — KZO-169 already shipped `market_code` columns we consume.
- CATALOG_SYNC handler — confirmed clean of back-compat code.
- `resolveMarketCode()` and `marketResolution.ts` — KZO-170 placeholder (still load-bearing for `/market-data/price` route at `registerRoutes.ts:3062`).
- E2E test additions — no user-visible behavior change.
- `/market-data/price` correctness gap (`resolveMarketCode("AAPL") === "TW"`) — KZO-170 scope.

## Open questions (none — every decision locked)

(none — every decision was locked in the scope-grill session 2026-05-01)

## Validation strategy (Phase 3 — convergence loop)

After both Implementer and QA send `[DONE]`:

1. Validator runs ALL 8 suites per `full-test-suite.md`.
2. Code Reviewer reviews `git diff main...HEAD`. Specific checks:
   - Zod schema is positioned BEFORE the existing try block in `backfillWorker.ts` (per `typed-transient-error-catch-audit.md`).
   - `resolveMarketCode` import removed from BOTH `backfillWorker.ts` AND `pgBoss.ts`.
   - The 3 producer sites (dailyRefreshEnqueue, registerRoutes:3899, registerRoutes:4007) all stamp `marketCode` AND have composite `singletonKey: ${ticker}:${marketCode}`.
   - `getAllMonitoredTickers` and `tickersNeedingBackfill` shape changes propagate through to all callers (grep `getAllMonitoredTickers`, `tickersNeedingBackfill` repo-wide per `process-refactor-rename-verification.md`).
   - No DDL migration created (per D8).
   - Comment on `postgres.ts` line 6134–6138 is updated (no longer says "provider workers re-resolve").
3. Triage findings per `team-phase-3-triage.md`. PR-description-compliance findings → defer to Wave 2 Technical Writer.
4. Exit check: tests_green AND findings_addressed AND no_regressions.

## Wave 2 (post-convergence)

Spawn Technical Writer with explicit brief per `pr-bound-docs-review-compliance.md`:

- Update `docs/004-notes/kzo-185/scope-todo-...md` checkboxes (mark items complete).
- Author transition note `docs/004-notes/kzo-185/transition-{datetime}-pgboss-back-compat-removal.md`.
- Author PR description draft at `.worklog/team/pr-description-draft.md`.
- **Required sections:** `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block), `## Risk/Rollback` per `git-pr-flow.md §3-4`. CI gate `pr-gate.yml` enforces these — verify before sending DONE.

Code Reviewer does a compliance pass on the PR draft (NOT accuracy-only).

## Pre-shutdown gate

Before `[SHUTDOWN]`:
1. `lsof -i :4000 -i :3333 -i :4445 -i :4099` — orphan check (no UI in this ticket so should be clean).
2. All 8 suites green via `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`.
3. Pre-flight SQL pasted in PR description.
