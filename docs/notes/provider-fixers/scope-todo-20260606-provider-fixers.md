---
slug: provider-fixers
source: scope-grill
created: 2026-06-06
updated: 2026-06-07
tickets: []
required_reading: []
superseded_by: null
---

# Provider Fixers Locked Scope

## Intent

Build a market-data admin console that lets operators inspect instrument state, sync provider-owned catalogs/enrichment/FX data, backfill historical data with explicit storage guardrails, repair provider mappings, retire unsupported instruments, and purge stored data without hiding provider ownership.

The UX is market-first. Execution remains provider-owned.

## Locked Decisions

1. Canonical admin UI surface is `/admin/market-data`, with detail routes under `/admin/market-data/:marketCode/:tab`.
2. Retire the `/admin/providers` UI destination with no redirect. Keep backend provider-scoped APIs and provider operation records.
3. Retire standalone `/admin/instruments`; do not replace it with public `/admin/providers/:providerId/instruments` UI APIs.
4. Market-data BFF routes own admin UI read/preview DTOs. Provider ownership remains internal capability metadata and execution attribution.
5. Execution must remain provider-owned: execute routes either call provider-owned routes or require explicit `providerId` and create provider operation records.
6. `/admin/market-data` landing page shows market tiles for `TW`, `US`, `AU`, `KR`, and `FX` with health, unresolved counts, pending/failed backfill counts, latest operation, and next action.
7. Market workspaces use tabs where applicable: `Overview`, `Instruments`, `Backfill`, `Mappings`, `Purge data`, `Operations`, and `Logs`.
8. `FX` is lightweight in this scope: `Overview`, `Refresh rates`, `Operations`, and `Logs`; no Instruments, Backfill, Purge, or retirement controls.
9. Operations tabs show a market-level timeline with provider chips and provider filters.
10. Provider fixers are provider-owned, not hidden market-level composite orchestration.
11. Add first-class provider operation actions for `sync_catalog`, `backfill_catalog_rows`, `refresh_fx_rates`, `sync_asx_gics`, and KR-only `repair_mapping`.
12. Keep coarse provider-health rerun if still useful, but it is not a substitute for first-class market-data operations.
13. Unresolved instruments remain provider error/fixer lifecycle rows. Do not overload unresolved state for catalog states such as delisted, excluded, pending backfill, retired, or unsupported.
14. Catalog repair/sync and historical data backfill are separate explicit actions.
15. Catalog rows can stay broad because they are comparatively cheap and support search/discovery.
16. Historical bars, dividends, and derived data are storage-heavy and must remain selective by default.
17. Backfill uses shared scopes across markets: `user_owned_or_monitored`, `selected_catalog_rows`, `manual_targets`, and `all_matching`.
18. `user_owned_or_monitored` means open positions in active accounts or manual monitored tickers, excluding demo users unless explicitly included.
19. `TW` and `US` default backfill scope is `user_owned_or_monitored`.
20. `AU` and `KR` default broad repair scope can target pending/failed catalog rows, but only through preview; no silent all-market warm-up.
21. Admins may backfill non-user-owned `TW`/`US` instruments only through selected catalog rows, manual/uploaded `(ticker, marketCode)` targets, or all-matching preview with typed confirmation.
22. Broad backfill previews must show match count, affected users/accounts, estimated job count, estimated storage impact, provider budget notes, and typed confirmation text when dangerous.
23. `yahoo-finance-kr` mapping repair persists verified mappings only and does not automatically enqueue backfill.
24. KR backfill after mapping is an explicit separate action.
25. The shipped KR resolver feature is not changed in this scope: do not alter resolver ranking, suffix rules, quote/chart fallback, or exact KR repair semantics.
26. Settings ticker repair stays narrow and user-facing: exact `(ticker, marketCode)` targets only. Admin market workspace owns purge, broad backfill, all-matching, and provider operation controls.
27. Add explicit instrument support states separate from purge and provider delisting: `listed`, `delisted`, `excluded_from_delisting_detection`, `retired_by_admin`, and `unsupported_by_provider`.
28. Retirement does not delete stored data, does not purge bars/dividends, and does not hide existing holdings. It disables or warns on future selection/backfill unless explicitly overridden.
29. Support/retirement controls apply to all catalog-capable markets. AU/KR delisting override remains separate and AU/KR-only.
30. Purge data and retirement are separate operator intents.
31. Purge in this scope includes stored data and optional admin state reset; catalog-row deletion is out of scope.
32. `Purge all` means purge all selected categories only, not every possible destructive category.
33. Purge supports full-history bars/dividends by default and advanced date-range purge for bars/dividends.
34. Provider logs/outcomes/error-trail purge uses operation/date filters, not price-date semantics.
35. Purge may offer `enqueue backfill after purge` for bars/dividends, default off, with clear UI guidance explaining delete-only vs delete-then-refill.
36. Date-range purge refills the same range only where the worker supports it; otherwise the UI must warn that refill is full-history or disable linked refill.
37. New queue-backed operations must preserve operation correlation so workers can update provider operation logs, progress, outcomes, and audit trails.
38. Mockups must be regenerated as eight screenshots: desktop and mobile for AU Instruments, TW/US Backfill, AU Purge data, and KR Mapping/Fixers.

## Market Scope

| Market workspace | Canonical route examples | Visible providers | Primary flows | Default storage stance |
| --- | --- | --- | --- | --- |
| `TW` | `/admin/market-data/TW/instruments`, `/admin/market-data/TW/backfill` | `finmind-tw` | Sync catalog, inspect instruments, retire/support state, user-owned/selected/manual/all-matching backfill, purge stored data | Catalog broad; historical data defaults to user-owned/monitored. |
| `US` | `/admin/market-data/US/instruments`, `/admin/market-data/US/backfill` | `finmind-us` | Sync catalog, inspect instruments, retire/support state, user-owned/selected/manual/all-matching backfill, purge stored data | Same as TW; broad US history is dangerous by default. |
| `AU` | `/admin/market-data/AU/instruments`, `/admin/market-data/AU/purge` | `twelve-data-au`, `yahoo-finance-au`, `asx-gics-csv` | Sync catalog, sync GICS, inspect instruments, delisting override, retire/support state, pending/failed backfill, purge bars/dividends/enrichment data | Catalog/enrichment broad; historical bars/dividends require preview. |
| `KR` | `/admin/market-data/KR/mappings`, `/admin/market-data/KR/backfill` | `twelve-data-kr`, `yahoo-finance-kr` | Sync catalog, repair Yahoo mappings, inspect instruments, retire/support state, explicit backfill, purge bars/dividends/mapping data | Mapping repair only; backfill explicit after mapping/catalog state is known. |
| `FX` | `/admin/market-data/FX/overview`, `/admin/market-data/FX/operations` | `frankfurter` | Refresh FX rates, inspect operations/logs | No instruments/backfill/purge in this scope. |

## Provider Capability Scope

| Provider | Provider role | Market workspace surface | Fixer/operation actions |
| --- | --- | --- | --- |
| `finmind-tw` | TW market data and catalog | `TW` Instruments, Backfill, Purge, Operations | `sync_catalog`, `backfill_catalog_rows` |
| `finmind-us` | US market data and catalog | `US` Instruments, Backfill, Purge, Operations | `sync_catalog`, `backfill_catalog_rows` |
| `twelve-data-au` | AU catalog | `AU` Instruments, Backfill, Operations | `sync_catalog`, `backfill_catalog_rows` |
| `yahoo-finance-au` | AU bars/dividends/metadata/search | `AU` Backfill, Purge, Operations | provider-owned bar/dividend backfill execution |
| `asx-gics-csv` | AU enrichment | `AU` Instruments/Purge enrichment sections, Operations | `sync_asx_gics` |
| `twelve-data-kr` | KR catalog | `KR` Instruments, Backfill, Operations | `sync_catalog`, `backfill_catalog_rows` |
| `yahoo-finance-kr` | KR bars/dividends/metadata/search and durable mapping | `KR` Mappings, Backfill, Purge, Operations | `repair_mapping`; explicit backfill only after mapping/catalog state is known |
| `frankfurter` | FX rates | `FX` Overview, Refresh rates, Operations, Logs | `refresh_fx_rates` |

## Backfill Scope Rules

| Scope | Meaning | Markets | Guardrails |
| --- | --- | --- | --- |
| `user_owned_or_monitored` | Open positions in active accounts or manual monitored tickers; excludes demo users unless included explicitly | `TW`, `US`, `AU`, `KR` | Default for `TW`/`US`; preview still required before enqueue. |
| `selected_catalog_rows` | Admin checks exact instrument rows from the market Instruments table | `TW`, `US`, `AU`, `KR` | Preview and explicit execute. |
| `manual_targets` | Admin enters/uploads exact `(ticker, marketCode)` targets | `TW`, `US`, `AU`, `KR` | Validate exact market, show invalid/unsupported rows before execute. |
| `all_matching` | All rows matching current filter, such as pending/failed catalog rows | `TW`, `US`, `AU`, `KR` | Typed dangerous confirmation when broad or above threshold. |

## Purge Scope Rules

### Required First Pass Categories

- Price bars
- Dividends
- Backfill job history and refresh batch results
- Provider operation outcomes/logs
- Provider error trail
- Provider resolution mappings where provider supports mappings
- ASX GICS enrichment data
- Admin state reset as separate explicit checkboxes

### Deferred Or Conditional Categories

- Derived portfolio/cache purge is deferred unless existing APIs expose clean invalidation/deletion boundaries.
- FX purge is out of scope unless a separate FX purge flow is intentionally added later.
- Catalog-row deletion is out of scope.

### Purge UX Rules

- Dry-run preview is required before execute.
- Preview must show affected instruments, affected users/accounts, row counts, estimated storage impact when available, unsupported categories, and whether linked refill is available.
- Broad/destructive purge requires typed confirmation.
- `Purge all selected` only purges checked data categories.
- Admin state reset is never included automatically in purge-all.
- Optional `enqueue backfill after purge` is default off and available only when bars/dividends are selected.
- UI copy must clearly explain delete-only versus delete-then-refill.

## Market-Data API Shape

Market-data BFF routes are the public admin UI API. Exact names can be adjusted to match route conventions, but the shape must stay market-first:

- `GET /admin/market-data`
- `GET /admin/market-data/:marketCode/overview`
- `GET /admin/market-data/:marketCode/instruments`
- `GET /admin/market-data/:marketCode/actions`
- `GET /admin/market-data/:marketCode/operations`
- `GET /admin/market-data/:marketCode/logs`
- `POST /admin/market-data/:marketCode/backfill/preview`
- `POST /admin/market-data/:marketCode/backfill/execute`
- `POST /admin/market-data/:marketCode/purge/preview`
- `POST /admin/market-data/:marketCode/purge/execute`
- `POST /admin/market-data/:marketCode/instruments/support-state`

Execute routes must require explicit provider/action selection where more than one provider can own the work. Provider operation records stay provider-scoped.

## Implementation Todo

- [x] Extend shared provider operation action/capability types for `sync_catalog`, `backfill_catalog_rows`, `refresh_fx_rates`, `sync_asx_gics`, and `repair_mapping`.
- [x] Add shared market-data DTOs for landing tiles, market workspace overview, instruments, actions, operations, logs, backfill preview, purge preview, and support-state mutation.
- [x] Add canonical `/admin/market-data` frontend routes and remove `/admin/providers` as a UI destination with no redirect.
- [x] Delete standalone `/admin/instruments` frontend route/sidebar/breadcrumb references and generic backend `/admin/instruments` routes.
- [x] Add market-data BFF admin routes under `/admin/market-data`.
- [x] Keep provider-scoped backend operation APIs/services for execution and operation records; do not expose provider-first instruments APIs as the UI replacement.
- [x] Add provider/market action ownership metadata so every market action displays provider id, disabled reason, guardrail level, queue/operation type, and provider budget notes.
- [x] Add market-level operations aggregation with provider filters and provider chips.
- [x] Add instrument filters for `status`, `supportState`, `search`, `instrumentType`, `backfillStatus`, `sort`, `page`, and `limit`.
- [x] Add support-state persistence/API/UI for `retired_by_admin` and `unsupported_by_provider`, separate from delisting/exclusion.
- [ ] Keep AU/KR delisting override controls separate from support/retirement controls.
- [x] Add explicit backfill scopes for user-owned/monitored instruments, selected catalog rows, manual/uploaded targets, and all-matching filters.
- [x] Add backfill preview responses with match count, affected users/accounts, estimated job count, estimated storage impact, provider budget notes, unsupported rows, and typed confirmation text when dangerous.
- [x] Allow TW/US non-user-owned backfill only through selected catalog rows, manual/uploaded targets, or all-matching preview with typed confirmation.
- [x] Keep AU/KR pending/failed catalog-row backfill, but require preview/estimate before enqueueing all pending/failed rows.
- [x] Add retention/provenance metadata for admin-triggered backfill batches or provider operations, or document the inference path if explicit storage metadata is deferred.
- [ ] Add queue-backed provider operations for catalog sync, catalog-row backfill, FX refresh, ASX GICS sync, and KR mapping repair.
- [x] Change KR mapping repair to mapping-only and keep rerun/backfill explicit.
- [x] Add Purge data dry-run/execute API and UI with selectable categories, full-history/date-range bars/dividends purge, optional linked refill, typed confirmation, audit logging, and provider/data-type capability checks.
- [x] Keep catalog-row deletion out of scope.
- [x] Keep Settings ticker repair exact-market-only and user-facing; do not add purge or broad backfill there.
- [x] Replace admin overview AU instruments metric with market-data landing/market tile counts and links.
- [x] Update runbooks/docs that refer to `/admin/providers` or `/admin/instruments`.
- [x] Add focused API, persistence, web component, and E2E coverage for market-data landing, market workspace tabs, backfill preview/execute, purge preview/execute, support-state mutation, KR mapping-only repair, and Settings exact-market repair.
- [x] Run focused E2E or equivalent updates for the changed admin/market-data flows.
- [x] Regenerate mockup source and screenshots for the eight locked views.

## Mockup Requirements

Regenerate `docs/mockups/provider-fixers/provider-fixers-mockup.html` and screenshots:

1. `01-au-instruments-desktop.png`
2. `02-au-instruments-mobile.png`
3. `03-tw-backfill-desktop.png`
4. `04-tw-backfill-mobile.png`
5. `05-au-purge-desktop.png`
6. `06-au-purge-mobile.png`
7. `07-kr-mapping-desktop.png`
8. `08-kr-mapping-mobile.png`

Each screenshot must use the canonical `/admin/market-data` mental model and show provider ownership chips where relevant.

## Non-Critical Gaps To Track

- Storage estimate can start as row-count based if byte-level estimates are not cheap.
- Retention/provenance can be stored explicitly or inferred from batch/operation metadata in the first implementation pass.
- Derived/cache purge should not be implemented without clear existing invalidation/deletion boundaries.
- FX purge is intentionally out of scope for now.
- `asx-gics-csv` Instruments details can reuse existing AU fields unless GICS fields are cheap to expose.
- Backfill job-history purge is intentionally unsupported in this pass because refresh batches are aggregate history without safe per-target provenance. The Purge data preview surfaces this as an unsupported category instead of deleting ambiguous history.
- Full eight-suite validation is required before PR. Local evidence captured for this implementation: eslint, typecheck, web unit, API unit/memory integration, Postgres integration, standard E2E, OAuth E2E, and API HTTP all passed on 2026-06-07.

## Code References

- Current provider operation routes and market-data BFF routes: `apps/api/src/routes/adminRoutes.ts`
- Provider operation capabilities: `apps/api/src/services/market-data/providerOperationCapabilities.ts`
- Provider registry: `apps/api/src/services/market-data/registry.ts`
- Catalog sync worker/provider mapping: `apps/api/src/services/market-data/registerCatalogSyncWorker.ts`
- Catalog-row backfill producer: `apps/api/src/services/market-data/enqueueAuCatalogBarsBackfill.ts`
- Market-data UI routes: `apps/web/app/admin/market-data/page.tsx`, `apps/web/app/admin/market-data/[marketCode]/[tab]/page.tsx`
- Market-data client/service: `apps/web/components/admin/AdminMarketDataClient.tsx`, `apps/web/lib/adminMarketDataService.ts`
- Retired standalone UI files: `apps/web/app/admin/instruments/page.tsx`, `apps/web/app/admin/providers/page.tsx`, `apps/web/components/admin/AdminInstrumentsClient.tsx`, `apps/web/components/admin/AdminProvidersClient.tsx`
- Settings ticker repair client/API: `apps/web/lib/repairService.ts`, `apps/api/src/routes/registerRoutes.ts`
