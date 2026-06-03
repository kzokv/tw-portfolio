---
slug: kzo-197
type: transition
created: 2026-05-09T16:00
tickets: [KZO-197]
supersedes_in_runbook: docs/002-operations/runbook.md §21 "Re-run now" button (yahoo-finance-au bullet, 60-second cooldown line, audit-log metadata line)
follow_ups: [KZO-203, KZO-204, KZO-205]
---

# KZO-197 transition — AU catalog-bootstrap warm-up + `awaiting` status

## Problem statement

On a fresh deployment the AU catalog is populated with ~2,400 instruments in `bars_backfill_status='pending'` by the Twelve Data catalog-sync cron (KZO-194). No user has added an AU transaction yet, so `user_monitored_tickers` has zero AU rows. The pre-KZO-197 "Re-run now" path called `enqueueDailyRefresh({ marketFilter:'AU' })`, which is a no-op against an empty monitored set — the operator had no actionable mechanism to bootstrap bars history.

Compounding this, any provider whose `last_successful_run` and `last_failed_run` were both null (i.e., it had _never_ successfully run) rendered with status `down` — indistinguishable from a genuinely failing provider. Operators reading the admin dashboard had no way to tell "hasn't run yet" from "is broken."

KZO-197 closes both gaps: the AU button now dispatches a warm-up pass over the unbackfilled catalog _in addition to_ the monitored refresh, and a new `awaiting` badge surfaces the never-run distinction at the UI layer.

---

## Schema additions

| Object | Change | Migration |
|---|---|---|
| `public.app_config.yahoo_au_rerun_cooldown_ms` | New `BIGINT NULL` column. `NULL` = fall back to `Env.YAHOO_AU_RERUN_COOLDOWN_MS` (default 30 min). | `db/migrations/051_kzo197_yahoo_au_rerun_cooldown.sql` |
| `Env.YAHOO_AU_RERUN_COOLDOWN_MS` | New env var (default `1800000` ms). Has `.default(...)` → wizard auto-registration not required (`env-setup-autogen-required-secrets.md`). | `libs/config/src/env-schema.ts` |

Migration 051 is additive-only (`ADD COLUMN IF NOT EXISTS ... NULL`). Safe to re-run; no destructive change.

---

## Key code touch points

| File | Change summary | Owner |
|---|---|---|
| `db/migrations/051_kzo197_yahoo_au_rerun_cooldown.sql` (NEW) | `ALTER TABLE app_config ADD COLUMN IF NOT EXISTS yahoo_au_rerun_cooldown_ms BIGINT NULL` | Backend |
| `libs/config/src/env-schema.ts` | `YAHOO_AU_RERUN_COOLDOWN_MS` with `z.coerce.number().int().positive().default(1800000)` | Backend |
| `apps/api/src/persistence/types.ts` | `yahooAuRerunCooldownMs: number \| null` on `AppConfigRow` + patchable-key union | Backend |
| `apps/api/src/persistence/postgres.ts` | Read/write `yahoo_au_rerun_cooldown_ms` in singleton SELECT, `setAppConfigPatch` UPDATE, bootstrap INSERT | Backend |
| `apps/api/src/persistence/memory.ts` | Mirror field on in-memory singleton + admin patch path; `listAuCatalogBarsBackfillCandidates()` impl | Backend |
| `apps/api/src/services/appConfig/cache.ts` | `yahooAuRerunCooldownMs: number \| null` on cached entry shape | Backend |
| `apps/api/src/services/appConfig/bounds.ts` | `yahooAuRerunCooldownMs: { min: 1_000, max: 86_400_000 }` | Backend |
| `apps/api/src/services/appConfig/providerHealth.ts` | NEW `getEffectiveYahooAuRerunCooldownMs()` + `getEffectiveProviderRerunCooldownMs(providerId)` | Backend |
| `apps/api/src/services/market-data/enqueueAuCatalogBarsBackfill.ts` (NEW) | Helper reading `listAuCatalogBarsBackfillCandidates()`, enqueuing per-ticker with composite singleton key, omitting `startDate` | Backend |
| `apps/api/src/routes/adminRoutes.ts` (POST rerun) | Yahoo market branches run catalog warm-up + monitored refresh in parallel; per-provider cooldown resolver; nested audit metadata for AU/KR | Backend |
| `apps/api/src/routes/adminRoutes.ts` (GET providers) | Derives `'awaiting'` per row; populates `rerunCooldownMs` via resolver | Backend |
| `libs/shared-types/src/index.ts` | `ProviderHealthStatus` widened to include `'awaiting'`; `ProviderHealthStatusDto` gains required `rerunCooldownMs: number` | Backend |
| `libs/test-api/src/assistants/providers/ProvidersApiArrange.ts` | `ProviderHealthRowShape.status` includes `"awaiting"`; `rerunCooldownMs: number` added | Backend |
| `apps/web/components/admin/AdminProvidersClient.tsx` | 4th badge state (`awaiting`); 8 tooltip dict entries; provider-help popovers; `formatCooldownLabel` integration; 429 countdown from `rerunCooldownMs`; KR resolver guardrail controls | Frontend |
| `apps/web/lib/formatCooldownLabel.ts` (NEW) | `formatCooldownLabel(ms): string` — ≤120,000 ms → `"Ns"`, >120,000 ms → `"N min"` | Frontend |
| `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` | Appended KZO-197 `AUWARM*` reservation block | QA |

---

## Behavioral deltas

Before KZO-197, clicking "Re-run now" for `yahoo-finance-au` on a fresh deploy was a silent no-op — `enqueueDailyRefresh` returned `tickerCount=0` because no AU tickers were monitored. After KZO-197, the button dispatches a warm-up pass over the catalog, enqueuing one backfill job per `pending`/`failed` AU instrument (approximately 2,400 on a fully-fresh catalog). This fills bars history from `1988-01-28`. Once these jobs complete, each instrument's `bars_backfill_status` advances to `ready`, and subsequent "Re-run now" clicks fall through to the pure monitored-refresh path (the warm-up branch short-circuits on an empty candidate set).

Yahoo market rerun cooldown changed from the global 60 seconds to a 30-minute default (DB-tunable via `app_config.yahoo_au_rerun_cooldown_ms`). This protects against repeated catalog-warm-up triggering while Yahoo jobs drain under the provider budget. Non-Yahoo providers are unaffected — they continue to use the global 60-second cooldown.

The `provider_health_status` table and `provider_health_status` DB CHECK constraint are **unchanged**. The `awaiting` value is computed by the `GET /admin/providers` route projection layer only; it never reaches the DB.

Yahoo market `provider_health_rerun` audit-log entries gain nested `catalogBackfill` and `monitoredRefresh` blocks. The top-level `tickerCount` (sum) and `jobId` (first non-null) are preserved for back-compat. Non-Yahoo providers' audit shapes are unchanged.

**This warm-up is operator-initiated only.** The operator must click "Re-run now" on the admin Providers tab after a fresh deploy. Auto-triggering warm-up post-deploy is explicitly deferred to **KZO-203**. The `awaiting` badge is the visual signal that the warm-up has not yet occurred.

**KR resolver repair guardrail (2026-06-03 review closure):** `yahoo-finance-kr` admin reruns default to explicit `quote_first`. Operators can select `chart_probe_v1` for unresolved KR symbols, but the API requires `resolverModeRiskAccepted=true` and rejects resolver-mode payloads for non-KR providers. Audit metadata records the effective KR `resolverMode` and whether risk acceptance was supplied.

---

## DTO changes

### `ProviderHealthStatus` type (widened)

```ts
// Before (libs/shared-types/src/index.ts)
export type ProviderHealthStatus = "healthy" | "degraded" | "down";

// After
export type ProviderHealthStatus = "healthy" | "degraded" | "down" | "awaiting";
```

### `ProviderHealthStatusDto` interface (new field)

```ts
export interface ProviderHealthStatusDto {
  providerId: string;
  status: ProviderHealthStatus;          // widened (see above)
  lastSuccessfulRun: string | null;
  lastFailedRun: string | null;
  errorCount24h: number;
  errorCount7d: number;
  rateLimitCount24h: number;
  lastErrorMessage: string | null;
  lastManualRerunAt: string | null;
  rerunCooldownMs: number;              // NEW required field
  updatedAt: string;
  recentErrors: ProviderErrorTrailEntryDto[];
}
```

`rerunCooldownMs` is populated server-side by `getEffectiveProviderRerunCooldownMs(providerId)` and reflects the live `app_config` value — Yahoo market providers get the DB-overridable 30-min default; non-Yahoo providers get the global 60-second default.

### Yahoo market `provider_health_rerun` audit metadata (nested, additive)

```jsonc
// Before (all providers)
{ "providerId": "...", "marketCode": "AU", "tickerCount": 22, "jobId": "..." }

// After (yahoo-finance-au / yahoo-finance-kr — additive nested blocks)
{
  "providerId": "yahoo-finance-au",
  "marketCode": "AU",
  "tickerCount": 24,                            // sum (back-compat)
  "jobId": "<first non-null job id>",           // back-compat
  "catalogBackfill":   { "tickerCount": 22, "jobId": "<catalog batch id>" },
  "monitoredRefresh":  { "tickerCount": 2,  "jobId": "<monitored batch id>" }
}
```

All other providers retain the flat `{ providerId, marketCode, tickerCount, jobId }` shape.

---

## Locked testid catalog

| Element | testid | Location |
|---|---|---|
| Status badge (desktop, existing) | `provider-status-badge-{id}` | `ProviderRow` |
| Status badge (card, existing) | `provider-status-badge-{id}` | `ProviderCard` |
| Provider help trigger (desktop) | `provider-help-trigger-{id}` | `ProviderRow` |
| Provider help trigger (card) | `provider-help-trigger-{id}` | `ProviderCard` |
| Provider help content panel (desktop) | `provider-help-popover-{id}` | Radix portal |
| Provider help content panel (card) | `provider-help-popover-{id}` | Radix portal (mobile) |

`{id}` = unmodified `providerId` string (e.g. `yahoo-finance-au`, `finmind-tw`).

---

## Locked i18n strings

All tooltip entries are flat `Record<string, string>` in `AdminProvidersClient.tsx`'s inline `t` dict. The `{cooldown}` placeholder is interpolated at render time via `formatCooldownLabel(provider.rerunCooldownMs)`.

| Key | Value |
|---|---|
| `statusAwaiting` | `"Awaiting first run"` |
| `rerunTooltipFinmindTw` | `"Refreshes daily bars + dividends for monitored TW tickers via FinMind. Cooldown {cooldown}."` |
| `rerunTooltipFinmindUs` | `"Refreshes daily bars + dividends for monitored US tickers via FinMind. Cooldown {cooldown}."` |
| `rerunTooltipYahooFinanceAu` | `"Warms uncached AU catalog rows AND refreshes monitored AU tickers via Yahoo Finance. Fresh deploys process ~2,400 jobs over ~40 min. Cooldown {cooldown}."` |
| `rerunTooltipTwelveDataAu` | `"Re-syncs the AU instrument universe via Twelve Data (catalog metadata only — no bars). Cooldown {cooldown}."` |
| `rerunTooltipYahooFinanceKr` | `"Warms pending or failed KR bar backfills AND refreshes monitored KR tickers via Yahoo Finance. Quote-first is the safe default; chart_probe_v1 requires acknowledgement. Cooldown {cooldown}."` |
| `rerunTooltipTwelveDataKr` | `"Re-syncs the KR instrument universe via Twelve Data (catalog metadata only — no bars). Cooldown {cooldown}."` |
| `rerunTooltipFrankfurter` | `"Refreshes today's FX rates from Frankfurter (ECB-backed). Cooldown {cooldown}."` |
| `rerunTooltipAsxGicsCsv` | `"Re-runs ASX GICS sector + industry-group enrichment from the S&P/ASX CSV. Cooldown {cooldown}."` |

Provider help trigger accessible names come from the visible provider id; there is no generic trigger `aria-label`.

**`formatCooldownLabel(ms)` contract:** ≤ 120,000 ms → `"${Math.round(ms/1000)}s"` (e.g. `"60s"`); > 120,000 ms → `"${Math.round(ms/60000)} min"` (e.g. `"30 min"`). 0 or negative → `"0s"`.

---

## Test catalog (what landed)

| Suite | File | Description |
|---|---|---|
| API unit | `apps/api/test/unit/market-data/enqueueAuCatalogBarsBackfill.test.ts` | Filter, no-startDate, composite singleton key, memory no-op |
| API unit | `apps/api/test/unit/appConfig/providerHealthRerunCooldown.test.ts` | AU 30 min default + DB override; others 60 s |
| API integration (Postgres) | `apps/api/test/integration/auCatalogRerunUnion.integration.test.ts` | Fresh-deploy union; post-warm-up union; `describePostgres` SQL-filter block |
| API integration (Postgres) | `apps/api/test/integration/adminProvidersAwaiting.integration.test.ts` | `awaiting` derivation; `rerunCooldownMs` per provider; DB override |
| API integration (Postgres) | `apps/api/test/integration/perProviderRerunCooldown.integration.test.ts` | AU 30 min gate; TW 60 s gate; `app_config` override |
| API HTTP (AAA) | `apps/api/test/http/specs/admin-providers-yahoo-au-rerun-aaa.http.spec.ts` | POST rerun 202 + nested AU metadata; back-compat flat shape |
| E2E OAuth | `apps/web/tests/e2e/specs-oauth/provider-health-aaa.spec.ts` | `awaiting` badge; tooltip-trigger per provider; AU tooltip copy + cooldown; rerun dispatches jobs |
| Web unit | `apps/web/test/lib/formatCooldownLabel.test.ts` | Boundary cases: 0, 60_000, 120_000, 120_001, 1_800_000, 3_600_000 |
| Web unit | `apps/web/test/components/admin/AdminProvidersClient.test.tsx` | `awaiting` badge render; tooltip-trigger visibility; `{cooldown}` interpolation; 429 uses `rerunCooldownMs` |

**Reserved ticker prefix:** `AUWARM01`–`AUWARM10` (KZO-197). Updated in `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`.

**Final iter-2 suite results:** ESLint clean · typecheck clean · web vitest 374/0 · API vitest 1225/0/367 · integration 673/0/1 · e2e-bypass 202/0/1 · e2e-oauth 105/0 · API HTTP 241/0/2.

---

## Operator note: warm-up is still operator-initiated

The catalog warm-up triggered by clicking "Re-run now" on `yahoo-finance-au` is an **explicit operator action**. It is NOT auto-triggered on deploy. Operators deploying to a fresh environment should:

1. Navigate to `/admin` → **Providers**.
2. The `yahoo-finance-au` row will show **"Awaiting first run"** (neutral grey badge) if no run has occurred.
3. Click **Re-run now**. The button enqueues ~2,400 backfill jobs. Expect ~40 min to complete at Yahoo's 60/min self-imposed ceiling.
4. The badge will transition to `healthy` (or `degraded`/`down`) once the first successful run records a `last_successful_run` timestamp.

Auto-triggering warm-up post-deploy is tracked in **KZO-203**.

---

## Follow-ups

| Ticket | Scope |
|---|---|
| **KZO-203** | Auto-trigger AU catalog warm-up post-deploy — removes the manual operator step from the fresh-deploy checklist. |
| **KZO-204** | Per-provider rerun cooldown overrides for TW / US / Frankfurter / `asx-gics-csv` — currently all use the global 60-second default. |
| **KZO-205** | Cap repeated retries on permanently-failed `bars_backfill_status='failed'` rows (`failed_count` debounce or hard retry limit). |

---

## Code review summary

Phase 3 Code Review produced 0 CRITICAL · 0 HIGH · 1 MEDIUM · 2 LOW · 2 INFORMATIONAL. All MEDIUM/LOW findings were addressed in Phase 4 before merge:

- **MEDIUM-1** (resolved in Phase 4): Integration tests initially used `buildApp({memory})` instead of `describePostgres`. A `describePostgres` block was added to `auCatalogRerunUnion.integration.test.ts` verifying the Postgres SQL filter with raw `pool.query` seeds.
- **LOW-1** (resolved in Phase 4): `ProviderHealthRowShape` in `libs/test-api` was stale; widened to include `"awaiting"` and `rerunCooldownMs: number`.
- **LOW-2** (resolved in Phase 4): 5 new test files added to `apps/api/test/tsconfig.json`'s `include` for typecheck coverage.
- **INFO-1** (no action): Migration manifest not updated — correctly identified that the runner auto-discovers numbered migrations; no manifest entry needed.
- **INFO-2** (no action): Memory-mode `tickerCount=0` shape pre-ratified correct by Architect in Phase 0.

---

## Codex post-CR review — iter 3 closure

A user-initiated Codex review after Phase 3 surfaced 4 additional findings (3 P2 + 1 P3). All were closed in iter 3. A cosmetic tooltip-contrast fix (Task #10) also landed concurrently.

### P2-1 — AU warm-up batch tracking stuck

**Files:** `apps/api/src/services/market-data/backfillWorker.ts:389-410` (success path), `:466-498` (failure path)

`enqueueAuCatalogBarsBackfill` allocates a `refresh_batches` row and populates `batchId`. The worker's `updateBatchTickerResult` call was gated on `isDailyRefresh`; admin-rerun AU catalog jobs have `isDailyRefresh = false`, so the batch counter never advanced.

Fix: gate changed from `isDailyRefresh` to `Boolean(batchId)`. Both daily-refresh jobs and AU-catalog-rerun jobs (which both carry `batchId`) now advance the batch counter. TW/US admin-rerun jobs (no `batchId`) are unaffected. `isDailyRefresh` is retained for the SSE event-fanout branch which is legitimately trigger-specific.

### P2-2 — Cross-market `updateBackfillStatus` scope (pre-existing, exposed by KZO-197)

**Files:** `apps/api/src/persistence/types.ts:955`, `apps/api/src/persistence/postgres.ts:5888`, `apps/api/src/persistence/memory.ts:2269`, `apps/api/src/plugins/pgBoss.ts:68`, `apps/api/src/services/market-data/backfillWorker.ts:77,278,386,471`, `apps/api/src/routes/registerRoutes.ts:4475`, `apps/api/src/services/demoData.ts:67-68`

`updateBackfillStatus(ticker, status)` filtered `WHERE ticker = $2` only — cross-listed tickers could update sibling-market rows. The bulk AU warm-up (~2,400 jobs) made this collision realistic for the first time.

Fix: signature extended to `updateBackfillStatus(ticker, marketCode, status)`. Postgres predicate: `WHERE ticker = $2 AND market_code = $3`. Memory mirrors. 8 production callers + 9 test callers updated.

### P2-3 — Retry-After header not honored on 429 (UX bug)

**Files:** `apps/web/lib/api.ts:72-89` (`ApiError.retryAfterSeconds`), `apps/web/lib/api.ts:235-252` (`parseError` reads header), `apps/web/components/admin/AdminProvidersClient.tsx:137-149` (countdown preference)

The client reset countdown to the full configured cooldown (30 min for AU) regardless of the server's `Retry-After` header. Operators clicked 28 minutes into the cooldown and saw a fresh 30-minute counter.

Fix: `parseError()` reads the `Retry-After` delta-seconds header (RFC 7231 §7.1.3) and attaches `retryAfterSeconds` to `ApiError`. The component prefers `err.retryAfterSeconds`, falling back to `Math.ceil(rerunCooldownMs / 1000)` only when the header is absent or non-numeric.

### P3 — Memory `getAllMonitoredTickers` filter parity

**File:** `apps/api/src/persistence/memory.ts:2607-2628`

`MemoryPersistence.getAllMonitoredTickers` returned all monitored-set rows; Postgres filtered `bars_backfill_status='ready' AND delisted_at IS NULL`. Memory-backed E2E with `app.boss` set could enqueue work that production excludes.

Fix: memory implementation now mirrors the Postgres predicate via instruments-map lookup (`bars_backfill_status === 'ready' && !delisted_at`).

### Bonus — Tooltip text contrast (cosmetic, Task #10)

**File:** `apps/web/components/ui/TooltipInfo.tsx:31`

`text-slate-100` (near-white) on the `glass-panel` light backdrop (`apps/web/app/globals.css:74-82`) was nearly invisible. Changed to `text-slate-900`. Affects all 14+ TooltipInfo callers uniformly; no behavioral change.
