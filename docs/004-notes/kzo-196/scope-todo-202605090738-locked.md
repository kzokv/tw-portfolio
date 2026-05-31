---
slug: kzo-196
source: scope-grill
created: 2026-05-09
tickets: [KZO-196]
required_reading: []
superseded_by: null
---

# Todo: KZO-196 — AU sector / GICS enrichment

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. This scope-todo is the canonical source for locked decisions.

## Implementation Steps

### Migration & schema

- [ ] **Create migration `db/migrations/050_kzo196_gics_industry_group.sql`** with three statements:
  1. `ALTER TABLE market_data.instruments ADD COLUMN gics_industry_group TEXT;`
  2. `CREATE INDEX IF NOT EXISTS idx_instruments_gics_industry_group ON market_data.instruments(market_code, gics_industry_group) WHERE gics_industry_group IS NOT NULL;`
  3. `UPDATE market_data.instruments SET industry_category_raw = NULL WHERE market_code = 'AU';` (cleanup of KZO-194's misuse of the field for TD `type`)
- [ ] No CHECK constraint on `gics_industry_group` (matches `type_raw` precedent — UI bucketizes unknowns).
- [ ] No CHECK constraint linking `gics_industry_group` to `market_code` (column may legitimately carry GICS for TW/US once EODHD lands).

### Static GICS map (shared-types)

- [ ] **GICS map in shared-types** exporting:
  - `gicsSectors`: ordered array of 11 GICS sector display names + i18n keys
  - `gicsIndustryGroups`: ordered array of 25 industry-group entries `{ industryGroup, sector, displayKey }` covering the full post-2023 GICS taxonomy
  - `sectorForIndustryGroup(industryGroup): sector | null` lookup
  - `industryGroupsForSector(sector): industryGroup[]` inverse lookup
- [ ] **Phase 4 deviation (ratified 2026-05-09):** content **inlined into `libs/shared-types/src/index.ts`** rather than living in a separate `gics.ts` file. Reason: Next.js webpack/Turbopack cannot resolve `./gics.js` relative imports without `extensionAlias` config when `apps/web/tsconfig.json` aliases `@tw-portfolio/shared-types` to direct source. Inline avoids the resolution issue without a Next.js config change. KZO-202 (follow-up) tracks the proper extraction once `extensionAlias` lands or a dist-build path is wired. Existing rule `shared-types-barrel-turbopack.md` covers the inverse direction (adding runtime to type-only barrel) — rule update in Wave 2 docs to cover the relative-runtime-re-export case.
- [ ] **Unit test `libs/shared-types/test/gics.test.ts`**: every industry-group has a sector parent in the 11-sector list; sector→industry-groups inverse mapping is exhaustive.

### Provider — ASX GICS catalog

- [ ] **Create `apps/api/src/services/market-data/providers/asxGicsCatalog.ts`** with:
  - `interface AsxGicsProvider { readonly providerId: 'asx-gics-csv'; fetchGicsCatalog(): Promise<RawAsxGicsRow[]>; }`
  - `type RawAsxGicsRow = { ticker: string; companyName: string; gicsIndustryGroup: string }`
  - `class AsxGicsCatalogProvider implements AsxGicsProvider` — fetches from `https://www.asx.com.au/asx/research/ASXListedCompanies.csv`
  - Use `csv-parse` (verify in dep tree; add if missing); do not hand-roll string splitting
  - Locate columns by header name (case-insensitive); throw `AsxGicsParseError` with `{ columnName }` if `GICS industry group` column missing
  - 30s HTTP timeout
  - Throw typed `AsxGicsFetchError` for HTTP/network failures
- [ ] **Create `apps/api/src/services/market-data/providers/mockAsxGicsCatalog.ts`** returning a fixed 10-row inline array mixing ≥3 sectors + 1 ASX-only ticker not present in seeded TD catalog.

### CSV parser test fixture

- [ ] **Create `apps/api/test/fixtures/asx-listed-companies.sample.csv`** with ~20 rows in actual ASX CSV format. Top-of-file comment names source URL (`https://www.asx.com.au/asx/research/ASXListedCompanies.csv`) + sample-only intent. Synthesize rows from the published column structure rather than copying real listings if you want belt-and-suspenders on ToS.
- [ ] **Unit test `apps/api/test/unit/asxGicsCsvParser.test.ts`** — happy path, missing column failure, BOM handling, CRLF handling, embedded-comma quoting.

### Worker + queue

- [ ] **Create pg-boss worker at `apps/api/src/services/market-data/asxGicsSyncWorker.ts`** with:
  - Constant singleton key (`asx-gics-sync` — global, not per-ticker)
  - Reads provider via injected `AsxGicsProvider`
  - Fetches CSV → parses → builds row map keyed by `(ticker, 'AU')`
  - `UPDATE market_data.instruments SET gics_industry_group = $1, updated_at = CURRENT_TIMESTAMP WHERE ticker = $2 AND market_code = 'AU' AND gics_industry_group IS DISTINCT FROM $1` per row
  - Per-batch transactions, ~500 rows/tx
  - Emit `gics_sync_started`, `gics_sync_completed { rowsUpdated, rowsUnchanged, rowsUnmatchedAsx, rowsMissingFromCsv, durationMs }`, `gics_sync_failed { stage, err }`
  - Per-ticker `unmatched_asx_ticker { ticker }` log only when total ≤ 50; one summary line otherwise
  - Sanity bounds: warn at <1000 or >5000 parsed rows; do not abort
  - Update provider-health row `asx-gics-csv` after each run (status / last_sync_at / last_error_message)
- [ ] **NEVER INSERT** rows from the CSV. Enrichment-only against existing `(ticker, market_code='AU')` rows.
- [ ] **Leave-stale on absence**: tickers in DB but absent from current CSV keep their prior `gics_industry_group` value.
- [ ] Re-throw any `RateLimitedError` (defensive — provider does not throw it today, but any future upstream change must not silently swallow per `.claude/rules/typed-transient-error-catch-audit.md`).

### Cron registration & app_config Tier A

- [ ] **Add env var `ASX_GICS_REFRESH_CRON`** to `libs/config/src/env-schema.ts` with default `'0 2 * * 0'`. Use cron-string regex validation.
- [ ] Wire env-setup wizard registration in `libs/config/src/env-metadata.ts` — appears in the wizard's relevant section (NOT in `autoGenerateKeys` since it isn't a secret).
- [ ] **Apply `shellQuoteEnvValue()`** in `scripts/env-setup/` per `.claude/rules/env-setup-autogen-required-secrets.md` — cron string contains spaces.
- [ ] **App config Tier A column** (extend `app_config` table per KZO-198 pattern) with optional `asx_gics_refresh_cron TEXT` override.
- [ ] **Resolver `getEffectiveAsxGicsRefreshCron()`** in `apps/api/src/services/appConfig/` — DB override, env fallback, plain-text return.
- [ ] **Wire into `buildApp()` per `.claude/rules/fastify-app-config-bootstrap.md`**:
  1. Eager pre-warm BEFORE pg-boss queue registration (`await refresh()`)
  2. `app.addHook("onReady", ...)` defensive idempotent re-warm — NOT `app.ready(callback)` (FST_ERR_INSTANCE_ALREADY_LISTENING trap)
  3. Pg-boss queue uses `getEffectiveAsxGicsRefreshCron()` resolver, not env-only

### Cache coherency (per `.claude/rules/app-config-cache-coherency.md`)

- [ ] If admin endpoint exposes a PATCH for `asx_gics_refresh_cron`:
  - Generation counter on the cache state
  - PATCH response derived from post-write row, not from cache
  - Eager pre-warm guard

### Operator controls — admin /providers run-now

- [ ] **Add row `asx-gics-csv`** to admin /providers page (existing surface from KZO-177).
- [ ] **"Run GICS sync now" button** enqueues the same singleton-keyed pg-boss job (NOT a separate code path). Concurrent clicks coalesce.
- [ ] Permission gate: admin-only.
- [ ] **Responsive dual-layout testid prefixes** per `.claude/rules/responsive-dual-layout-testid-prefixes.md` — table row + mobile card variant get distinct testids (e.g. `provider-rerun-btn-asx-gics-csv` vs `provider-rerun-btn-card-asx-gics-csv`).

### TwelveDataAuCatalogProvider write-path cleanup

- [ ] **Edit `apps/api/src/services/market-data/providers/twelveDataAu.ts:fetchInstrumentCatalog`** — stop populating `industryCategory: row.type`. Set to empty string (or `null` if the upstream type permits — confirm `RawInstrumentInfo.industryCategory: string` shape; may need optional widening).
- [ ] If the type widening is risky, leave the field empty-string and rely on the migration's NULL cleanup + the persistence COALESCE behavior to reach the desired end-state. Document the choice inline.

### Catalog DTO + persistence read-path

- [ ] **Add `gicsIndustryGroup?: string`** to `InstrumentCatalogRow` in `libs/shared-types/src/index.ts` (or wherever the DTO lives — verify).
- [ ] **Update `apps/api/src/persistence/postgres.ts`** read paths that project `instruments` rows to the catalog DTO — include `gics_industry_group → gicsIndustryGroup` mapping. Update memory persistence likewise.
- [ ] Audit `apps/api/src/persistence/types.ts` for the corresponding type extension.

### UI — InstrumentCatalogSheet sector filter

- [ ] **Add sector dropdown** to `apps/web/features/settings/components/InstrumentCatalogSheet.tsx`:
  - Visible only when `marketChip === "AU"` (hide for ALL/TW/US)
  - Single-select; default "All sectors"
  - 11 GICS sectors as options, ordered per `gicsSectors` map
  - Filter logic: when set, expand to `industryGroupsForSector(selected)` and filter rows where `gicsIndustryGroup ∈ expanded`
  - Live-search results bypass the sector filter (show regardless)
  - Reset incremental-render window when sector filter changes (mirrors existing pattern)
- [ ] **Render industry-group label** (level 2) on each catalog row when `gicsIndustryGroup != null`. Sector NOT rendered on rows.
- [ ] Bucketize unknown industry-groups (CSV value not in `gicsIndustryGroups` map) to "Other" at render — never throw.

### i18n — full TW translation for sector + industry-group names

- [ ] **Add to `apps/web/features/settings/i18n.ts`** (en + zh-TW dictionaries):
  - 11 sector display names
  - 25 industry-group display names
  - "All sectors" / "Filter by sector" labels
- [ ] Use string-template pattern only (no functions) per `.claude/rules/nextjs-i18n-serialization.md`.
- [ ] **Update `apps/web/lib/i18n/types.ts`** with the new shape.

### Tests — integration

- [ ] **Create `apps/api/test/integration/asxGicsCatalogSync.integration.test.ts`** using `PostgresPersistence` direct (NOT `buildApp`) per `.claude/rules/integration-test-persistence-direct.md`:
  - Initial population: empty `gics_industry_group` → populated after one tick
  - Idempotence: second tick same CSV → no `updated_at` churn (assert via timestamp comparison)
  - Enrichment-only: ASX-only ticker logs `unmatched_asx_ticker`, INSERT count = 0
  - Leave-stale: ticker present in tick 1, absent in tick 2 → value preserved
  - Unknown industry-group from CSV stored as-is
  - Sanity-bound warn fires at <1000 / >5000 row counts
- [ ] Schema-qualified table names (`market_data.instruments`) in raw test SQL per `.claude/rules/integration-test-persistence-direct.md`.
- [ ] Seed parents (admin actor user, etc.) before any audit-log-touching paths if applicable.

### Tests — E2E (suite 6)

- [ ] **Create `apps/web/tests/e2e/specs/au-catalog-sector-filter-aaa.spec.ts`** using existing `SettingsDrawerPage`. Cover:
  - Sector dropdown visible when AU chip selected, hidden otherwise
  - Single-select narrows results
  - Live-search hits show regardless of sector filter
  - Industry-group label rendered on rows where data present
- [ ] **Reserved ticker prefix `AUGICS*`** for any seeded daily-bars in this spec.
- [ ] **Update `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`** to add the AUGICS* reservation alongside KZO-195's AUDEL*.

### Tests — unit (web)

- [ ] **Web unit tests for the sector filter logic** (filter narrows by industry-group expansion, live-search bypass) at `apps/web/features/settings/components/__tests__/` using vitest + RTL.

### Documentation

- [ ] **Update `docs/001-architecture/backend-db-api.md`** — `market_data.instruments` table doc: add `gics_industry_group` column with KZO-196 reference.
- [ ] **Update `docs/002-operations/runbook.md`** — add cron section for `asx-gics-csv` provider (cadence, env var, admin run-now button, failure modes).
- [ ] **Write transition note `docs/004-notes/kzo-196/transition-{datetime}-au-gics-enrichment.md`** covering: schema delta, write-path cleanup, app_config Tier A pattern, UI surface, behavioral deltas, rollback notes.
- [ ] **Update `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`** with AUGICS* prefix reservation.
- [ ] **PR description draft** at `.worklog/team/pr-description-draft.md` per `.claude/rules/pr-bound-docs-review-compliance.md` — must include `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block listing all 8 suite results), `## Risk/Rollback`, behavioral-delta callouts.

### Pre-PR validation

- [ ] **Pre-PR full-suite gate** per `.claude/rules/full-test-suite.md`:
  - `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`
  - All 8 suites green before pushing
- [ ] **Process hygiene** per `.claude/rules/validator-process-hygiene.md`: `lsof -i :4000 -i :3333 -i :4445 -i :4099` returns no orphan PIDs after gate runs.
- [ ] **Code review pass** before PR submission per `.claude/rules/code-review-before-pr.md`: produce structured review at `docs/004-notes/kzo-196/review-{datetime}-{slug}.md`.

## Open Items

(none — Phase 1 + 1.5 fully resolved)

## References

- Linear ticket: KZO-196 — https://linear.app/kzokv/issue/KZO-196/au-sector-gics-enrichment
- Parent: KZO-194 — Twelve Data AU catalog provider
- Sibling: KZO-195 — ASX delisting via consecutive-absence (just merged into dev @ 798a143)
- Related rules:
  - `.claude/rules/migration-strategy.md`
  - `.claude/rules/fastify-app-config-bootstrap.md`
  - `.claude/rules/app-config-cache-coherency.md`
  - `.claude/rules/env-setup-autogen-required-secrets.md`
  - `.claude/rules/integration-test-persistence-direct.md`
  - `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`
  - `.claude/rules/responsive-dual-layout-testid-prefixes.md`
  - `.claude/rules/typed-transient-error-catch-audit.md`
  - `.claude/rules/shared-types-barrel-turbopack.md`
  - `.claude/rules/pr-bound-docs-review-compliance.md`
  - `.claude/rules/full-test-suite.md`
- ASX CSV: `https://www.asx.com.au/asx/research/ASXListedCompanies.csv`
- EODHD ASX page: `https://eodhd.com/asx-data` (deferred — see KZO-197 follow-up)
