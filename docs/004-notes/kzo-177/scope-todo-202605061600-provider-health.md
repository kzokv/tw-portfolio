---
slug: kzo-177
source: scope-grill
created: 2026-05-06
tickets: [KZO-177]
required_reading: []
superseded_by: null
---

# Todo: KZO-177 — Per-provider health UI + stale-data badges

> **For agents starting a fresh session:** read the Linear ticket KZO-177 and the locked-scope summary at the top of this file before starting implementation. Project conventions live in `CLAUDE.md` and `.claude/rules/`.

## Locked Scope Summary

KZO-177 surfaces per-provider health (4 providers: `finmind-tw`, `finmind-us`, `yahoo-finance-au`, `frankfurter`) and per-position data freshness via:

- New `/admin/providers` admin subpage with status badges, error trail, and "Re-run now"
- Stale-data badge in the Holdings table (server-classified, opaque pre-formatted tooltip)
- In-app per-admin notifications on transition to `down` (24h-suppressed) + recovery on `down → healthy`

**Blocked on KZO-173** (Multi-market trading calendar) — KZO-177 needs the calendar's `latestSettledTradingDay(marketCode, now)` and `tradingDaysBetween(d1, d2, marketCode)` helpers. KZO-173 must merge first.

## Implementation Steps

### Phase 0 — Prerequisite verification (before starting work)

- [ ] Verify KZO-173 has merged and exposes `latestSettledTradingDay(marketCode, now)` and `tradingDaysBetween(d1, d2, marketCode)`. If KZO-173 still in flight, pause KZO-177.
- [ ] Verify KZO-170 (US ingestion) and KZO-172 (AU ingestion) Done — both already complete as of scope-grill.

### Phase 1 — Schema (SQL migrations)

- [ ] Create migration `04N_kzo177_provider_health_status.sql` (number depends on KZO-173's slot):
  - `market_data.provider_health_status`:
    - `provider_id TEXT PRIMARY KEY`
    - `last_successful_run TIMESTAMPTZ`
    - `last_failed_run TIMESTAMPTZ`
    - `error_count_24h INTEGER NOT NULL DEFAULT 0`
    - `error_count_7d INTEGER NOT NULL DEFAULT 0`
    - `rate_limit_count_24h INTEGER NOT NULL DEFAULT 0` (separate from errors)
    - `status TEXT NOT NULL CHECK (status IN ('healthy','degraded','down'))`
    - `last_error_message TEXT`
    - `last_down_notification_at TIMESTAMPTZ` (24h suppression key)
    - `last_manual_rerun_at TIMESTAMPTZ` (60s admin button cooldown)
    - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - Pre-seed 4 rows: `finmind-tw`, `finmind-us`, `yahoo-finance-au`, `frankfurter`. Initial `status='down'`, all timestamps NULL.
  - `market_data.provider_error_trail`:
    - `id BIGSERIAL PRIMARY KEY`
    - `provider_id TEXT NOT NULL REFERENCES market_data.provider_health_status(provider_id)`
    - `occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    - `error_class TEXT NOT NULL CHECK (error_class IN ('rate_limit','http_4xx','http_5xx','network','parse','other'))`
    - `error_message TEXT`
    - `context JSONB`
  - Index: `(provider_id, occurred_at DESC)`.

### Phase 2 — Aggregator service

- [ ] Create `apps/api/src/services/market-data/providerHealth.ts` exposing `recordOutcome({ providerId, outcome })` where:
  - `outcome.kind: "success" | "rate_limit" | "error"` (with `errorClass`, `errorMessage`, `context` for `error` and `rate_limit`)
  - On success: bump `last_successful_run`, recompute status (healthy or degraded based on `error_count_24h`), CAS-clear `last_down_notification_at` and fire recovery notifications if previously down.
  - On error: bump `error_count_24h` + `last_failed_run` + `last_error_message`; insert trail row; recompute status; if transitioned to `down` and `last_down_notification_at` is older than 24h (or NULL), fan out admin notifications + set `last_down_notification_at`.
  - On rate_limit: bump `rate_limit_count_24h`; insert trail row classified `rate_limit`; do NOT change status or counters.
- [ ] Status thresholds (using KZO-173 helper `latestSettledTradingDay(market, now)`):
  - `healthy`: `last_successful_run ≥ latestSettledTradingDay(market)` AND `error_count_24h === 0`
  - `degraded`: `last_successful_run ≥ latestSettledTradingDay(market)` AND `error_count_24h ≥ 1`
  - `down`: `last_successful_run < latestSettledTradingDay(market)` (includes NULL)
  - For `frankfurter`: synthetic FX market = weekdays only.
- [ ] Wire `recordOutcome` calls into `apps/api/src/services/market-data/backfillWorker.ts` (around `provider.fetchBars` / `fetchDividends` / `fetchInstrumentMetadata` calls — typed-error catch order matters, see `.claude/rules/typed-transient-error-catch-audit.md`).
- [ ] Wire `recordOutcome` calls into `apps/api/src/services/market-data/fxRefreshWorker.ts` (frankfurter outcomes).
- [ ] **Provider classes stay pure** — no health-tracking inside `finmind.ts`, `yahooFinanceAu.ts`, etc.
- [ ] Recovery notification CAS pattern: conditional UPDATE `WHERE last_down_notification_at IS NOT NULL`; only the worker that wins (rowcount=1) fires the recovery notifications.

### Phase 3 — Admin endpoints + Re-run

- [ ] Refactor `enqueueDailyRefresh()` in `apps/api/src/services/market-data/dailyRefreshEnqueue.ts` to accept optional `marketFilter?: MarketCode`. Filter `getAllMonitoredTickers()` results before enqueueing.
- [ ] Extend `BackfillJobData` trigger discriminant union with `"admin_rerun"` value.
- [ ] New route: `POST /admin/providers/:providerId/rerun`:
  - Auth: admin-only (existing admin-role guard pattern).
  - For `finmind-tw`/`finmind-us`/`yahoo-finance-au`: dispatch via `enqueueDailyRefresh({ marketFilter })`. For `frankfurter`: dispatch via existing FX queue path.
  - 60s per-provider cooldown via `last_manual_rerun_at` column. Returns `429 rate_limit_exceeded` with `Retry-After` if clicked within cooldown.
  - Audit: `audit_log` entry with `action: "provider_health_rerun"`, `targetType: "provider"`, `targetId: providerId`, `metadata: { tickerCount, marketCode }`. Audited at click (before enqueue), not per-job.
  - Do NOT deprecate `/admin/fx-rates/refresh` — keep both routes.
- [ ] New route: `GET /admin/providers` (or per-row API) — returns provider rows + recent error trail (last 10 per provider).

### Phase 4 — DTO + freshness classification

- [ ] **Grep `DashboardOverviewHoldingDto` callers** before changes (per `.claude/rules/interface-caller-verification.md`):
  ```bash
  grep -rn "DashboardOverviewHoldingDto" apps libs --include="*.ts" --include="*.tsx"
  ```
- [ ] Extend `DashboardOverviewHoldingDto` in `libs/shared-types/src/index.ts`:
  - `freshness: "current" | "stale_amber" | "stale_red"`
  - `freshnessTooltip: string | null` (server-formatted i18n string, null when `current`)
- [ ] Compute classification in the service that builds `DashboardOverviewHoldingDto`:
  - `daysBehind = tradingDaysBetween(lastBarDate, latestSettledTradingDay)` via KZO-173 helper.
  - 0 → `current`, 1 → `stale_amber`, ≥2 → `stale_red`.
  - Unsupported/manual instruments (no `providerId`) → always `current` + `freshnessTooltip = null`.
  - Cache `latestSettledTradingDay(market, now)` per request.
  - Cache provider-status map per request (single SELECT into Map).
- [ ] Update test fixtures, mocks, and any other consumers found in the grep. Per `.claude/rules/shared-types-barrel-turbopack.md`, audit barrel exports if value-export changes are made.

### Phase 5 — Admin page UI (5 touch-points)

Per `.claude/rules/admin-new-subpage-checklist.md`:

- [ ] `apps/web/app/admin/providers/page.tsx` — server component, fetches DTO via API.
- [ ] `apps/web/components/admin/AdminProvidersClient.tsx` — client component:
  - Table of 4 providers with status badge (color: green=healthy, amber=degraded, red=down)
  - Per-row: `last_successful_run`, `last_failed_run`, recent error trail (10 entries collapsible)
  - "Re-run now" button per row with optimistic UI + 429 cooldown handling
  - i18n via `apps/web/features/admin/i18n.ts`
- [ ] `apps/web/components/admin/AdminSidebar.tsx` — add nav entry: `{ id: "providers", href: "/admin/providers", label: "Providers", icon: Activity }` (lucide-react `Activity` or `Heartbeat`)
- [ ] `apps/web/components/admin/AdminShell.tsx` — `ADMIN_TITLES` entry for `/admin/providers`
- [ ] `apps/web/components/admin/AdminAuditLogClient.tsx` — `ACTION_LABELS` + `ACTION_CATEGORIES` for `provider_health_rerun`

### Phase 6 — Holdings badge UI

- [ ] Update `apps/web/components/portfolio/HoldingsTable.tsx`:
  - Add prop `showFreshnessBadge?: boolean` (default `true`).
  - Render badge next to the price cell when `freshness !== "current"` and `showFreshnessBadge === true`.
  - Tooltip uses Radix Tooltip pattern (existing); copies `freshnessTooltip` from DTO verbatim.
  - Badge colors: amber chip for `stale_amber`, red chip for `stale_red`.
- [ ] Audit other consumers of `HoldingsTable`:
  - Anonymous share view (`/share/[token]`) — pass `showFreshnessBadge={false}`.
  - All other Holdings consumers default to `true`.
- [ ] Defense-in-depth: anonymous-share DTO server-side strips `freshnessTooltip` to `null` even if prop fails.

### Phase 7 — Retention + lifecycle

- [ ] Create `registerProviderErrorTrailPurge(app)` factory per `.claude/rules/fastify-eviction-lifecycle-pattern.md`:
  - Daily prune: `DELETE FROM market_data.provider_error_trail WHERE occurred_at < NOW() - INTERVAL '30 days'`
  - 24h `setInterval` + paired `onClose` cleanup
- [ ] Wire `registerProviderErrorTrailPurge(app)` into `registerRoutes.ts` before route handlers.
- [ ] Reset cron for `error_count_24h` / `error_count_7d` / `rate_limit_count_24h` rolling windows — use existing daily reset cron pattern OR compute on read with `WHERE occurred_at >= NOW() - INTERVAL '24 hours'` against the trail table (no separate counter reset). **Architect to choose between counter columns + reset cron OR computed-on-read** during implementation; computed-on-read is simpler if performance allows.

### Phase 8 — Tests

- [ ] **Unit tests** (Vitest): `recordOutcome` outcome handling, status transition logic, recovery CAS.
- [ ] **Integration tests** (`describePostgres`, per `.claude/rules/integration-test-persistence-direct.md`): full status state machine including `down → degraded → down` flap suppression, recovery on `down → healthy`, FK integrity on trail rows.
- [ ] **HTTP/E2E**:
  - `POST /admin/providers/:providerId/rerun` happy path + cooldown 429
  - Admin-only auth check
  - Anonymous share view does NOT show freshness badge or expose provider names in DTO
  - Audit-log entry exists after rerun
- [ ] **Test seed endpoint**: `POST /__e2e/seed-provider-health-status` behind `assertE2ESeedEnabled()` (per `.claude/rules/e2e-seed-vs-reset-guards.md`). Body: `{ providerId, status, lastSuccessfulRun?, errorCount24h? }`.
- [ ] Run `/aaa` to add or update E2E tests covering the flows agreed in this scope session (admin page + Holdings badge).

### Phase 9 — Docs (Wave 2)

- [ ] `docs/002-operations/runbook.md` — new section: "Provider Health Monitoring":
  - What the 3 statuses mean
  - When/why notifications fire
  - How to use "Re-run now"
  - Comparison: user repair vs admin Re-run (the table from the scope-grill analysis)
  - Error trail retention (30 days)
- [ ] `docs/001-architecture/` — add or update market-data architecture doc with the aggregator's place in the data flow.
- [ ] Transition note at `docs/004-notes/kzo-177/transition-{datetime}-provider-health.md` (frozen on merge).

### Phase 10 — Pre-PR

- [ ] Per `.claude/rules/code-review-before-pr.md`: run `/code-reviewer` before opening PR.
- [ ] Per `.claude/rules/full-test-suite.md`: run all 8 suites green via `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`.
- [ ] Per `.claude/rules/pr-bound-docs-review-compliance.md`: PR description draft has `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block), `## Risk/Rollback` sections.

## Open Items

- [ ] **KZO-173 follow-up:** comment added on KZO-173 documenting the helper-API requirements (`latestSettledTradingDay`, `tradingDaysBetween`).
- [ ] **Future tickets (NOT created here):**
  - Bulk-repair UX cap raise (currently 20 tickers per `/backfill/repair` call)
  - Email/Slack notification channels (out of scope)
  - Stale-data badge on dashboard cards / symbol detail pages (out of scope for v1)
  - Notifications on `degraded` transitions (defer until ops experience says otherwise)

## Out of Scope (explicit non-deliverables)

- Email / Slack / external notification channels
- Badge on dashboard cards or symbol detail page (Holdings only in v1)
- User-level "re-run by provider" button — existing per-user `/backfill/retry` and `/backfill/repair` cover the user scope
- Bulk-repair improvements (20-ticker cap)
- Notifications on `degraded` transitions
- Stock splits visibility (KZO-186)
- US dividends provider gap (KZO-187)

## Implementation Guardrails (from gap check)

- **G1 — Anonymous share view privacy:** Hide badge entirely + strip `freshnessTooltip` server-side as defense-in-depth.
- **G4 — FX cron reuse:** `recordOutcome` for `frankfurter` lives in `fxRefreshWorker.ts`. Existing `/admin/fx-rates/refresh` not deprecated.
- **G5 — Cooldown column:** `last_manual_rerun_at` on `provider_health_status`, not in-memory.
- **G6 — Per-request caching:** `latestSettledTradingDay(market, now)` and provider-status map cached per request.
- **G8 — Recovery race:** Conditional UPDATE on `last_down_notification_at` to avoid duplicate fires.
- **G10 — Denormalization:** `last_error_message` on `provider_health_status` is the most-recent trail entry; trail is authoritative.
- **G11 — Badge opt-in:** only `HoldingsTable` renders the badge; other DTO consumers ignore the new fields.

## References

- Linear: KZO-177 (this), KZO-173 (calendar — blocker), KZO-170 (US ingestion), KZO-172 (AU ingestion)
- Project conventions: `.claude/rules/admin-new-subpage-checklist.md`, `.claude/rules/migration-strategy.md`, `.claude/rules/service-error-pattern.md`, `.claude/rules/fastify-eviction-lifecycle-pattern.md`, `.claude/rules/typed-transient-error-catch-audit.md`, `.claude/rules/integration-test-persistence-direct.md`, `.claude/rules/e2e-seed-vs-reset-guards.md`, `.claude/rules/interface-caller-verification.md`, `.claude/rules/full-test-suite.md`
