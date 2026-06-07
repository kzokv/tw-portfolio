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
17. Backfill uses shared scopes across markets: `user_owned_or_monitored`, `selected_catalog_rows`, and `all_matching`.
18. Hard-delete `manual_targets` from backend and UI. Do not alias it to another scope; old requests using `scope: "manual_targets"` should fail validation.
19. `user_owned_or_monitored` means all matching open positions in active accounts or manual monitored tickers across all non-demo users, excluding demo users unless explicitly included.
20. `TW` and `US` default backfill mode is `user_owned_or_monitored`; their supported-instrument picker defaults to listed, supported, all backfill statuses.
21. `AU` and `KR` default supported-instrument picker filters target listed, supported, pending/failed rows; no silent all-market warm-up.
22. Admins may backfill non-user-owned instruments only through the supported-instrument picker (`selected_catalog_rows`) or all-matching filter preview (`all_matching`) with typed confirmation when broad.
23. Backfill preview must disclose the exact frozen target list, not only counts. It must also show affected users/accounts, estimated jobs, estimated storage impact, provider budget notes, unsupported rows, and confirmation requirements.
24. Backfill preview creates a provider operation with compact frozen target rows in `market_data.provider_operations.metadata` JSONB and returns `operationId`, `previewToken`, `tokenExpiresAt`, and `targets`.
25. Backfill execute stays market-first at `POST /admin/market-data/:marketCode/backfill/execute`, but it must require `operationId + previewToken` and execute the frozen preview scope. Execute must reject expired/stale/missing preview tokens.
26. Backfill UI is a two-mode flow: `Owned or monitored` and `Supported instruments`. Do not expose backend scope names directly as the main control.
27. Supported-instrument mode uses a searchable/filterable checkbox table sourced from current market instruments. It supports `Preview selected` and `Preview all matching filters`.
28. Editing mode, provider, filters, selected rows, or demo-user inclusion after preview marks the preview stale and requires a new preview.
29. Preview target rows include operational verification fields: ticker, name, market, instrument type, backfill status, provider ids, and unsupported reason when rejected. Do not show per-user identities in this screen.
30. Large previews use summary-first UI: show target table inline when `targetCount <= 100`; show summary plus `View target details` modal when `targetCount > 100`; typed confirmation is required at `targetCount >= 100`; backend rejects previews above 5,000 targets.
31. The target-details modal searches and filters the frozen preview list, not live catalog rows.
32. Backfill provider selection is capability-based. Show a provider switcher only when multiple providers for the market support backfill execution; otherwise show fixed provider context.
33. Backfill preview/execution operations appear in market Operations/Logs with provider, scope label, and target count.
34. Unsupported rows are shown separately, skipped from execution, and preview is executable only when at least one supported target remains.
35. A backfillable supported instrument must match the route market, exist in `market_data.instruments`, be non-delisted, have `supportState === supported`, and have a backfill-capable provider. `ready` rows remain selectable for intentional re-backfill.
36. `yahoo-finance-kr` mapping repair persists verified mappings only and does not automatically enqueue backfill.
37. KR backfill after mapping is an explicit separate action.
38. The shipped KR resolver feature is not changed in this scope: do not alter resolver ranking, suffix rules, quote/chart fallback, exact KR repair semantics, provider route behavior, selectors, or tests.
39. Settings ticker repair stays narrow and user-facing: exact `(ticker, marketCode)` targets only. Admin market workspace owns purge, broad backfill, all-matching, and provider operation controls.
40. Add explicit instrument support states separate from purge and provider delisting: `listed`, `delisted`, `excluded_from_delisting_detection`, `retired_by_admin`, and `unsupported_by_provider`.
41. Retirement does not delete stored data, does not purge bars/dividends, and does not hide existing holdings. It disables or warns on future selection/backfill unless explicitly overridden.
42. Support/retirement controls apply to all catalog-capable markets. AU/KR delisting override remains separate and AU/KR-only.
43. Purge data and retirement are separate operator intents.
44. Purge in this scope includes stored data and optional admin state reset; catalog-row deletion is out of scope.
45. `Purge all` means purge all selected categories only, not every possible destructive category.
46. Purge supports full-history bars/dividends by default and advanced date-range purge for bars/dividends.
47. Provider logs/outcomes/error-trail purge uses operation/date filters, not price-date semantics.
48. Purge may offer `enqueue backfill after purge` for bars/dividends, default off, with clear UI guidance explaining delete-only vs delete-then-refill.
49. Date-range purge refills the same range only where the worker supports it; otherwise the UI must warn that refill is full-history or disable linked refill.
50. New queue-backed operations must preserve operation correlation so workers can update provider operation logs, progress, outcomes, and audit trails.
51. Mockups must be regenerated as eight screenshots: desktop and mobile for AU Instruments, TW/US Backfill, AU Purge data, and KR Mapping/Fixers.

## Market Scope

| Market workspace | Canonical route examples | Visible providers | Primary flows | Default storage stance |
| --- | --- | --- | --- | --- |
| `TW` | `/admin/market-data/TW/instruments`, `/admin/market-data/TW/backfill` | `finmind-tw` | Sync catalog, inspect instruments, retire/support state, owned/monitored backfill, supported-instrument picker backfill, all-matching backfill, purge stored data | Catalog broad; historical data defaults to owned/monitored. |
| `US` | `/admin/market-data/US/instruments`, `/admin/market-data/US/backfill` | `finmind-us` | Sync catalog, inspect instruments, retire/support state, owned/monitored backfill, supported-instrument picker backfill, all-matching backfill, purge stored data | Same as TW; broad US history is dangerous by default. |
| `AU` | `/admin/market-data/AU/instruments`, `/admin/market-data/AU/purge` | `twelve-data-au`, `yahoo-finance-au`, `asx-gics-csv` | Sync catalog, sync GICS, inspect instruments, delisting override, retire/support state, pending/failed backfill, purge bars/dividends/enrichment data | Catalog/enrichment broad; historical bars/dividends require preview. |
| `KR` | `/admin/market-data/KR/mappings`, `/admin/market-data/KR/backfill` | `twelve-data-kr`, `yahoo-finance-kr` | Sync catalog, repair Yahoo mappings, inspect instruments, retire/support state, explicit backfill, purge bars/dividends/mapping data | Mapping repair only; backfill explicit after mapping/catalog state is known. |
| `FX` | `/admin/market-data/FX/overview`, `/admin/market-data/FX/operations` | `frankfurter` | Refresh FX rates, inspect operations/logs | No instruments/backfill/purge in this scope. |

## Provider Capability Scope

| Provider | Provider role | Market workspace surface | Fixer/operation actions |
| --- | --- | --- | --- |
| `finmind-tw` | TW market data and catalog | `TW` Instruments, Backfill, Purge, Operations | `sync_catalog`, `backfill_catalog_rows` |
| `finmind-us` | US market data and catalog | `US` Instruments, Backfill, Purge, Operations | `sync_catalog`, `backfill_catalog_rows` |
| `twelve-data-au` | AU catalog/evidence | `AU` Instruments, Operations | `sync_catalog` |
| `yahoo-finance-au` | AU bars/dividends/metadata/search | `AU` Backfill, Purge, Operations | `backfill_catalog_rows` provider-owned bar/dividend execution |
| `asx-gics-csv` | AU enrichment | `AU` Instruments/Purge enrichment sections, Operations | `sync_asx_gics` |
| `twelve-data-kr` | KR catalog/evidence | `KR` Instruments, Operations | `sync_catalog` |
| `yahoo-finance-kr` | KR bars/dividends/metadata/search and durable mapping | `KR` Mappings, Backfill, Purge, Operations | `repair_mapping`, `backfill_catalog_rows`; explicit backfill only after mapping/catalog state is known |
| `frankfurter` | FX rates | `FX` Overview, Refresh rates, Operations, Logs | `refresh_fx_rates` |

## Backfill Scope Rules

| Scope | Meaning | Markets | Guardrails |
| --- | --- | --- | --- |
| `user_owned_or_monitored` | All matching open positions in active accounts or manual monitored tickers across all non-demo users; demo users included only when explicitly checked | `TW`, `US`, `AU`, `KR` | Default mode for `TW`/`US`; exact frozen preview required before enqueue. |
| `selected_catalog_rows` | Admin checks exact supported instrument rows from the market Backfill supported-instruments picker | `TW`, `US`, `AU`, `KR` | Backend revalidates support/delisting/provider capability; exact frozen preview required before enqueue. |
| `all_matching` | All supported instruments matching current Backfill picker filters, such as AU/KR pending/failed catalog rows | `TW`, `US`, `AU`, `KR` | Typed dangerous confirmation at `targetCount >= 100`; backend rejects above 5,000 targets. |

`manual_targets` is hard-deleted from backend and UI. It must not remain as a hidden API compatibility branch or alias.

### Backfill Preview/Execute Rules

- Preview creates a provider operation and stores the frozen target list in compact JSONB metadata.
- Preview response returns `operationId`, `previewToken`, `tokenExpiresAt`, `targets`, aggregate counts, unsupported rows, provider budget notes, and confirmation requirements.
- Execute stays market-first at `POST /admin/market-data/:marketCode/backfill/execute` and requires `operationId + previewToken`.
- Execute must reject expired, missing, or stale preview tokens and must execute only the frozen target list reviewed by the admin.
- `<= 100` targets render inline; `> 100` targets render summary-first with a target-details modal; `>= 100` requires typed confirmation; `> 5,000` is rejected at preview.
- Target details search/filter the frozen preview list, not live catalog rows.
- Unsupported rows are shown separately and skipped; preview is executable only when at least one supported target remains.
- Backfill operations appear in Operations/Logs with provider, target count, and scope label.

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
- `POST /admin/market-data/:marketCode/backfill/execute` (requires `operationId + previewToken` from preview)
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
- [x] Keep AU/KR delisting override controls separate from support/retirement controls.
- [x] Add initial market-data backfill preview/execute scaffolding. The target-scope contract is superseded by the hard-delete/frozen-preview follow-up below.
- [x] Add backfill preview responses with match count, affected users/accounts, estimated job count, estimated storage impact, provider budget notes, unsupported rows, and typed confirmation text when dangerous.
- [x] Add initial TW/US non-user-owned backfill guardrails through explicit targets or all-matching preview with typed confirmation. The explicit-target path is superseded by the supported-instrument picker follow-up below.
- [x] Keep AU/KR pending/failed catalog-row backfill, but require preview/estimate before enqueueing all pending/failed rows.
- [x] Add retention/provenance metadata for admin-triggered backfill batches or provider operations, or document the inference path if explicit storage metadata is deferred.
- [x] Add queue-backed provider operations for catalog sync, catalog-row backfill, FX refresh, ASX GICS sync, and KR mapping repair.
- [x] Change KR mapping repair to mapping-only and keep rerun/backfill explicit.
- [x] Add Purge data dry-run/execute API and UI with selectable categories, full-history/date-range bars/dividends purge, optional linked refill, typed confirmation, audit logging, and provider/data-type capability checks.
- [x] Keep catalog-row deletion out of scope.
- [x] Keep Settings ticker repair exact-market-only and user-facing; do not add purge or broad backfill there.
- [x] Replace admin overview AU instruments metric with market-data landing/market tile counts and links.
- [x] Update runbooks/docs that refer to `/admin/providers` or `/admin/instruments`.
- [x] Add focused API, persistence, web component, and E2E coverage for market-data landing, market workspace tabs, backfill preview/execute, purge preview/execute, support-state mutation, KR mapping-only repair, and Settings exact-market repair.
- [x] Run focused E2E or equivalent updates for the changed admin/market-data flows.
- [x] Regenerate mockup source and screenshots for the eight locked views.
- [x] Hard-delete `manual_targets` from shared types, backend schema/route handling, web service payloads, UI, API HTTP tests, E2E tests, and docs.
- [x] Add frozen backfill preview provider-operation creation with compact target metadata, `operationId`, `previewToken`, `tokenExpiresAt`, exact `targets`, and preview expiry handling.
- [x] Change market-data backfill execute to require `operationId + previewToken`, reject stale/expired/missing previews, and enqueue only the frozen reviewed targets.
- [x] Redesign Backfill UI into two modes: `Owned or monitored` and `Supported instruments`.
- [x] Add Backfill supported-instruments checkbox/filter picker using instrument-list DTO semantics and URL query params for shareable filters.
- [x] Add `Preview selected` and `Preview all matching filters`; mark preview stale after mode/provider/filter/selection/demo-user changes.
- [x] Render exact preview targets inline up to 100 rows and summary plus target-details modal above 100 rows; modal must filter the frozen preview list.
- [x] Add `Include demo users` checkbox for owned/monitored mode, default off, and disclose the setting in preview.
- [x] Add capability-based Backfill provider switcher only when multiple providers support backfill execution for the market.
- [x] Preserve unsupported-row partial preview semantics: show rejected rows separately, skip them, and disable execute when no supported target remains.
- [x] Keep KR resolver UI/features intact while changing Backfill: do not alter KR resolver route behavior, mapping semantics, selectors, or tests.
- [x] Rewrite API HTTP and OAuth E2E backfill coverage from manual ticker input to supported-instrument picker and frozen preview token execution.
- [x] Regenerate the TW/US Backfill desktop/mobile mockups to show the two-mode picker, exact preview summary, and details modal.

## Mockup Requirements

Regenerate `docs/mockups/provider-fixers/provider-fixers-mockup.html` and screenshots:

1. `01-au-instruments-desktop.png`
2. `02-au-instruments-mobile.png`
3. `03-tw-backfill-desktop.png` - must show two-mode Backfill flow, supported-instrument picker, exact preview summary, and large-target details affordance.
4. `04-tw-backfill-mobile.png` - must show the same Backfill flow in mobile layout.
5. `05-au-purge-desktop.png`
6. `06-au-purge-mobile.png`
7. `07-kr-mapping-desktop.png`
8. `08-kr-mapping-mobile.png`

Each screenshot must use the canonical `/admin/market-data` mental model and show provider ownership chips where relevant.

## Non-Critical Gaps To Track

- Storage estimate can start as row-count based if byte-level estimates are not cheap.
- Retention/provenance can be inferred from provider operation metadata in the first implementation pass.
- Historical provider operations may still contain `manual_targets` in old freeform metadata or `scopeQuery`; no parser should depend on that value.
- The Postgres owned/monitored query uses legacy market fallback for older position data; follow-up data quality work may be needed if stale trades lack market codes.
- Frozen preview targets must be stored compactly to keep JSONB metadata bounded under the 5,000-target hard limit.
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
