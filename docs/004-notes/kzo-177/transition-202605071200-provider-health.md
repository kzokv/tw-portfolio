---
slug: kzo-177
type: transition-note
created: 2026-05-07T12:00:00Z
ticket: KZO-177
status: pre-merge (frozen on merge)
---

# Transition Note — KZO-177: Provider Health Monitoring

## What Was Added

### Schema (migration `046_kzo177_provider_health.sql`)

Two new tables in the `market_data` schema:

| Table | Purpose |
|---|---|
| `market_data.provider_health_status` | One row per provider; tracks last timestamps, current status, notification suppression key, Re-run cooldown key |
| `market_data.provider_error_trail` | Append-only error log; indexed on `(provider_id, occurred_at DESC)` |

Four rows are pre-seeded in `provider_health_status` with initial `status = 'down'`:
- `finmind-tw`
- `finmind-us`
- `yahoo-finance-au`
- `frankfurter`

Both tables use `CREATE TABLE IF NOT EXISTS`. The migration is idempotent and safe to re-run.

### Service layer

| File | Role |
|---|---|
| `apps/api/src/services/market-data/providerHealth.ts` | Aggregator: `recordOutcome()`, `computeStatus()`, `createProviderHealthService()` |
| `apps/api/src/services/market-data/registerProviderHealth.ts` | Fastify plugin: wires `ProviderHealthService` onto `app.providerHealth` |
| `apps/api/src/services/dashboardFreshness.ts` | Enriches `DashboardOverviewHoldingDto[]` with `freshness` + `freshnessTooltip` fields |
| `apps/api/src/services/market-data/providerErrorTrailPurge.ts` | Pure purge function: `DELETE WHERE occurred_at < NOW() - INTERVAL '30 days'` |
| `apps/api/src/lib/providerErrorTrailPurge.ts` | Fastify registration helper: `registerProviderErrorTrailPurge(app)` — 24h `setInterval` + `onClose` cleanup |

Workers wired:
- `apps/api/src/services/market-data/backfillWorker.ts` — calls `app.providerHealth.recordOutcome()` after each `fetchBars`, `fetchDividends`, and `fetchInstrumentMetadata` call
- `apps/api/src/services/market-data/fxRefreshWorker.ts` — calls `app.providerHealth.recordOutcome()` after Frankfurter fetches

### Admin routes

Two new routes in `apps/api/src/routes/adminRoutes.ts`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/providers` | Returns `AdminProvidersResponse` (all 4 provider rows + last 10 trail entries each) |
| `POST` | `/admin/providers/:providerId/rerun` | Dispatches provider-wide refresh; 60s cooldown; writes `provider_health_rerun` audit entry |

Existing `/admin/fx-rates/refresh` is NOT deprecated — it remains the targeted date-range FX refresh path.

### Admin UI (`apps/web`)

| File | Change |
|---|---|
| `apps/web/app/admin/providers/page.tsx` | New server component; fetches `AdminProvidersResponse` via API |
| `apps/web/components/admin/AdminProvidersClient.tsx` | New client component; status badges, error trail, Re-run now button with cooldown UI |
| `apps/web/components/admin/AdminSidebar.tsx` | Added `{ id: "providers", href: "/admin/providers", label: "Providers", icon: Activity }` nav entry |
| `apps/web/components/admin/AdminShell.tsx` | Added `ADMIN_TITLES` entry for `/admin/providers` |
| `apps/web/components/admin/AdminAuditLogClient.tsx` | Added `ACTION_LABELS` + `ACTION_CATEGORIES` for `provider_health_rerun` |

### Holdings badge (`apps/web/components/portfolio/HoldingsTable.tsx`)

- New `showFreshnessBadge?: boolean` prop (default `true`)
- Renders amber or red chip next to price cell when `freshness !== "current"` and `showFreshnessBadge === true`
- Tooltip copies `freshnessTooltip` from DTO verbatim (server-formatted)
- Anonymous share view (`/share/[token]`) passes `showFreshnessBadge={false}`

### Tests

| File | Type |
|---|---|
| `apps/api/test/unit/providerHealth.test.ts` | Unit — `computeStatus`, `recordOutcome` transitions |
| `apps/api/test/unit/providerHealthService.test.ts` | Unit — service factory, worker wiring |
| `apps/api/test/integration/provider-health.integration.test.ts` | Integration — full state machine, FK integrity |
| `apps/api/test/http/specs/provider-health-aaa.http.spec.ts` | HTTP (Playwright) — `GET /admin/providers`, `POST .../rerun` happy path + cooldown |
| `apps/web/tests/e2e/specs-oauth/provider-health-aaa.spec.ts` | E2E (Playwright, OAuth) — admin page + Holdings badge |

Seed endpoint added: `POST /__e2e/seed-provider-health-status` (guarded by `assertE2ESeedEnabled()`).

## Behavioral Deltas

The following are **intentional changes**, not regressions:

### `DashboardOverviewHoldingDto` gains two new required fields

`freshness: "current" | "stale_amber" | "stale_red"` and `freshnessTooltip: string | null` are now always present in the dashboard overview response. All existing consumers (web dashboard, anonymous share DTO path, test fixtures) have been updated.

The anonymous share DTO server-side always sets `freshnessTooltip = null` and the web renders with `showFreshnessBadge={false}` — provider health information is never exposed to unauthenticated viewers.

### `backfillWorker.ts` and `fxRefreshWorker.ts` now call `app.providerHealth.recordOutcome()`

This is a side-effect addition to existing workers. Provider health row writes are fire-and-forget — a health write failure logs at `warn` but does not fail the primary job. The worker behavior (backfill bars, refresh FX rates) is unchanged.

### `dailyRefreshEnqueue.ts` accepts optional `marketFilter?: MarketCode`

`enqueueDailyRefresh()` can now filter `getAllMonitoredTickers()` to a single market before enqueueing. Existing callers that pass no `marketFilter` behave identically to before (full-ticker set enqueued). The `admin_rerun` trigger discriminant is added to `BackfillJobData` but does not change routing or priority.

## New and Renamed Types

| Symbol | Package | Status |
|---|---|---|
| `ProviderHealthStatus` | `@tw-portfolio/shared-types` | New type alias (`"healthy" \| "degraded" \| "down"`) |
| `ProviderErrorClass` | `@tw-portfolio/shared-types` | New type alias (6-value union) |
| `ProviderErrorTrailEntryDto` | `@tw-portfolio/shared-types` | New interface |
| `ProviderHealthStatusDto` | `@tw-portfolio/shared-types` | New interface |
| `AdminProvidersResponse` | `@tw-portfolio/shared-types` | New interface |
| `DashboardOverviewHoldingDto.freshness` | `@tw-portfolio/shared-types` | New required field |
| `DashboardOverviewHoldingDto.freshnessTooltip` | `@tw-portfolio/shared-types` | New required field |
| `ProviderId` | `apps/api/src/services/market-data/providerHealth.ts` | New local union type (not on wire) |
| `ProviderHealthService` | `apps/api/src/services/market-data/providerHealth.ts` | New Fastify interface |

## New Env Vars

None. The feature relies on existing Postgres, Redis, and the KZO-173 trading calendar. No new env vars are required.

## Migration

`046_kzo177_provider_health.sql` — apply before deploying this image.

See runbook §21 for full deploy notes, operational checks, and rollback impact.
