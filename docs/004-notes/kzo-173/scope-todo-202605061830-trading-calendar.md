---
slug: kzo-173
source: scope-grill
created: 2026-05-06
tickets: [KZO-173]
required_reading: []
superseded_by: null
---

# Todo: KZO-173 — Multi-market trading calendar (Option α: derived from `daily_bars`)

> **For agents starting a fresh session:** read the Linear ticket KZO-173 (especially the `## Locked Scope` section appended on 2026-05-06) and the locked-scope summary at the top of this file before starting implementation. Project conventions live in `CLAUDE.md` and `.claude/rules/`.

## Locked Scope Summary

**KZO-173 ships service-layer trading-calendar helpers backed by `market_data.daily_bars` derivation.**

Major divergence from the original ticket: **no `market_trading_calendar` table, no migration, no seed file, no admin route, no scheduler skip-on-holiday optimization, no external library or API dependency.** The original "static seeded calendar" architecture was replaced during scope-grill with **Option α** — derive trading days from the `daily_bars` table we already populate via existing ingestion.

**Why this shape:**
- `daily_bars` is the most authoritative possible source — it IS the exchange's published behavior, not a third party's opinion of it.
- KZO-177's two helpers (`latestSettledTradingDay`, `tradingDaysBetween`) operate on past dates; both are computable directly from `daily_bars`.
- Zero manual maintenance, zero external deps, zero new schema, zero failure modes from upstream calendar drift.
- Trade-off accepted: no daily-refresh skip-on-holiday optimization (~3 hrs/yr of wasted FinMind quota across 3 markets).

**Public API (locked):**

```ts
// apps/api/src/services/market-data/tradingCalendar.ts
class TradingCalendarCache {
  // State
  getTradingDates(market: MarketCode): Promise<Set<string>>;
  notifyBarsUpserted(market: MarketCode, dates: ReadonlyArray<string>): void;
  flush(): void;  // test-only, not exposed via HTTP

  // Helpers (methods on the class for ergonomic call sites)
  latestSettledTradingDay(market: MarketCode | "FX", now: Date, options?: SettleOptions): Promise<string>;
  tradingDaysBetween(d1: string, d2: string, market: MarketCode | "FX"): Promise<number>;
  isTradingDay(market: MarketCode | "FX", date: string): Promise<boolean>;
}

export interface SettleOptions {
  /**
   * Hours after market close before a date is considered "settled" by this helper.
   * Default 0 (literal "close has elapsed" semantics).
   *
   * Consumers that compare against ingestion timestamps should pass a value matching
   * the data pipeline's worst-case lag — e.g. KZO-177 passes ~14 (close + cron + buffer)
   * so the helper returns "today" only after the daily-refresh has had a clear chance
   * to land bars. Without this, the consumer flips to "stale/down" every weekday in
   * the close-to-cron window.
   */
  settleGraceHours?: number;
}

// Pure-function exports for unit tests that exercise math without instantiation
export function latestSettledTradingDayPure(
  tradingDates: ReadonlySet<string>,
  market: MarketCode | "FX",
  now: Date,
  options?: SettleOptions,
): string;
export function tradingDaysBetweenPure(
  tradingDates: ReadonlySet<string>,
  d1: string,
  d2: string,
  market: MarketCode | "FX",
): number;
export function isTradingDayPure(
  tradingDates: ReadonlySet<string>,
  market: MarketCode | "FX",
  date: string,
): boolean;
```

**Persistence interface gains exactly one method:**

```ts
interface Persistence {
  /**
   * KZO-173: distinct `bar_date` values from `market_data.daily_bars` for the given
   * market, on or after `fromDate` (inclusive). Used by TradingCalendarCache to derive
   * the trading-day set per market. Order: ascending. Format: ISO YYYY-MM-DD.
   */
  getDistinctBarDates(market: MarketCode, fromDate: string): Promise<string[]>;
}
```

## Implementation Steps

### Phase 0 — Pre-implementation verification

- [x] Confirm KZO-163 (provider registry) merged and on `dev`. ✅ as of 2026-04-26.
- [x] Verify pg DATE type parser config in `apps/api/src/persistence/postgres.ts` returns ISO strings (not JS Date objects) for the `bar_date` column. `types.setTypeParser(types.builtins.DATE, (value: string) => value)` registered at postgres.ts:104. (Gap N12)
- [x] Grep for existing `app.tradingCalendarCache` references — confirmed zero before implementation. Confirms no name collision.

### Phase 1 — Persistence layer

- [x] Add `getDistinctBarDates(market, fromDate)` to the `Persistence` interface in `apps/api/src/persistence/types.ts`.
- [x] **PostgresPersistence** implementation: schema-qualified `SELECT DISTINCT bar_date FROM market_data.daily_bars WHERE market_code = $1 AND bar_date >= $2 ORDER BY bar_date ASC`. Returns `string[]` of ISO YYYY-MM-DD. (postgres.ts:2428)
- [x] **MemoryPersistence** implementation: filters in-memory `daily_bars` by market + fromDate, dedupes via `Set`, sorts ascending.
- [x] No write methods — KZO-173 has no independent calendar write path.

### Phase 2 — TradingCalendarCache class

- [x] Create `apps/api/src/services/market-data/tradingCalendar.ts`. Module structure: `class TradingCalendarCache`, pure helper exports, constants, local `CalendarMarket` type alias. (Gap N1 honored)
- [x] Constants: `MARKET_TIMEZONE`, `MARKET_CLOSE_LOCAL_TIME`, `FX_PUBLISH_HOUR_UTC = 16`, `LOOKBACK_DAYS = 400`, `TTL_MS = 60 * 60 * 1000`.
- [x] **Cache state** — `Map<MarketCode, TradingCalendarCacheEntry>` with `{ dates, loadedAt, horizonStartDate, warnedEmpty }`.
- [x] **`getTradingDates(market)`** — TTL check, refresh via `getDistinctBarDates`, in-flight dedup via `Map<MarketCode, Promise<Set<string>>>`, try/catch with error log + empty Set fallback. (Gaps N17, N18)
- [x] **`notifyBarsUpserted(market, dates)`** — filters dates by `>= cached.horizonStartDate` before adding. (Gap N16)
- [x] **`flush()`** — clears entire Map; class method only, not exposed via HTTP.

### Phase 3 — Helper methods (and pure-function exports)

- [x] **`latestSettledTradingDay(market, now, options)`** — implemented as class method delegating to `latestSettledTradingDayPure`.
- [x] **`tradingDaysBetween(d1, d2, market)`** — `(d1, d2]` convention, defensive clamps, pure-function backing.
- [x] **`isTradingDay(market, date)`** — `set.has(date)` for equity; weekday check for FX.
- [x] Each public method has a matching pure-function export taking the trading-dates set explicitly.
- [x] Synthetic FX path implemented with known v1 limitations (ECB holidays → KZO-192; early-close → KZO-193) documented inline.

### Phase 4 — `latestSettledTradingDay` close-time math

- [x] `Intl.DateTimeFormat` via `getMarketLocalParts()` resolves `now` into market-local date + hour/minute.
- [x] `settleGraceHours` applied to close threshold; rollover-past-24 handled by backward search through trading dates.
- [x] Backward search through cached set for most recent date `≤ (closeElapsed ? localDate : localDate - 1 day)`.
- [x] Bootstrap fallback: empty Set OR no date within 14-day recency check → weekday-only logic + warn log.
- [x] `warnedEmpty` flag gates bootstrap warn to fire once per empty-refresh, reset on next non-empty refresh. (Gap N13)

### Phase 5 — Wiring

- [x] `registerTradingCalendarCache.ts` created with factory function + `declare module "fastify"` augmentation.
- [x] Called in `apps/api/src/app.ts:152` — `registerTradingCalendarCache(app, { persistence: app.persistence })`.
- [x] `pgBoss.ts:86` calls `app.tradingCalendarCache.notifyBarsUpserted` after bar upserts (group-by-market pattern per Gap N2).
- [x] `/__e2e/seed-daily-bars` extended in `registerRoutes.ts` (lines 1358, 1364, 1566) to call `notifyBarsUpserted` after seeding. `assertE2ESeedEnabled()` guard unchanged.

### Phase 6 — Tests

- [x] **Unit tests** at `apps/api/test/unit/services/market-data/tradingCalendar.test.ts` (Vitest):
  - TW/US/AU happy paths, DST boundaries, `settleGraceHours`, bootstrap fallback with `warnedEmpty` guard, synthetic FX, `tradingDaysBetween` edge cases, `isTradingDay` paths.
  - Additional persistence unit tests at `apps/api/test/unit/tradingCalendarPersistence.test.ts`.

- [x] **Integration tests** at `apps/api/test/integration/tradingCalendar.integration.test.ts` (`describePostgres`):
  - `getDistinctBarDates` DISTINCT/ascending/market-filter/fromDate-inclusive.
  - Cache refresh from real DB, `notifyBarsUpserted` behavior, TTL + in-flight dedup, DB error fallback.
  - `KZO173-TEST-*` synthetic tickers used to avoid cross-test interference.

- [x] **No HTTP/E2E specs in KZO-173.** Suite 6, 7, 8 unchanged. KZO-177 owns those.

### Phase 7 — Pre-PR

- [x] Per `.claude/rules/code-review-before-pr.md`: pre-PR code review complete. Output at `docs/004-notes/kzo-173/review-202605061844-trading-calendar.md`.
- [ ] Per `.claude/rules/full-test-suite.md`: pre-push gate — `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full` from repo root. All 8 suites green.
- [x] Per `.claude/rules/code-review-before-pr.md` "typecheck green" companion: `apps/api/test/tsconfig.json` updated to include `unit/services/market-data/tradingCalendar.test.ts`, `unit/tradingCalendarPersistence.test.ts`, and `integration/tradingCalendar.integration.test.ts`.
- [x] Per `.claude/rules/interface-caller-verification.md`: `getDistinctBarDates` and `app.tradingCalendarCache.*` callers confirmed to implementation + tests only at PR time. KZO-177 starts after merge.
- [ ] PR description per `.claude/rules/pr-bound-docs-review-compliance.md` (not yet created):
  - `## Problem` — KZO-177 needs `latestSettledTradingDay` + `tradingDaysBetween`. Original schema-driven scope replaced by Option α (derived from `daily_bars`).
  - `## Solution` — `TradingCalendarCache` on `app`, `getDistinctBarDates` in persistence, no schema/migration/admin/scheduler-skip.
  - `## Testing` — with `Evidence:` block (Suite 4 unit count, Suite 5 integration count).
  - `## Risk/Rollback` — purely additive; rollback = revert. Monitor: bootstrap-fallback warn log frequency post-deploy.
  - Behavioral deltas: NONE.

### Phase 8 — Wave 2 docs

- [x] **`docs/market-data-platform.md`** — "Trading calendar derivation" section added explaining source = `daily_bars`, cache lifecycle, `settleGraceHours`, bootstrap fallback, FX synthetic, v1 limitations.
- [x] **Transition note** at `docs/004-notes/kzo-173/transition-202605061823-trading-calendar.md` (frozen on merge).
- [x] **No `docs/002-operations/runbook.md` changes** in scope — confirmed correct; KZO-173 has no operational surface.

## Open Items

(All converted to Linear tickets; no in-flight notes.)

- ✅ KZO-191 — Refactor `isWeekendIsoDate` and `quoteSnapshotService.getUTCDay()` callers to use `app.tradingCalendarCache.isTradingDay`. Priority: Low.
- ✅ KZO-192 — Synthetic FX market: ECB / TARGET2 holiday awareness. Priority: Low. ~6 days/yr false-amber until landed.
- ✅ KZO-193 — Early-close session handling (TWSE LNY Eve, NYSE Black Friday, ASX Christmas Eve). Priority: Low. ~3-4 hrs/yr false-not-yet-settled until landed.

## Out of Scope (explicit non-deliverables)

- `market_trading_calendar` table or any calendar-specific schema.
- Static seed file (TS arrays of holidays).
- Migration file for KZO-173 (slot 046 stays open for the next ticket).
- Daily-refresh / catalog-sync skip-on-holiday optimization.
- External library or API for holiday data (`date-holidays`, `trading-calendar` npm, TradingHours.com REST API — all rejected during scope-grill).
- Admin route for calendar management.
- Refactor of existing `quoteSnapshotService.ts` or `isWeekendIsoDate()` to use the new helpers (deferred to KZO-191).
- ECB / TARGET2 holiday handling for synthetic FX (deferred to KZO-192).
- Early-close session handling (deferred to KZO-193).
- Cross-instance cache coordination (Redis / shared store) — each API instance maintains its own per-process cache.

## Implementation Guardrails (from gap check)

- **G1 — No migration.** Implementer must NOT fabricate a migration file. The next slot (`046_*.sql`) is reserved for the next ticket that needs schema changes.
- **G2 — `MarketCode | "FX"` typing.** Local `type CalendarMarket` alias in `tradingCalendar.ts`. Don't pollute `libs/shared-types` until a second consumer needs it.
- **N2 — Multi-market batch safety in `notifyBarsUpserted`.** Group by `marketCode` even though batches are single-market in practice.
- **N3 — UTC vs market-local in cache lookback.** `fromDate = today_utc() - 400 days` is computed in UTC; `daily_bars.bar_date` rows are in market-local frame. Off-by-one at the cutoff edge is acceptable on a 400-day window; add a code comment.
- **N5 — Empty-bar cron runs on holidays count as `success` for KZO-177 provider health.** Confirmed coherent — `recordOutcome({outcome: "success"})` updates `last_successful_run` on holidays; provider stays healthy.
- **N6 — Multi-instance 1-hour stale window.** Instance B's cache lags up to 1 hour after Instance A upserts. Doesn't cross any KZO-177 threshold. Documented in cache class comment.
- **N11 — `(market_code, bar_date)` index optimization** is deferred. Existing PK supports the query well enough at ~280 dates × 3 markets. Add later if `getDistinctBarDates` shows up in slow-query logs.
- **N12 — pg DATE type parser config** verified in Phase 0.
- **N13 — `warnedEmpty` flag** prevents log spam during bootstrap fallback.
- **N16 — `notifyBarsUpserted` filters by `cached.horizonStartDate`** to drop historical-backfill dates outside the lookback window.
- **N17 — Refresh wraps DB call in try/catch** + error log + empty Set fallback.
- **N18 — In-flight Promise dedup** prevents thundering-herd on cold cache.

## References

- **Linear:**
  - KZO-173 (this) — Multi-market trading calendar
  - KZO-177 — Per-provider health UI + stale-data badges (downstream consumer; needs the helpers from this ticket)
  - KZO-163 — Provider registry refactor (foundational — Done)
  - KZO-170, KZO-172 — US/AU ingestion (Done; `daily_bars` already populated for both)
  - KZO-191, KZO-192, KZO-193 — Follow-up tickets created from this scope-grill
- **Project conventions:**
  - `.claude/rules/migration-strategy.md` — explicitly NOT applicable (no migration in this ticket)
  - `.claude/rules/integration-test-persistence-direct.md` — Postgres-backed integration tests + schema-qualified table names companion rule
  - `.claude/rules/interface-caller-verification.md` — grep for callers before introducing new interface methods
  - `.claude/rules/e2e-seed-vs-reset-guards.md` — `/__e2e/seed-daily-bars` extension (assertE2ESeedEnabled)
  - `.claude/rules/code-review-before-pr.md` — pre-PR `/code-reviewer` run
  - `.claude/rules/full-test-suite.md` — all 8 suites green pre-push
  - `.claude/rules/pr-bound-docs-review-compliance.md` — PR description structure
  - `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` — unique tickers in tests; no E2E specs added by this ticket
  - `.claude/rules/agent-team-workflow.md` — Tier 2 (Squad) likely fits this ticket given moderate complexity + existing precedent
- **Sibling scope-todos:** `docs/004-notes/kzo-177/scope-todo-202605061600-provider-health.md` (downstream consumer; helper API requirements live there)
