---
slug: kzo-197
source: scope-grill
created: 2026-05-09
tickets: [KZO-197]
required_reading: []
superseded_by: docs/004-notes/kzo-197/scope-todo-202606031320-provider-fixer-kr-binding.md
---

# Todo: KZO-197 — AU catalog-bootstrap orphan: provider-health "down" symptom on fresh deploy

> **For agents starting a fresh session:** read the mockup at `docs/004-notes/kzo-197/mockup-202605091500-provider-badges.html` and the related architecture doc `docs/001-architecture/web-frontend.md` § build-time vs runtime variables. Re-read `apps/api/src/services/market-data/providerHealth.ts`, `apps/api/src/services/market-data/dailyRefreshEnqueue.ts`, `apps/api/src/routes/adminRoutes.ts:813-940`, and `apps/api/src/persistence/postgres.ts:6758-6793` (`getAllMonitoredTickers`).

## Summary of locked decisions

1. **AU's "Re-run now" gets per-provider semantics** — does a **union** of (a) catalog warm-up over `bars_backfill_status IN ('pending','failed') AND market_code='AU' AND delisted_at IS NULL`, and (b) the existing monitored-AU refresh via `enqueueDailyRefresh`. Sets are disjoint by definition.
2. **Backfill window for the catalog warm-up = full history.** Producer omits `startDate`; worker uses `historyStartFor("AU") = 1988-01-28`. Yahoo serves per-ticker truncation natively. ~23M-row write on first cold-start click.
3. **Per-provider rerun cooldown** via new resolver `getEffectiveProviderRerunCooldownMs(providerId)`. Yahoo market providers default to 30 min via new `app_config.yahoo_au_rerun_cooldown_ms BIGINT` column (one column per provider, no JSONB). Other providers fall back to existing global 60 s.
4. **`awaiting` status — derived at admin-route read layer, NOT a DB enum value.** `(last_successful_run IS NULL AND last_failed_run IS NULL) ? 'awaiting' : row.status` per provider. Persistence + DB CHECK constraint unchanged. Internal callers (`recordOutcome` CAS) keep reading the raw row.
5. **Status DTO widens** to `'healthy'|'degraded'|'down'|'awaiting'` in `libs/shared-types`. Admin Providers tab gets a new neutral-grey badge "Awaiting first run".
9. **Per-provider "Re-run now" tooltip** — one info-icon (`TooltipInfo`) per provider row, explaining what the button does for that provider. Copy below.
6. **Audit metadata** — for Yahoo market reruns (`yahoo-finance-au` and the KR resolver extension), append nested `{ catalogBackfill: { tickerCount, jobId }, monitoredRefresh: { tickerCount, jobId } }` to the `provider_health_rerun` action. Top-level `tickerCount` = sum (back-compat). Non-Yahoo providers' shape unchanged.
7. **Memory-backend behavior preserved** — `app.boss === null` skips dispatch in both new branches but still stamps cooldown + audit. `tickerCount=0`, `jobId=null`.
8. **Reserved E2E ticker prefix:** `AUWARM01–AUWARM10`. Update `e2e-shared-memory-bars-ticker-hygiene.md` rule in same PR.

## Out of scope / explicit deferrals

- Auto-trigger warm-up post-deploy → **KZO-203**.
- TW/US/other-provider rerun cooldown overrides → **KZO-204**.
- `failed_count` retry cap on permanently-bad rows → **KZO-205**.
- `'warmed'` / partial-history state distinct from `'ready'` (would require schema change + worker logic).
- Documentation surface for `docs/001-architecture/` (KZO-177 already covers status mechanics; `awaiting` is a UI/DTO concern).

## Implementation Steps

### Schema + persistence

- [x] Add migration for `app_config.yahoo_au_rerun_cooldown_ms BIGINT` (default `1800000` = 30 min). Per `migration-strategy.md`: NEW migration file (do not amend any merged migration).
- [x] Update `app_config` Zod schema and types in `libs/config` and `apps/api/src/services/appConfig/` to expose the new column.
- [x] Audit `appConfig` cache pre-warm pattern per `fastify-app-config-bootstrap.md` (eager pre-warm before any consumer; resolver gates on the cached value).
- [x] Add resolver `getEffectiveYahooAuRerunCooldownMs()` in `apps/api/src/services/appConfig/providerHealth.ts` (or sibling).

### API — backfill helper + route

- [x] Add `enqueueAuCatalogBarsBackfill(boss, persistence, log, { trigger })` helper in `apps/api/src/services/market-data/`. Reads `instruments` directly with the locked filter (`market_code='AU' AND bars_backfill_status IN ('pending','failed') AND delisted_at IS NULL`). Producer **omits** `startDate` so worker resolves to `historyStartFor("AU")`. Composite singleton key `${ticker}:AU` per `pgboss-composite-singleton-key.md`.
- [x] Define `getEffectiveProviderRerunCooldownMs(providerId)` (resolver + branch).
- [x] Update `POST /admin/providers/:providerId/rerun` in `adminRoutes.ts`:
  - [x] Read cooldown via the new per-provider resolver.
  - [x] In the `yahoo-finance-au` branch (or new branch alongside the existing `else`): call `enqueueAuCatalogBarsBackfill` AND `enqueueDailyRefresh({ marketFilter: 'AU', trigger: 'admin_rerun' })`. Combine `tickerCount`s; preserve back-compat `tickerCount` field at top level.
  - [x] Audit metadata: append nested `catalogBackfill` + `monitoredRefresh` blocks for Yahoo market providers.
- [x] Update `GET /admin/providers` route to derive `'awaiting'` per provider where `last_successful_run IS NULL AND last_failed_run IS NULL`. **Do not** modify the persistence row shape.
- [x] Update `GET /admin/providers` route to populate a new `rerunCooldownMs: number` field per provider, sourced from `getEffectiveProviderRerunCooldownMs(providerId)`. Keeps the UI tooltip coherent with the live `app_config` value without exposing the resolver to the client.

### Persistence interface

- [x] Add `listAuCatalogBarsBackfillCandidates()` (or extend an existing query method) to `Persistence` interface — returns `(ticker, marketCode)[]` for the eligibility filter. Postgres + memory implementations.
  - **Memory-backend dual-store mirror** per `test-placement-persistence-backend.md`: if a separate `_auInstrumentMemRows` (or similar) exists, mirror unconditionally on every `_seedInstrument` write.

### Shared types + frontend

- [x] Widen `ProviderHealthStatusDto.status` (or equivalent) in `libs/shared-types` to include `'awaiting'`.
- [x] Add `rerunCooldownMs: number` to `ProviderHealthStatusDto` in `libs/shared-types`. Required field; route always populates it from the per-provider resolver.
- [x] Per `shared-types-barrel-turbopack.md`: re-audit `libs/shared-types/src/index.ts` `export *` statements when this change adds the new status string. If the type-only barrel already had a runtime export (it does post-KZO-159), no Turbopack regression risk; verify.
- [x] Update `apps/web/components/admin/AdminProvidersClient.tsx` `StatusBadge` to render the 4th state. Tailwind: `bg-slate-100 text-slate-700 ring-1 ring-slate-200` chip; `bg-slate-400` dot. Label sourced from i18n dict.
- [x] i18n dict: add `statusAwaiting: "Awaiting first run"` (or per the locked architect-design.md string) to `apps/web/components/admin/i18n.ts` (or wherever `t.statusHealthy` lives). Per `i18n-flat-record-dict-settings.md`: keep flat `Record<string, string>` — do NOT nest under a sub-key consumed via runtime indexed access.
- [x] **Per-provider tooltip on the "Re-run now" affordance.** Reuse `apps/web/components/ui/TooltipInfo.tsx` (Radix-based, already used in `TopBar` + `AddTransactionCard`). Render one info icon adjacent to each provider's row label (desktop) and card header (mobile).
  - [x] Implemented on top of `TooltipInfo` with provider-name popover buttons (desktop + mobile).

  - **Cooldown values are NOT hardcoded into the tooltip strings.** Tooltip copy uses a `{cooldown}` placeholder; the component interpolates the formatted live cooldown at render time. Same pattern as the existing `rerunCooldownLabel: "Retry in {seconds}s"` (`AdminProvidersClient.tsx:23`).
  - **Source of cooldown value for the UI:** `ProviderHealthStatusDto` (returned by `GET /admin/providers`) gains a new field `rerunCooldownMs: number` per provider. The route reads it via the SAME resolver the route's gate uses — `getEffectiveProviderRerunCooldownMs(providerId)` — so DB ⇄ UI stay coherent under live `app_config` changes. **Do not** call the resolver from the client; the value travels in the DTO.
  - **Formatter helper** (web side, e.g. `formatCooldownLabel(ms: number): string`): renders ms as `"60s"` for ≤120 000 ms, `"N min"` (rounded) for ≥120 000 ms. Unit-test placement under `apps/web/test/`.
  - **Tooltip dict entries** (placeholder-templated, flat `Record<string, string>` per `i18n-flat-record-dict-settings.md`):
    - `rerunTooltipFinmindTw`: "Refreshes daily bars + dividends for monitored TW tickers via FinMind. Cooldown {cooldown}."
    - `rerunTooltipFinmindUs`: "Refreshes daily bars + dividends for monitored US tickers via FinMind. Cooldown {cooldown}."
    - `rerunTooltipYahooFinanceAu`: "Warms uncached AU catalog rows AND refreshes monitored AU tickers via Yahoo Finance. Fresh deploys process ~2,400 jobs over ~40 min. Cooldown {cooldown}."
    - `rerunTooltipTwelveDataAu`: "Re-syncs the AU instrument universe via Twelve Data (catalog metadata only — no bars). Cooldown {cooldown}."
    - `rerunTooltipYahooFinanceKr`: "Warms pending or failed KR bar backfills AND refreshes monitored KR tickers via Yahoo Finance. Quote-first is the safe default; chart_probe_v1 requires acknowledgement. Cooldown {cooldown}."
    - `rerunTooltipTwelveDataKr`: "Re-syncs the KR instrument universe via Twelve Data (catalog metadata only — no bars). Cooldown {cooldown}."
    - `rerunTooltipFrankfurter`: "Refreshes today's FX rates from Frankfurter (ECB-backed). Cooldown {cooldown}."
    - `rerunTooltipAsxGicsCsv`: "Re-runs ASX GICS sector + industry-group enrichment from the S&P/ASX CSV. Cooldown {cooldown}."
  - **Render call:** `dict.adminProviders[\`rerunTooltip\${pascalCase(providerId)}\`].replace("{cooldown}", formatCooldownLabel(provider.rerunCooldownMs))`.
  - **Why-not-server-formatted:** keep the i18n string + interpolation on the client so the format follows the user's locale (future-proof for i18n; today both formats render identically). Server only ships the raw ms.
  - **Test (integration):** override `app_config.yahoo_au_rerun_cooldown_ms` to a different value, hit `GET /admin/providers`, assert the AU row's `rerunCooldownMs` reflects the override (and TW/US still report the global default).
  - **Test (E2E):** seeded admin Providers page → tooltip text contains the formatted cooldown value matching the provider's resolved cooldown.

### Architect-locked testid strings (Phase 0)

- [x] List in architect-design.md, per `agent-team-workflow.md` "Lock testid strings in `architect-design.md` at Phase 0":
  - `provider-status-badge-{id}` (existing) — renders 4 states; no new testid.
  - `provider-status-badge-{id}` (existing) — mobile card variant uses the same testid because DataTable renders one DOM variant at a time.
  - **Current implementation:** `provider-help-trigger-{id}` — info popover trigger next to provider name (desktop row).
  - **Current implementation:** `provider-help-trigger-{id}` — mobile card trigger uses the same testid because DataTable renders one DOM variant at a time.
  - **Current implementation:** `provider-help-popover-{id}` — tooltip content panel (desktop).
  - **Current implementation:** `provider-help-popover-{id}` — tooltip content panel (mobile card) uses the same testid because DataTable renders one DOM variant at a time.

### Tests

- [x] **Unit (apps/api):** new tests for `enqueueAuCatalogBarsBackfill` covering filter, full-history start, composite singleton key, memory-backend no-op (returns `{ tickerCount: 0, batchId: null }` when `boss` falsy).
- [x] **Unit (apps/api):** `getEffectiveProviderRerunCooldownMs(providerId)` — AU returns 30 min default + DB override; other providers return global 60 s default.
- [x] **Integration (Postgres-backed, `describePostgres`)** in `apps/api/test/integration/`:
  - [x] Seed 5 AU rows in `pending`, click rerun → 5 catalog jobs + 0 monitored.
  - [x] Promote 2 to `ready`, add to `user_monitored_tickers` → re-click after cooldown → 3 catalog + 2 monitored.
  - [x] Cooldown gate: AU 30 min vs TW/US 60 s.
  - [x] `app_config.yahoo_au_rerun_cooldown_ms` override is read by the route.
  - [x] Per `integration-test-persistence-direct.md`: use `PostgresPersistence` directly, not `buildApp({ persistenceBackend: 'postgres' })`. Seed admin actor user before any path that writes to `audit_log`.
  - [x] Per `integration-test-persistence-direct.md` schema-qualified table names: every raw INSERT/SELECT against `instruments` uses `market_data.instruments`.
  - [x] Per `integration-test-persistence-direct.md` `ON CONFLICT DO UPDATE`: any seed row whose PK could collide with `init()` pre-seeded rows must `DO UPDATE` (KZO-185 lesson) when asserting on non-PK columns like `bars_backfill_status`.
- [x] **HTTP (apps/api/test/http):** AAA spec for `POST /admin/providers/yahoo-finance-au/rerun` returning the new audit metadata shape.
- [x] **E2E (apps/web/tests/e2e):**
  - [x] Extend (or add) `specs-oauth/admin-providers-aaa.spec.ts` — fresh-deploy state shows "Awaiting first run" for AU; click "Re-run now" → button reflects warm-up; tickerCount > 0 in audit-log spec; tooltip-trigger renders for every provider; hovering it surfaces the locked copy.
  - [x] Reserve `AUWARM*` prefix; verify uniqueness via the grep recipe in `e2e-shared-memory-bars-ticker-hygiene.md`.
  - [x] Update the rule's "Currently-reserved tickers" section in the same PR.
- [x] Per `code-review-before-pr.md` typecheck-scope check: any new test directory must be in a typecheck'd tsconfig; verify `apps/api/test/tsconfig.json` covers the new files (if integration tests land outside `http/**`, extend `include`).

### Documentation (Wave 2)

- [x] **`docs/002-operations/runbook.md`** — append "AU fresh-deploy warm-up" subsection covering: operator clicks `yahoo-finance-au` "Re-run now"; ~2,400 backfill jobs over ~40 min at 60/min Yahoo budget; 30-min cooldown protects against re-clicks; `Awaiting first run` badge during the gap.
- [x] **Transition note** at `docs/004-notes/kzo-197/transition-{datetime}-warm-up-and-awaiting.md` — frozen snapshot covering: schema additions (cooldown column), behavioral deltas (AU button is now a union), the explicit "still operator-initiated, NOT auto-triggered" decision, link to KZO-203/204/205 follow-ups.

### Review closure — 2026-06-03

- [x] KR resolver repair mode has server-side guardrails: `chart_probe_v1` requires explicit `resolverModeRiskAccepted=true`; resolver-mode payloads are rejected for non-KR providers.
- [x] KR admin rerun defaults to explicit `quote_first` when no resolver mode is supplied; the UI no longer exposes a risky "server default" escape hatch.
- [x] Catalog warm-up log names are market-neutral so KR reruns no longer emit AU-named operational events.
- [x] Modified KR provider unit test is included in API test typecheck coverage.

### Pre-PR gates

- [ ] Run `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full` per `full-test-suite.md`.
- [ ] Verify `lsof -i :4000 -i :3333 -i :4445 -i :4099` is clean before re-running on suite failure (per `validator-process-hygiene.md`).
- [ ] Run `/aaa` to add or update E2E tests covering the new admin button union path + the `awaiting` badge.
- [ ] Run `/code-reviewer` per `code-review-before-pr.md` before opening the PR.
- [ ] **PR description** per `git-pr-flow.md §3-4` shape (`## Problem`, `## Solution`, `## Testing` with `Evidence:` block, `## Risk/Rollback`) per `pr-bound-docs-review-compliance.md`. Surface intentional behavioral deltas.

## Open Items (tracked elsewhere)

- [ ] **KZO-203** — Auto-trigger AU catalog warm-up post-deploy. Re-evaluates Option B from KZO-197.
- [ ] **KZO-204** — Per-provider rerun cooldown overrides for TW / US / Frankfurter.
- [ ] **KZO-205** — Cap repeated retries on permanently-failed bars-backfill rows (`failed_count` or debounce).

## References

- Linear ticket: KZO-197
- Linear follow-ups: KZO-203, KZO-204, KZO-205
- Mockup: `docs/004-notes/kzo-197/mockup-202605091500-provider-badges.html`
- Provider-health framework: `apps/api/src/services/market-data/providerHealth.ts` (KZO-177)
- Backfill worker: `apps/api/src/services/market-data/backfillWorker.ts` (KZO-185)
- Daily-refresh enqueue: `apps/api/src/services/market-data/dailyRefreshEnqueue.ts`
- Admin re-run route: `apps/api/src/routes/adminRoutes.ts:813-940`
- Admin Providers tab: `apps/web/components/admin/AdminProvidersClient.tsx`
- Migration file precedent: `db/migrations/046_kzo177_provider_health.sql`
