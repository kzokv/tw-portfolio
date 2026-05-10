---
slug: kzo-199
source: scope-grill
created: 2026-05-10
tickets: [KZO-199]
required_reading:
  - docs/004-notes/kzo-199/scope-todo-202605101745-locked.md
  - docs/004-notes/kzo-199/mockup-202605101745-admin-settings-tabs.html
  - docs/004-notes/kzo-199/mockup-202605101745-admin-settings-tabs.png
superseded_by: null
---

# Scope-Todo: KZO-199 — Hybrid env+app_config for Tier B operational constants

> **For agents starting a fresh session:** read every file in `required_reading` before starting implementation. The mockup files capture the locked tab layout for `/admin/settings`.

Locked via `/scope-grill` on 2026-05-10. No formal debate needed — all decisions resolved in interrogation phase.

## Architecture inheritance

This ticket extends the **KZO-198 pattern verbatim** for Tier B operational constants. No new architectural patterns are introduced. All cache, audit-log, bounds, and PATCH-handler infrastructure is reused.

Inherited from KZO-198:
- TTL cache (`apps/api/src/services/appConfig/cache.ts`) with eager pre-warm + onReady hook
- Generation counter for invalidation (`.claude/rules/app-config-cache-coherency.md`)
- PATCH-from-row response derivation
- `bounds.ts` single-source-of-truth for min/max
- `value_change` / `rotation` audit-log discriminator (`metadata.type`)
- Per-feature resolver file convention

## In scope (7 constants)

| # | Constant | Default | Tier | Storage | Currently |
|---|---|---|---|---|---|
| 1 | `ANONYMOUS_SHARE_TOKEN_CAP` | 20 | 1 | app_config column | hardcoded `apps/api/src/lib/anonymousShareToken.ts:26` |
| 2 | `ANONYMOUS_SHARE_RATE_LIMIT_MAX` | 30 | 1 | app_config column | env-var (no override yet) |
| 3 | `ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` | 300_000 | 1 | app_config column | env-var (no override yet) |
| 4 | `ANONYMOUS_SHARE_TOKEN_RETENTION_MS` | 30 days | 2 | app_config column (DB-only, no UI) | hardcoded `apps/api/src/lib/anonymousShareToken.ts:27` |
| 5 | `USER_PREFERENCES_MAX_BYTES` | 8192 | 2 | app_config column (DB-only, no UI) | hardcoded `apps/api/src/routes/registerRoutes.ts:2262` |
| 6 | `POSTGRES_POOL_MAX` | 20 | 3 | env-var only (restart-required) | hardcoded `apps/api/src/persistence/postgres.ts:318` |
| 7 | `BACKFILL_POSTGRES_POOL_MAX` | 2 | 3 | env-var only (restart-required) | hardcoded `apps/api/src/plugins/pgBoss.ts:44` |

### Out of scope (closed)

- **"Max grants per owner" cap** — does not exist in the codebase today. Adding it is a *new feature* and violates KZO-198's "no new architectural patterns" reset. File a separate ticket if desired.
- **FX rate-age staleness threshold** — does not exist in the codebase today. New feature. Out of scope.
- **FX freshness alerting thresholds** — does not exist in the codebase today. New feature. Out of scope.
- **Tier C constants** — already-overridable defaults, timezone offsets. Closed (per KZO-198 lock).
- **Provider API keys** — handled in KZO-198 (Tier 0) directly.
- **Project-wide responsive text-wrap convention** — split to follow-up ticket. KZO-199 fixes only `admin/instruments` and `admin/providers` as starter examples (see UI section below).

## UI scope additions

### 1. Tab restructure of `/admin/settings`

Page now hosts ~20 Tier-1 fields after KZO-198 + KZO-195 (catalog absence) + KZO-197 (yahoo AU rerun) + KZO-133/189 (repair / metadata enrichment) + KZO-199's 3 new sharing fields. Tabs are required for usability.

#### Locked tab structure (5 tabs)

| Tab slug | Tab label | Fields | Source ticket |
|---|---|---|---|
| `rate-limits` | "Rate limits" | market-data price (window, limit), market-data search (window, limit), invite-status (window, limit) | KZO-198 |
| `sharing` | "Sharing" | anonymous-share token cap, anonymous-share rate-limit max, anonymous-share rate-limit window | **KZO-199 (new)** |
| `provider-health` | "Provider health" | down notification suppression, error trail retention, generic rerun cooldown, yahoo-AU rerun cooldown | KZO-198 + KZO-197 |
| `backfill-repair` | "Backfill & repair" | backfill retry limit, backfill retry delay, FinMind 402 retry, repair cooldown minutes | KZO-198 + KZO-133 |
| `catalog-metadata` | "Catalog & metadata" | catalog absence threshold, guard percent, guard floor, metadata enrichment mode | KZO-195 + KZO-189 |

#### Tab implementation

- URL state via `?tab=<slug>` query param. Deep links from runbook docs survive.
- Default tab (no `?tab` query) = `rate-limits`.
- Component: use whichever Tabs primitive the project already leans on (project uses Radix UI in `apps/web/components/ui/`; check `TooltipInfo.tsx` and similar for the existing Radix import path). Implementer to confirm.
- Each tab panel is a single PATCH form (one PATCH per field; the API already supports per-field updates). Existing behavior unchanged.
- Tab-tied error/success toasts remain visible across tab switches (no per-tab state reset).

#### Locked testid strings (per `.claude/rules/agent-team-workflow.md` § "Lock testid strings")

| Element | data-testid |
|---|---|
| Tab list container | `admin-settings-tabs` |
| Tab trigger (per slug) | `admin-settings-tab-{slug}` (e.g. `admin-settings-tab-sharing`) |
| Tab panel (per slug) | `admin-settings-panel-{slug}` |

Existing per-field testids (e.g. `admin-settings-input-marketDataPriceLimit`) stay unchanged. Page-object update for E2E specs is arrange-only — click correct tab before per-field assertions.

### 2. Responsive text-wrap fix on two pages (KZO-199 only)

- **In scope**: `apps/web/components/admin/AdminInstrumentsClient.tsx`, `apps/web/components/admin/AdminProvidersClient.tsx` (and their dual-layout card siblings if applicable per `.claude/rules/responsive-dual-layout-testid-prefixes.md`).
- **Carve-out** (must NOT wrap): ticker codes (`AAPL`, `2330.TW`), provider IDs (`finmind-tw`, `yahoo-finance-au`), instrument UUIDs, ISO timestamps. These stay non-wrapping with `truncate` + `title` attribute (or Radix Tooltip if interactivity is desired).
- **Wrap target columns**: long names, error messages, status descriptions, free-text user inputs.
- **Visual verification**: Validator opens both pages at narrow (375px) and wide (1280px) viewports via the running E2E webServer. Confirm no horizontal scrollbar appears at narrow viewport, opaque IDs truncate cleanly, descriptive columns wrap to next line. Per `.claude/rules/validator-process-hygiene.md` — NO `npm run dev` spawn.
- No testid changes from the wrap fix itself.
- Project-wide convention rule + audit pass = **separate follow-up ticket** (filed at scope-lock).

## Implementation Steps

### Backend — migrations + resolvers

- [ ] **Migration 052** — Add 5 nullable columns to `app_config`:
  - `anonymous_share_token_cap INT NULL`
  - `anonymous_share_rate_limit_max INT NULL`
  - `anonymous_share_rate_limit_window_ms INT NULL`
  - `anonymous_share_token_retention_ms BIGINT NULL`
  - `user_preferences_max_bytes INT NULL`
  - Each column gets a `COMMENT ON COLUMN` documenting its purpose, units, default fallback env-var, and the retention/purge coupling note for `anonymous_share_token_retention_ms` ("must stay ≤ `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS` × 86_400_000 to preserve UI visibility guarantee").

- [ ] **Env schema** — Add 5 entries to `libs/config/src/env-schema.ts` with `.default(...)`:
  - `ANONYMOUS_SHARE_TOKEN_CAP: z.coerce.number().int().positive().default(20)`
  - `ANONYMOUS_SHARE_TOKEN_RETENTION_MS: z.coerce.number().int().positive().default(30 * 24 * 60 * 60 * 1000)`
  - `USER_PREFERENCES_MAX_BYTES: z.coerce.number().int().positive().default(8192)`
  - `POSTGRES_POOL_MAX: z.coerce.number().int().positive().default(20)`
  - `BACKFILL_POSTGRES_POOL_MAX: z.coerce.number().int().positive().default(2)`

- [ ] **env-setup wizard registration** (per `.claude/rules/env-setup-autogen-required-secrets.md`): add all 5 to `libs/config/src/env-metadata.ts`'s `envGroups` (Application section, root + docker-cloud + docker-local). None are sensitive or auto-generatable (skip `sensitiveKeys` / `autoGenerateKeys`). All are integer-only — no shell-quote concern.

- [ ] **`apps/api/src/services/appConfig/sharing.ts`** (new) — Per-feature resolvers:
  - `getEffectiveAnonymousShareTokenCap(): number`
  - `getEffectiveAnonymousShareTokenRetentionMs(): number`
  - `getEffectiveAnonymousShareRateLimitMax(): number`
  - `getEffectiveAnonymousShareRateLimitWindowMs(): number`
  - Pattern: `getAppConfigCacheEntry()?.<col> ?? Env.<VAR>`. Mirror `apps/api/src/services/appConfig/sse.ts:12`.

- [ ] **`apps/api/src/services/appConfig/requestLimits.ts`** (new) — Single-field resolver:
  - `getEffectiveUserPreferencesMaxBytes(): number`
  - Generic name reserved for future per-route body caps.

- [ ] **Bounds** — Append to `apps/api/src/services/appConfig/bounds.ts`:
  ```ts
  // KZO-199 — Tier 1 sharing knobs (in PATCH schema, in UI)
  anonymousShareTokenCap: { min: 1, max: 1_000 },
  anonymousShareRateLimitMax: { min: 1, max: 10_000 },
  anonymousShareRateLimitWindowMs: { min: 1_000, max: 600_000 },
  // KZO-199 — Tier 2 (NOT in PATCH schema, NOT in UI; documented for column comment)
  anonymousShareTokenRetentionMs: { min: 24 * 60 * 60 * 1000, max: 365 * 24 * 60 * 60 * 1000 },
  userPreferencesMaxBytes: { min: 256, max: 1_048_576 },
  ```

- [ ] **Call-site swaps**:
  - `apps/api/src/lib/anonymousShareToken.ts` — remove the constants `ANONYMOUS_SHARE_TOKEN_CAP` and `ANONYMOUS_SHARE_TOKEN_RETENTION_MS`. Replace every usage in `apps/api/src/persistence/postgres.ts:1494,1553` and `apps/api/src/persistence/memory.ts:887,919` with the corresponding resolver call (read at method invocation time).
  - `apps/api/src/routes/registerRoutes.ts:2262,2317,2321` — remove the local `USER_PREFERENCES_MAX_BYTES` constant. Set the Fastify route's `bodyLimit` to `APP_CONFIG_BOUNDS.userPreferencesMaxBytes.max` (1 MiB hard ceiling). Replace the inline `if (rawBytes > USER_PREFERENCES_MAX_BYTES)` check with `if (rawBytes > getEffectiveUserPreferencesMaxBytes())`. Mirrors KZO-198's "schedule static, parameter live" pattern (`.claude/rules/fastify-eviction-lifecycle-pattern.md`).
  - `apps/api/src/lib/anonymousShareRateLimit.ts` — eviction sweep cadence stays env-default; per-request check reads `getEffectiveAnonymousShareRateLimitMax()` and `getEffectiveAnonymousShareRateLimitWindowMs()` live (matches `marketDataPriceRateLimit.ts` post-KZO-198).
  - `apps/api/src/persistence/postgres.ts:318` — `max: 20` → `max: Env.POSTGRES_POOL_MAX`.
  - `apps/api/src/plugins/pgBoss.ts:44` — `max: 2` → `max: Env.BACKFILL_POSTGRES_POOL_MAX`.

### Backend — admin route + DTO + audit log

- [ ] **`apps/api/src/routes/adminRoutes.ts` PATCH `/admin/settings`** — Add the 3 Tier-1 fields to the Zod schema. Use `APP_CONFIG_BOUNDS` for min/max. **Do NOT add the 2 Tier-2 fields** (`anonymous_share_token_retention_ms`, `user_preferences_max_bytes`) — they stay DB-SQL-only per the KZO-198 precedent.

- [ ] **`AppConfigDto`** — Surface the 3 Tier-1 fields (`effectiveX` from resolver-derived row; `rawX` raw DB value or null). Mirror existing fields like `marketDataPriceLimit`. Bound metadata read from `bounds.ts`.

- [ ] **Audit log** — `app_config_updated` action with `metadata.type: 'value_change'` and `{ field, before, after }`. Inherits KZO-198's discriminator schema. No migration delta to audit log.

- [ ] **Cache** — No new file changes. The 5 new columns slot into the existing `AppConfigRow` row shape and `getAppConfig()` SELECT. Generation counter + PATCH-from-row already in place.

### Frontend — admin/settings tabs

- [ ] **Tab component + URL sync**:
  - Open `/admin/settings/page.tsx` (or `AdminSettingsClient.tsx` if client-component). Wrap the existing field groups in a Tabs component.
  - URL sync via `useSearchParams` + `router.replace` on tab change. Default tab `rate-limits`.
  - Locked testids: `admin-settings-tabs`, `admin-settings-tab-{slug}`, `admin-settings-panel-{slug}` for the 5 slugs above. Per-field testids unchanged.
  - i18n: tab labels go in the existing `apps/web/features/admin/i18n.ts` (or wherever admin settings dict lives) as flat strings under `dict.admin.settings.tabs` — comply with `.claude/rules/i18n-flat-record-dict-settings.md` (flat `Record<string,string>`, NO nested objects).

- [ ] **3 new Tier-1 form fields** in the Sharing tab, bound to `bounds.ts` min/max for HTML `min`/`max` attributes. Mirror the existing rate-limit field renderers.

### Frontend — responsive wrap fix

- [ ] **`apps/web/components/admin/AdminInstrumentsClient.tsx`**:
  - Replace any `overflow-x-auto` / `whitespace-nowrap` on cells/rows that hold descriptive text (instrument name, status messages).
  - Keep `truncate` + `title=` on ticker, market_code, instrument_id columns.
  - Test at 375px viewport: no horizontal scrollbar, descriptive cells wrap.

- [ ] **`apps/web/components/admin/AdminProvidersClient.tsx`** (and `ProviderCard.tsx` if present per `responsive-dual-layout-testid-prefixes.md`):
  - Same treatment. Provider IDs, last-success timestamps stay non-wrapping. Error trail messages and status descriptions wrap.

### Tests

- [ ] **Migration round-trip** — apply migration 052 → rollback → re-apply on test Postgres (`apps/api/test/integration/migrations.integration.test.ts` pattern).

- [ ] **Resolver unit tests** — `apps/api/test/unit/appConfig/sharing.test.ts`, `apps/api/test/unit/appConfig/requestLimits.test.ts`. Three paths per resolver: env-only (column NULL), app_config-set (column non-NULL), app_config-empty-cache (env-fallback). Use the `mockEnv` Proxy pattern from `.claude/rules/vitest-config-patterns.md` if needed.

- [ ] **HTTP test for PATCH** — `apps/api/test/http/specs/admin-settings-aaa.http.spec.ts` extension. Cover the 3 new Tier-1 fields. Bound enforcement (reject `anonymousShareTokenCap = 0` and `= 1001`). Audit-log entry with `metadata.type: 'value_change'`. Per `.claude/rules/service-error-pattern.md` — assert on `body.error`, not `body.code`.

- [ ] **Tier-2 field DB-only path** — Postgres integration test that sets `app_config.anonymous_share_token_retention_ms` directly via SQL, then calls `listAnonymousShareTokensForOwner` and asserts the retention filter uses the override. Per `.claude/rules/integration-test-persistence-direct.md` — use `PostgresPersistence` directly, not `buildApp`.

- [ ] **E2E representative knob** — extend the existing admin-settings AAA spec (Suite 7) to drive the new Sharing tab: navigate to `?tab=sharing`, change `anonymousShareTokenCap` to 1, save, then attempt to create 2 anonymous share tokens via `POST /share-tokens` and assert the second returns the cap-exceeded response. Verify visual tab switching works.

- [ ] **Pool-size unit tests** — assert `PostgresPersistence` constructor reads `Env.POSTGRES_POOL_MAX` and `pgBoss.ts` reads `Env.BACKFILL_POSTGRES_POOL_MAX`. No integration test for pool sizes (constructor-only, no live tunability).

- [ ] **Regression** — confirm KZO-198 / KZO-195 / KZO-197 / KZO-133 / KZO-189 fields still resolve correctly after the 5 new columns and the tab restructure (existing test suites should pass; if any break, the testid drift is in tab-arrange, not the field assertions).

### Visual verification (Validator at Tier 2/3)

- [ ] Open `/admin/settings` at 375px and 1280px viewports via the running E2E webServer. Confirm:
  - 5 tabs render, default is `rate-limits`, URL `?tab=...` syncs on click
  - Each tab shows its expected field count (3, 3, 4, 4, 4)
  - No horizontal scrollbar at 375px — tab list collapses gracefully (acceptable: scroll-snap row of tab triggers, NOT page-level horizontal scroll)
- [ ] Open `/admin/instruments` at 375px and 1280px. Confirm no horizontal scrollbar; long names wrap; ticker codes truncate with tooltip.
- [ ] Open `/admin/providers` at 375px and 1280px. Same checks; provider IDs truncate, status descriptions wrap.
- [ ] **NO `npm run dev`** spawn — use the running test webServer. Per `.claude/rules/validator-process-hygiene.md`.

### Doc deliverables (Wave 2)

- [ ] **Transition note** at `docs/004-notes/kzo-199/transition-{YYYYMMDDHHmm}-tier-b-app-config.md` — KZO-198 follow-up scope, the 5 new columns, the 5 new env vars, the `/admin/settings` tab restructure, the carve-out for the responsive convention.
- [ ] **Update `docs/002-operations/runbook.md`** — Sharing tab description, anonymous-share token cap as a runtime lever, retention as a SQL-only escape hatch, pool-size restart-required tuning. Replace any stale "follow-up candidate" note from KZO-198 if present (per `.claude/rules/doc-stale-forward-notes.md`).
- [ ] **PR description draft** at `.worklog/team/pr-description-draft.md` — per `.claude/rules/pr-bound-docs-review-compliance.md`. Required sections: `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block), `## Risk/Rollback`. Renamed-types table for any signature changes (none expected; resolvers are net-new).

### Final

- [ ] Run `/aaa` to add or update E2E tests covering: admin-settings tab navigation + Sharing tab anonymous-share-token cap knob.

## Open Items

- [ ] **Follow-up ticket — Project-wide responsive text-wrap convention** — to be filed against project "International Markets — US & AU Expansion" (or the appropriate UX project) at scope-lock time. Title suggestion: "Responsive text-wrap convention across admin + portfolio pages." References KZO-199's two-page fix as the canonical example. Out of scope: opaque IDs (must stay non-wrapping with truncate+tooltip).

## References

- Linear ticket: KZO-199
- Mockup HTML: `docs/004-notes/kzo-199/mockup-202605101745-admin-settings-tabs.html`
- Mockup screenshot: `docs/004-notes/kzo-199/mockup-202605101745-admin-settings-tabs.png`
- Precedent — Tier A: KZO-198 (`docs/004-notes/kzo-198/scope-todo-202605071600-initial.md`)
- Precedent — original two-resolver pattern: KZO-133, KZO-189
- Audit source: KZO-194 follow-up
- Inherited rules: `.claude/rules/agent-team-workflow.md`, `.claude/rules/app-config-cache-coherency.md`, `.claude/rules/fastify-app-config-bootstrap.md`, `.claude/rules/fastify-eviction-lifecycle-pattern.md`, `.claude/rules/env-setup-autogen-required-secrets.md`, `.claude/rules/i18n-flat-record-dict-settings.md`, `.claude/rules/responsive-dual-layout-testid-prefixes.md`, `.claude/rules/validator-process-hygiene.md`, `.claude/rules/integration-test-persistence-direct.md`, `.claude/rules/service-error-pattern.md`, `.claude/rules/pr-bound-docs-review-compliance.md`, `.claude/rules/doc-stale-forward-notes.md`.
