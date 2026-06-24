---
slug: refresh-market-data-operations
source: scope-grill
created: 2026-06-23
tickets: []
supersedes: docs/notes/market-data-admin-settings/scope-todo-202606081316-market-data-admin-settings.md
required_reading:
  - AGENTS.md
  - apps/api/AGENTS.md
  - apps/web/AGENTS.md
  - libs/shared-types/AGENTS.md
  - db/AGENTS.md
---

# Todo: Refresh Market Data Operations and KR Mapping Resolver

> For agents starting a fresh session: read all files listed in `required_reading` before implementation. This file supersedes the 2026-06-08 market-data admin settings todo.

## Locked Scope

- One big PR is approved.
- Keep KR Mappings specialized. Do not delete or flatten the KR mapping resolver workflow.
- Move Market Data Operations to one shared operation-history and inspector shell across markets.
- Add a dedicated KR mapping resolver preservation room in the PR.
- Add a generic provider pacing settings model for all providers; only Yahoo KR enforcement is required in this PR.
- Full auto-resume is not required. Pacing should make average-case Yahoo KR resolver work avoid rate-limit pauses.

## Stale Requirements Rewritten

- Do not add a new Market Data Admin i18n namespace; it already exists. Complete i18n coverage for touched Market Data Admin strings.
- Do not frame TW as having no inspect flow. Generic non-KR inspection exists, but it is shallow and provider-fixer-shaped.
- Do not say KR operations cannot show outcomes. KR mapping operations should show item-level outcomes; non-outcome operation types should show structured details and logs with clear empty states.
- Do not implement a sticky right inspector. Use the locked wider drawer inspector.
- Do not remove the KR mappings panel. Only unify the KR Operations shell.

## Implementation Rooms

### 1. Provider Pacing Settings

- Add nullable per-provider minimum request interval settings to app config:
  - `finmindProviderMinRequestIntervalMs`
  - `twelveDataProviderMinRequestIntervalMs`
  - `yahooAuProviderMinRequestIntervalMs`
  - `yahooKrProviderMinRequestIntervalMs`
  - `frankfurterProviderMinRequestIntervalMs`
  - `asxGicsProviderMinRequestIntervalMs`
- Add matching effective fields, bounds, patch schema entries, cache shape, persistence type entries, memory support, Postgres support, and DB migration.
- Add deterministic defaults for effective fields through env-schema/default resolver hooks or a documented internal default, so `null` has a visible effective value in the UI.
- Bounds: `0..60_000ms`.
- Semantics:
  - `null` means use default.
  - `0` means explicitly disable minimum spacing.
  - `>0` means minimum delay between provider requests.
- Surface all fields in Admin Settings near provider operation budgets.
- Show enforcement status copy:
  - Yahoo KR: enforced in this PR.
  - Other providers: configured, not enforced yet.
- Enforce Yahoo KR pacing inside Yahoo KR provider request paths and sequential admin verification loops. The affected flows include preview verification, repair execute, renew evidence, and reverify mapping.
- Avoid `Promise.all` for paced Yahoo KR verification work.

### 2. Shared Market Data Operations API

- Add `AdminMarketDataOperationDto` instead of reusing `ProviderFixerDashboardOperationDto` for Market Data Operations.
- Include common fields: id, providerId, marketCode, operationType, phase, createdAt, updatedAt, startedAt, completedAt, cancelledAt, matchCount, progressPercent, previewExpiresAt.
- Include execute metadata: canExecute, executeMode, confirmation level/text, acknowledgement label, previewExpired, blocked reason, and endpoint discriminator.
- Include structured summaries for frontend localization: kind, preview parts, counts, date range, batch id, categories, rate limit, pacing.
- Include typed details for backfill, purge, mapping, catalog sync, FX refresh, and ASX GICS.
- Add sanitized debug metadata with an allowlist only.
- Add shared operation filters:
  - provider
  - operation type
  - phase
  - date range
  - allowlisted text search
  - page and limit
- Add filter support in memory and Postgres persistence.
- Add selected off-page operation support without reordering or appending to the current page items.
- Add normalized operation logs endpoint:
  - `GET /admin/market-data/:marketCode/operations/:operationId/logs`
  - Backed by existing `provider_operation_logs`.
  - Paginated and sanitized, including level, occurred time, message, detail, and allowlisted context.
- Keep item outcomes for item-level operations only. Backfill, purge, catalog, FX, and GICS operations should render details/logs instead of fake empty outcomes.

### 3. Shared Operations Web Shell

- Replace generic operations and KR operations divergence with one shared history and drawer inspector.
- Keep KR Mappings tab specialized and separate.
- Add filter toolbar above history with Apply and Reset.
- Add paginated history with visible page/total context.
- History columns/cards should include created time, operation type, provider, phase, localized short preview, progress/matches, and keep the raw operation id as secondary detail.
- Do not pin selected operations to the top.
- If a deep-linked selected operation is outside the current page, keep table order truthful and show an "inspecting item outside this page" state.
- Use a wider drawer inspector on desktop; keep the existing bottom-sheet behavior on mobile.
- Inspector sections:
  - Summary
  - Structured details
  - Logs
  - Item outcomes when applicable
  - Related Activity link
  - Sanitized debug metadata
- Logs and outcomes each need page/limit controls and current page/total context.
- Operation previews should be localized by the frontend from structured backend summaries.

### 4. KR Mapping Resolver Preservation

- Preserve the core model:
  - Twelve Data KR is catalog/evidence source.
  - Yahoo Finance KR owns durable mappings, bars, and dividends.
  - Mapping repair persists verified mappings only.
  - Mapping repair does not automatically backfill price data.
  - Rerun/backfill is a separate explicit action.
- Fix current KR mapping route contract issues:
  - Web `mappings/reverify` payload sends `resolvedSymbol`, while the API strict schema rejects it.
  - Web `mappings/revert` payload sends `resolvedSymbol`, while the API strict schema rejects it.
  - Bulk unresolved state service expects `updatedCount`, while the API returns `result.succeeded` and `result.failed`.
- Remove or hide generic Retry for KR mapping operations. Use Resume for paused operations and dedicated mapping actions for new work.
- API should not advertise or accept generic retry for KR mapping operation types unless retry becomes type-aware and preserves required metadata. This PR scope chooses removal/hiding, not type-aware retry.
- Keep pause, resume, cancel where valid.
- Ensure mapping operation inspectors show mapping-specific details, source symbol, resolved symbol, resolver mode, prior evidence, operation logs, and item outcomes.
- Preserve linked operation navigation from durable mappings to Operations.
- Add tests for repair preview/execute, renew, reverify, revert, rerun, resume, outcomes, logs, and pacing.

### 5. Backfill and Purge Guardrails

- Operations must safely execute existing `backfill_catalog_rows` previews through market-data backfill guardrails, not mapping frozen-scope guardrails.
- Backfill tab remains the primary manual and guided repair surface.
- Performance-trend guided repair deep links continue to open Backfill guided mode.
- Operations inspector may inspect/resume executable backfill previews, but execution must route through the market-data backfill execute path.
- Stale or expired previews should explain why execution is blocked and link to a fresh preview flow.
- Backfill execute and purge execute need page-local pending, success, and error notices with operation links where available.
- No global toast system is required.
- Purge unsupported categories remain visible but disabled with localized reasons and are auto-deselected when the market changes.
- Disabled purge-category state should be driven by backend capability/preview metadata, not frontend-only market hardcoding.
- Purge execute should show a clear page-local notification after confirmation and clicking PURGE.

### 6. Other Market Data Admin UI Fixes

- Fix the Instruments filter/action layout so Apply and Reset are reachable at the current viewport.
- Complete i18n for touched Market Data Admin and KR mapping/operations strings in English and zh-TW.
- Keep page sections un-nested and responsive.
- Use existing table/drawer patterns unless the shared operations shell needs a small local abstraction.

## Validation and Tests

- API integration coverage:
  - shared market-data operations DTO
  - normalized logs endpoint
  - operation filters and pagination
  - selected off-page operation
  - backfill-preview execute path
  - purge unsupported category metadata
  - KR mapping outcomes remain intact
  - KR reverify/revert service/API payload compatibility
  - generic retry hidden/rejected for KR mapping operation types
- Persistence coverage:
  - memory and Postgres operation filters
  - allowlisted text search
  - selected off-page operation without reordering
  - provider pacing app-config fields
- App settings coverage:
  - schema
  - bounds
  - DTO
  - cache
  - patch/readback
  - Admin Settings UI rows and enforcement copy
- Provider/unit coverage:
  - Yahoo KR pacing waits between requests
  - `0` disables spacing
  - `null` uses default
  - admin verification loops are sequential when pacing applies
- Web component coverage:
  - shared operations drawer
  - logs and outcomes pagination
  - no selected-row pinning
  - disabled purge categories with reasons
  - backfill/purge execute notices
  - KR mapping service payloads and bulk response handling, including web-style reverify/revert payloads and `result.succeeded`/`result.failed` bulk responses
- Focused E2E coverage:
  - operations drawer behavior
  - instruments controls responsive at current viewport
  - Admin Settings pacing UI visible
  - guided backfill still opens from valuation repair
  - KR mapping critical path smoke where practical
- Development verification should run the smallest relevant suites first. Before a ready-to-merge PR, use repo rules for full test evidence; do not claim all tests pass unless all eight root suites have run.

## Implementation and Evidence Checklist

### 1. Provider Pacing Settings

- [x] Added the six nullable provider min-request-interval app-config fields across schema, persistence, cache, bounds, and migration layers.
  Evidence: `db/migrations/091_provider_min_request_intervals.sql`; `apps/api/src/persistence/types.ts`; `apps/api/src/persistence/memory.ts`; `apps/api/src/persistence/postgres.ts`; `apps/api/src/services/appConfig/cache.ts`; `apps/api/src/services/appConfig/bounds.ts`; `apps/api/test/unit/admin-settings-schema.test.ts`.
- [x] Added effective provider pacing DTO fields and default resolution so `null` still produces a visible effective value, including Yahoo KR defaulting to `1000ms`.
  Evidence: `libs/shared-types/src/index.ts`; `apps/api/src/routes/adminRoutes.ts`; `apps/api/test/integration/providerFixerRoutes.integration.test.ts`.
- [x] Surfaced provider pacing rows and enforcement copy in Admin Settings, with Yahoo KR marked enforced and the other providers marked configured-only.
  Evidence: `apps/web/components/admin/AdminSettingsClient.tsx`; `apps/web/test/components/admin/AdminSettingsClient-providerPacing.test.tsx`.
- [x] Added a shared min-request-interval pacer and Yahoo KR request-spacing coverage, including `0` disabling spacing.
  Evidence: `apps/api/src/services/market-data/minRequestIntervalPacer.ts`; `apps/api/test/unit/market-data/minRequestIntervalPacer.test.ts`; `apps/api/test/unit/yahooFinanceKrProvider.test.ts`.
- [ ] Verified that every Yahoo KR admin verification loop in scope now runs sequentially without `Promise.all`.
- [ ] Recorded focused command output proving `null` pacing follows the effective default through the full runtime path.

### 2. Shared Market Data Operations API

- [x] Added `AdminMarketDataOperationDto` and shared response contracts with execute metadata, structured summary, details, debug metadata, and off-page selection state.
  Evidence: `libs/shared-types/src/index.ts`; `apps/api/src/routes/adminRoutes.ts`.
- [x] Added shared market operations listing support for provider, operation type, phase, search, date range, pagination, and selected off-page operation inclusion.
  Evidence: `apps/api/src/routes/adminRoutes.ts`; `apps/api/test/integration/providerFixerRoutes.integration.test.ts`.
- [x] Added the normalized paginated market-operation logs endpoint with sanitized allowlisted context.
  Evidence: `apps/api/src/routes/adminRoutes.ts`; `apps/web/test/lib/adminMarketDataService.test.ts`.
- [ ] Verified typed detail shapes for catalog sync, FX refresh, and ASX GICS instead of generic fallbacks.
- [ ] Verified allowlisted text-search behavior for shared market-operation queries across both memory and Postgres execution paths.

### 3. Shared Operations Web Shell

- [x] Wired both the generic market-data workspace and the KR resolver workspace to the shared operations shell.
  Evidence: `apps/web/components/admin/AdminMarketDataClient.tsx`; `apps/web/components/admin/AdminMarketDataKrResolver.tsx`; `apps/web/components/admin/AdminMarketDataOperationsShell.tsx`.
- [x] Added the shared operations filter toolbar with Apply/Reset flows and multi-provider filtering.
  Evidence: `apps/web/components/admin/AdminMarketDataOperationsShell.tsx`; `apps/web/test/components/admin/AdminMarketDataClient.test.tsx`.
- [x] Added drawer inspector controls for logs/outcomes pagination and preserved KR operation execution while hiding generic retry.
  Evidence: `apps/web/test/components/admin/AdminMarketDataClient.test.tsx`; `apps/api/src/routes/adminRoutes.ts`.
- [ ] Verified the off-page selection banner, Related Activity link, sanitized debug metadata section, and no selected-row pinning in a focused run.
- [ ] Verified desktop wider-drawer and mobile bottom-sheet behavior with responsive evidence.

### 4. KR Mapping Resolver Preservation

- [x] Fixed the web reverify/revert contract mismatch by omitting `resolvedSymbol` from those payloads.
  Evidence: `apps/web/lib/adminMarketDataService.ts`; `apps/web/test/lib/adminMarketDataService.test.ts`.
- [x] Fixed bulk unresolved response handling so web accepts `result.succeeded` / `result.failed` in place of `updatedCount`.
  Evidence: `apps/web/lib/adminMarketDataService.ts`; `apps/web/test/lib/adminMarketDataService.test.ts`.
- [x] Removed or rejected generic retry for KR mapping operations while keeping resume and dedicated mapping actions.
  Evidence: `apps/api/src/routes/adminRoutes.ts`; `apps/web/test/components/admin/AdminMarketDataClient.test.tsx`.
- [x] Preserved KR mapping actions, links, and operation-inspector execution inside the market-data workspace.
  Evidence: `apps/web/test/components/admin/AdminMarketDataClient.test.tsx`.
- [ ] Recorded focused run evidence for renew, rerun, resume, outcomes, logs, and pacing behavior beyond test additions.

### 5. Backfill and Purge Guardrails

- [x] Backfill flow still supports guided valuation repair and now shows page-local creation state with operation links.
  Evidence: `apps/web/components/admin/AdminMarketDataClient.tsx`; `apps/web/test/components/admin/AdminMarketDataClient.test.tsx`.
- [x] Purge flow shows disabled unsupported categories with reasons plus page-local preview/execute notices and operation links.
  Evidence: `apps/web/components/admin/AdminMarketDataClient.tsx`; `apps/web/test/components/admin/AdminMarketDataClient.test.tsx`.
- [ ] Verified operations-inspector backfill execution routes through the market-data backfill execute path.
- [ ] Verified disabled purge categories are driven end-to-end by backend capability/preview metadata rather than frontend-only assumptions.

### 6. Other Market Data Admin UI Fixes

- [x] Added touched Market Data Admin i18n strings for shared operations and provider pacing UI in English and zh-TW.
  Evidence: `apps/web/components/admin/admin-i18n.tsx`; `apps/web/components/admin/AdminSettingsClient.tsx`.
- [ ] Verified the Instruments filter/action layout is reachable at the current viewport.
- [ ] Recorded focused E2E evidence for operations drawer behavior, Admin Settings pacing visibility, guided backfill deep links, or KR mapping smoke.

### 7. Current Validation Evidence

- [x] Repo-local `docs/notes` validation log for this scope.
- [x] Executed command results recorded in this note.

Commands run on 2026-06-23 from `/Users/lume/repos/tw-portfolio/.claude/worktrees/market-data-admin-settings`:

- `npx eslint .` — passed.
- `npm run typecheck` — passed.
- `npm run test --prefix apps/web` — passed before final focused rerun (`56 passed`, `348 tests passed`; second phase `61 passed`, `426 tests passed`).
- `npm run test --prefix apps/api` — passed (`174 passed | 44 skipped`, `1747 passed | 431 skipped`).
- `npm run test:integration:full:host` — passed (`92 passed`, `894 passed | 1 skipped`).
- `npm run test --prefix apps/api -- test/integration/providerFixerRoutes.integration.test.ts test/unit/providerFixerPersistence.test.ts test/unit/admin-settings-schema.test.ts test/unit/yahooFinanceKrProvider.test.ts test/unit/market-data/minRequestIntervalPacer.test.ts` — passed (`5 passed`, `79 passed`).
- `cd apps/web && npx vitest run test/components/admin/AdminMarketDataClient.test.tsx test/components/admin/AdminSettingsClient-providerPacing.test.tsx test/lib/adminMarketDataService.test.ts test/app/admin/marketDataPage.test.tsx` — passed (`4 passed`, `36 passed`).
- `git diff --check` — passed.

Not run after the final focused pass per operator time/token direction:

- `npm run test:e2e:bypass:mem --prefix apps/web`
- `npm run test:e2e:oauth:mem --prefix apps/web`
- `npm run test:http --prefix apps/api`

## Out Of Scope

- Deleting or replacing the KR Mappings tab.
- Full auto-resume scheduler or retry policy.
- Non-Yahoo provider pacing enforcement.
- Dynamic provider config framework.
- Backend storage-model unification.
- Global toast system.
- Broader admin redesign outside Market Data.
- Arbitrary raw metadata search.

## References

- Worktree: `/Users/lume/repos/tw-portfolio/.claude/worktrees/market-data-admin-settings`
- Superseded todo: `docs/notes/market-data-admin-settings/scope-todo-202606081316-market-data-admin-settings.md`
- Mockup: `docs/notes/market-data-admin-settings/operations-layout-mockup.html`
- Key KR mapping files:
  - `apps/api/src/routes/adminRoutes.ts`
  - `apps/web/components/admin/AdminMarketDataKrResolver.tsx`
  - `apps/web/lib/adminMarketDataService.ts`
  - `apps/api/src/services/market-data/providers/yahooFinanceKr.ts`
  - `apps/api/src/services/market-data/providerOperationCapabilities.ts`
