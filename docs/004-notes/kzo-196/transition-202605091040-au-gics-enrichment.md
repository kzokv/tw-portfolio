---
slug: kzo-196
type: transition-note
created: 2026-05-09T10:40
tickets: [KZO-196]
parent: KZO-194
sibling: KZO-195
status: frozen
---

# Transition Note — KZO-196: AU Sector / GICS Enrichment

This is a frozen snapshot of the system state at the time KZO-196 merged. Do not edit after merge.

---

## 1. Schema Delta

### Migration: `050_kzo196_gics_industry_group.sql`

**New column on `market_data.instruments`:**

| Column | Type | Default | Purpose |
|---|---|---|---|
| `gics_industry_group` | `TEXT NULL` | `NULL` | S&P/MSCI GICS industry-group label sourced from `ASXListedCompanies.csv`. `NULL` on rows not yet touched by the first sync run. Enrichment-only — INSERTs never populate this field. |

**Partial covering index:**

```sql
CREATE INDEX IF NOT EXISTS idx_instruments_gics_industry_group
  ON market_data.instruments (market_code, gics_industry_group)
  WHERE gics_industry_group IS NOT NULL;
```

Covers the `InstrumentCatalogSheet` AU sector-filter query path.

**One-time cleanup UPDATE:**

```sql
UPDATE market_data.instruments
   SET industry_category_raw = NULL, updated_at = CURRENT_TIMESTAMP
 WHERE market_code = 'AU' AND industry_category_raw IS NOT NULL;
```

KZO-194 repurposed `industry_category_raw` to carry the Twelve Data classifier type (`Common Stock`, `ETF`, etc.) for AU rows. That value is now redundant with `instrument_type`. This UPDATE nulls it out. KZO-196 also patches `TwelveDataAuCatalogProvider.fetchInstrumentCatalog` to stop re-stamping `industry_category_raw` (see §3), making the cleanup durable.

**New column on `public.app_config`:**

| Column | Type | Default | Purpose |
|---|---|---|---|
| `asx_gics_refresh_cron` | `TEXT NULL` | `NULL` | Cron schedule override for the AU GICS sync worker. `NULL` = use `Env.ASX_GICS_REFRESH_CRON`. Restart-required. |

**New row in `market_data.provider_health_status`:**

Migration seeds `('asx-gics-csv', 'down')` via `ON CONFLICT DO NOTHING` so the admin `/providers` page renders the row immediately on the first deploy.

---

## 2. Static GICS Map

### Shape and taxonomy

The GICS taxonomy (post-2023 S&P/MSCI revision) implemented in KZO-196:

- **11 sectors** (e.g. "Energy", "Materials", "Industrials", "Consumer Discretionary", "Consumer Staples", "Health Care", "Financials", "Information Technology", "Communication Services", "Utilities", "Real Estate")
- **25 industry groups** (post-2023: Real Estate split produced 25 from the prior 24)

Each industry-group entry shape: `{ industryGroup: string; sector: string; displayKey: string }`.

Lookup helpers:
- `sectorForIndustryGroup(industryGroup): string | null` — O(1) map lookup
- `industryGroupsForSector(sector): string[]` — returns the subset of industry groups that belong to the given sector; returns `[]` for unknown sector strings

### F1 deviation — content inlined into `libs/shared-types/src/index.ts`

**Planned design (scope-todo §"Static GICS map"):** `gicsSectors`, `gicsIndustryGroups`, and the two lookup helpers would live in a separate file `libs/shared-types/src/gics.ts` re-exported via `export * from "./gics.js"`.

**Actual implementation:** all four exports are inlined directly into `libs/shared-types/src/index.ts`.

**Reason:** Next.js webpack/Turbopack cannot resolve `./gics.js` relative imports when `apps/web/tsconfig.json` aliases `@tw-portfolio/shared-types` to the direct source path (`libs/shared-types/src/index.ts`). The alias makes webpack resolve the barrel by filename; a relative `./gics.js` import inside the barrel then fails to resolve because webpack looks for the file relative to the aliased entry, not the physical disk path. Adding `extensionAlias: { '.js': ['.ts', '.js'] }` to the Next.js webpack config would fix this, but that change is out of scope for KZO-196.

**Workaround:** inlining removes the relative import entirely. The content is identical to what the separate file would have contained.

**Follow-up:** KZO-202 tracks the proper extraction to `gics.ts` once `extensionAlias` lands or a `dist/` build path is wired for `libs/shared-types`.

---

## 3. TwelveData Write-Path Cleanup

`apps/api/src/services/market-data/providers/twelveDataAu.ts`, `fetchInstrumentCatalog`:

| Branch | Before KZO-196 | After KZO-196 |
|---|---|---|
| `/etf` branch | `industryCategory: row.type` (e.g. `"ETF"`) | `industryCategory: "ETF"` (hardcoded; Architect ruling preserved inline) |
| `/stocks` branch | `industryCategory: row.type` (e.g. `"Common Stock"`) | `industryCategory: ""` (empty string sentinel) |

The `/etf` branch retains `"ETF"` because the ETF signal is load-bearing for downstream instrument-type derivation. The `/stocks` branch is set to empty string to avoid re-stamping `industry_category_raw` with Twelve Data's classifier type, which was the source of the KZO-194 misuse. Migration 050's UPDATE brings the already-persisted rows to NULL; the empty-string write-path means new catalog-sync runs do not re-pollute the column.

**Type shape:** `RawInstrumentInfo.industryCategory` remains `string` (not widened to `string | null`). The empty-string sentinel is intentional. KZO-201 tracks the proper type widening as cleanup.

---

## 4. Provider + Worker

### `AsxGicsCatalogProvider` (`apps/api/src/services/market-data/providers/asxGicsCatalog.ts`)

- Fetches `https://www.asx.com.au/asx/research/ASXListedCompanies.csv` with a 30s timeout
- Uses `csv-parse` to parse the CSV; locates columns by case-insensitive header name
- Throws `AsxGicsFetchError` (extends `Error`) for HTTP/network failures
- Throws `AsxGicsParseError` (extends `Error`, carries `{ columnName }`) if the `GICS industry group` column is absent
- Returns `RawAsxGicsRow[]` = `{ ticker: string; companyName: string; gicsIndustryGroup: string }[]`

### `asxGicsSyncWorker` (`apps/api/src/services/market-data/asxGicsSyncWorker.ts`)

**Invariants:**

- **NEVER INSERT** — enrichment-only. The worker only UPDATEs rows that already exist in `market_data.instruments` by `(ticker, market_code='AU')`.
- **Leave-stale on absence** — AU tickers present in the DB but absent from the current CSV keep their prior `gics_industry_group` value. No NULL-reset.
- **Idempotent** — UPDATE uses `WHERE gics_industry_group IS DISTINCT FROM $1`. Rows that already carry the correct value are not touched (`updated_at` does not change).
- **Per-batch transactions** — approximately 500 rows/tx to keep transaction duration bounded.
- **Constant singleton key** — `'asx-gics-sync'` (global, not per-ticker). Concurrent admin run-now clicks coalesce.
- **Sanity bounds** — warn (do not abort) at < 1 000 or > 5 000 parsed rows.
- **RateLimitedError re-throw** — the provider does not throw `RateLimitedError` today, but the worker's catch block explicitly re-throws it so future upstream rate-limit signals are not silently swallowed (per `typed-transient-error-catch-audit.md`).

**SSE events emitted:**

| Event | Payload |
|---|---|
| `gics_sync_started` | `{}` |
| `gics_sync_completed` | `{ rowsUpdated, rowsUnchanged, rowsUnmatchedAsx, rowsMissingFromCsv, durationMs }` |
| `gics_sync_failed` | `{ stage, err }` |

Per-ticker `unmatched_asx_ticker { ticker }` log is emitted only when the total count ≤ 50; a single summary line is logged otherwise.

---

## 5. Tier A Bootstrap

The `ASX_GICS_REFRESH_CRON` env var and `app_config.asx_gics_refresh_cron` DB column follow the KZO-198 hybrid Tier A pattern:

**Resolver:** `getEffectiveAsxGicsRefreshCron()` in `apps/api/src/services/appConfig/asxGicsCron.ts` — DB column (non-NULL) → env var → hard default `'0 2 * * 0'`.

**Boot call order (from `buildApp()`):**

```
persistence.init()                          // singleton app_config row exists
setAppConfigCachePersistence(persistence)
await refresh()                             // EAGER pre-warm — getEffective* now returns hot value
  ↓
getEffectiveAsxGicsRefreshCron()            // safe — cache is warm
boss.schedule('asx-gics-sync', cron, ...)  // pg-boss queue registration uses resolver, not env-only

app.addHook("onReady", async () => {        // defensive idempotent re-warm
  try { await refresh() } catch(err) { log.warn(...) }
})
```

**Forbidden pattern:** `app.ready(callback)` anywhere mid-`buildApp()` — engages Fastify's ready chain and causes `FST_ERR_INSTANCE_ALREADY_LISTENING` on subsequent `addHook` calls (per `fastify-app-config-bootstrap.md`).

**DB override note:** changing `app_config.asx_gics_refresh_cron` via the admin UI takes effect only after a restart — the pg-boss schedule is registered once at boot.

---

## 6. UI Surface

### Sector dropdown (`InstrumentCatalogSheet`)

- Visible only when `marketChip === 'AU'` (hidden for ALL / TW / US markets)
- Single-select; default "All sectors"
- 11 GICS sectors as options, ordered per `gicsSectors` array
- Filter logic: when a sector is selected, the sheet calls `industryGroupsForSector(sector)` to get the matching industry groups, then filters catalog rows where `gicsIndustryGroup` is in that set
- Live-search results (incremental `q` query) bypass the sector filter regardless of selection
- Resetting the filter clears the incremental render window (mirrors the existing market-chip reset pattern)

### Per-row industry-group label

When `gicsIndustryGroup != null`, a secondary label is rendered on each catalog row showing the industry-group name (looked up from `gicsIndustryGroups` for the localized display name). Sector name is NOT rendered on rows.

### Unknown industry-group bucketization

If the `gicsIndustryGroup` value from the DB is not present in the static `gicsIndustryGroups` map (e.g. the ASX CSV added a new group not yet in the code), the row is bucketed as "Other" at render time. No exception is thrown.

### i18n

`apps/web/features/settings/i18n.ts` adds 11 sector display names, 25 industry-group display names, and "All sectors" / "Filter by sector" labels in both `en` and `zh-TW`. All values use string-template form only (no functions), satisfying `nextjs-i18n-serialization.md`.

---

## 7. Behavioral Deltas (Intentional, Not Regressions)

| Surface | Before KZO-196 | After KZO-196 |
|---|---|---|
| `market_data.instruments` columns | No `gics_industry_group` | `gics_industry_group TEXT NULL` present |
| `app_config` columns | No `asx_gics_refresh_cron` | `asx_gics_refresh_cron TEXT NULL` present |
| `market_data.provider_health_status` rows | 5 rows (`finmind-tw`, `finmind-us`, `yahoo-finance-au`, `twelve-data-au`, `twelve-data-au-catalog`) | 6 rows — `asx-gics-csv` added |
| `GET /admin/providers` response | 5 provider rows | 6 provider rows |
| `InstrumentCatalogSheet` (AU market) | No sector dropdown; no industry-group label on rows | Sector dropdown visible; industry-group label rendered when data present |
| `InstrumentCatalogSheet` (TW / US / ALL markets) | No change | No sector dropdown (correctly hidden) |
| AU instruments `industry_category_raw` | Populated with Twelve Data classifier (`Common Stock`, `ETF`, etc.) | `NULL` after migration 050's UPDATE; subsequent catalog-sync runs write empty string (durable cleanup) |
| `hasFiveProviders` test helper | Asserted 5 provider rows | Retained as back-compat; `hasSixProviders` added for new assertions |
| Admin providers page testids | `provider-rerun-btn-finmind-tw`, etc. | Same plus `provider-rerun-btn-asx-gics-csv` (table) and `provider-rerun-btn-card-asx-gics-csv` (mobile card) |

---

## 8. Renamed Types / New Helpers

| Symbol | Location | Change |
|---|---|---|
| `gicsSectors` | `libs/shared-types/src/index.ts` | New export — ordered array of 11 GICS sector names |
| `gicsIndustryGroups` | `libs/shared-types/src/index.ts` | New export — ordered array of 25 industry-group entries |
| `sectorForIndustryGroup` | `libs/shared-types/src/index.ts` | New export — O(1) industry-group → sector lookup |
| `industryGroupsForSector` | `libs/shared-types/src/index.ts` | New export — sector → industry-group[] inverse lookup |
| `InstrumentCatalogRow.gicsIndustryGroup` | `libs/shared-types/src/index.ts` | New optional field `?: string` |
| `AsxGicsCatalogProvider` | `apps/api/src/services/market-data/providers/asxGicsCatalog.ts` | New class |
| `MockAsxGicsCatalogProvider` | `apps/api/src/services/market-data/providers/mockAsxGicsCatalog.ts` | New class |
| `AsxGicsFetchError` | `apps/api/src/services/market-data/providers/asxGicsCatalog.ts` | New error class |
| `AsxGicsParseError` | `apps/api/src/services/market-data/providers/asxGicsCatalog.ts` | New error class |
| `RawAsxGicsRow` | `apps/api/src/services/market-data/providers/asxGicsCatalog.ts` | New type |
| `getEffectiveAsxGicsRefreshCron` | `apps/api/src/services/appConfig/asxGicsCron.ts` | New resolver |
| `hasSixProviders` | `libs/test-api/src/assistants/providers/ProvidersApiAssert.ts` | New test helper (alongside back-compat `hasFiveProviders`) |

---

## 9. Rollback Notes

- **Migration 050's UPDATE is one-way.** If rolled back, AU rows will have `industry_category_raw = NULL`. This is benign — the column was populated with Twelve Data classifier values redundant with `instrument_type`, and the front-end does not render `industry_category_raw`.
- **`gics_industry_group` column is NULL-safe and removable** via a new migration if the feature is reverted. No CHECK constraints.
- **To disable the cron without a rollback:** `DELETE FROM pgboss.schedule WHERE name = 'asx-gics-sync'` (takes effect immediately; the handler remains registered but no new ticks fire).
- **`app_config.asx_gics_refresh_cron`** column can be left in place after rollback — the column is nullable and the code that reads it is removed in the rollback.

---

## 10. Convergence Iteration Log

| Iter | Root cause | Fix |
|---|---|---|
| 1 | Backend Implementer respawned (original agent timed out overnight); VERIFY-NOT-REGENERATE protocol applied. Missing endpoint: `POST /admin/providers/asx-gics-csv/rerun` wiring. Phase 3 CR found HIGH-1 (`htmlFor`/`id` mismatch on sector dropdown label) and MEDIUM-2 (JSDoc says "24" but array has 25 entries). | Respawn agent verified on-disk work (~ 1 870 LOC), completed missing endpoint wiring. CR findings routed: HIGH-1 → Frontend Implementer, MEDIUM-2 → Backend Implementer. |
| 2 | HIGH-1 and MEDIUM-2 fixes applied. LOW-1 (`as never` cast on `recordOutcome`) accepted with inline comment (union type widening deferred to follow-up). Full suite gate: all 8 suites green. Suite 6 had one stochastic flake (`monitored-tickers-aaa.spec.ts:153`) ruled pre-existing by 5-point checklist (file predates KZO-196, zero diff overlap, single timeout class, 2+ independent data points). |  |

---

## 11. References

- Linear: <https://linear.app/kzokv/issue/KZO-196>
- Parent ticket: KZO-194 (TD AU catalog — `docs/004-notes/kzo-194/transition-202605071600-twelve-data-catalog.md`)
- Sibling ticket: KZO-195 (ASX delisting — `docs/004-notes/kzo-195/transition-202605092200-asx-delisting-detection.md`)
- Scope-todo: `docs/004-notes/kzo-196/scope-todo-202605090738-locked.md`
- Phase 3 Code Review: `docs/004-notes/kzo-196/review-202605091654-phase3-kzo196.md`
- Runbook §24: `docs/002-operations/runbook.md` — GICS sync operational notes
- Architecture: `docs/001-architecture/backend-db-api.md` — GICS enrichment section
- Ticker hygiene rule: `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` — `AUGICS*` reservation
- Follow-up: KZO-201 (widen `RawInstrumentInfo.industryCategory` type), KZO-202 (extract `gics.ts` submodule)
- ASX CSV source: `https://www.asx.com.au/asx/research/ASXListedCompanies.csv`
