---
slug: dividend-review-performance
source: scope-grill
created: 2026-07-13
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Dividends Review performance, sorting, and pagination

> **For agents starting a fresh session:** this document is the locked implementation scope. Read it completely before changing code. Deliver only the checked-in scope below, and tick each implementation checkbox only after its deliverable is actually complete.

## Validated Baseline

The issues were reproduced in the deployed Vakwen dev UI on the Dividends → Review tab.

- Initial Review data took approximately 45 seconds to show table rows and approximately 58 seconds to become fully loaded.
- All 12 sortable table headers issued valid server-sort requests and ultimately returned correctly ordered data. Current-year sort changes took approximately 3 seconds, while the previous row order remained visible and made sorting appear broken.
- With the Years filter set to the eligible 2020–2026 range, pagination produced different row identities on page 1 and page 2 and returned to the original identities when navigating back. Each transition took approximately 9.5–10.6 seconds, while the URL and page label changed before the rows did.
- The user-visible defect is therefore both backend latency and frontend query-state integrity: sorting and pagination are functionally connected, but stale rows are presented as though they belong to the newly selected query.

## Confirmed Root Causes

- `apps/web/app/dividends/page.tsx` passes `initialReviewData={null}` and `initialYears={[]}`, so Review has no route-primary server payload.
- `apps/web/components/dividends/DividendsTabsClient.tsx` begins Review and eligible-year requests on the client and waits for both before mounting the table.
- `apps/web/components/dividends/DividendReviewClient.tsx` updates the URL and filter state immediately but retains the previous `data` while a new request is loading.
- `apps/api/src/persistence/postgres.ts#listDividendReviewRows` calls `listDividendCalendarSnapshot` with an effectively unlimited limit, loads every matching event plus trades, actions, ledgers, deductions, and source lines, generates all expected rows, computes aggregates, sorts in JavaScript, and only then slices the requested page.
- The Review route does not emit the hot-read `Server-Timing` instrumentation used by the established smooth-page read paths.
- The pending source-composition shortcut filters only the already paginated client rows, leaving the server total, pagination, and aggregates inconsistent.

## Locked Scope

1. Split Dividends Review into a route-primary read and a deferred enrichment read.
2. Add `GET /portfolio/dividends/review/primary` for lightweight table-summary rows, total count, eligible years, and account display options.
3. Add `GET /portfolio/dividends/review/enrichment` for full-filter aggregates, chart data, open-item counts, NHI rollups, and source-composition summaries.
4. Server-render the initial primary request so cold Review navigation does not begin with a client-only waterfall.
5. Preserve `GET /portfolio/dividends/review` as a compatibility surface that composes the optimized primary and enrichment reads. The compatibility path must not retain the unlimited calendar-snapshot implementation.
6. Implement a targeted, set-based Postgres review read model. Build eligible ledger and expected rows in SQL, apply filters early, sort and count in SQL, page before page-only hydration, and use a separate aggregate query for enrichment.
7. Preserve equivalent functional behavior in memory persistence.
8. Do not add a persisted projection or materialized view unless post-implementation measurements prove the targeted read cannot meet the locked budgets.
9. Preserve existing table behavior: all 12 headers server-sort the complete filtered result, inactive columns start ascending, the second click reverses direction, and sorting resets to page 1.
10. Preserve Previous/Next pagination and page sizes 10, 25, and 50. Filters and page-size changes reset to page 1.
11. Use deterministic tie-breakers so rows do not drift between pages when primary sort values are equal. Preserve existing null and field-order semantics.
12. Move pending source-composition filtering into the validated server query and URL state. Apply it before counting, sorting, pagination, and enrichment aggregation.
13. Primary cache identity must include portfolio context and every semantic primary-query dimension: filters, sort field, direction, page, and page size. Enrichment cache identity includes context and filters but excludes sort and pagination.
14. Reuse the configured route-cache policy rather than hardcoding a separate cache lifetime. Add a Dividends Review cache tag and invalidate it after dividend posting, amendment, reconciliation changes, relevant SSE events, and portfolio-context changes.
15. Exact-query cache results take precedence over skeletons. Fresh matching cache may render immediately; stale-but-usable matching cache renders with a visible refreshing state and revalidates. Never display rows from a different query identity.
16. When no exact cache exists, replace table rows with fixed-height table-local skeletons, mark the table busy, and preserve surrounding filters and page layout.
17. Abort superseded requests. Pagination controls are disabled while their request is pending; sort and filter controls may supersede the pending request.
18. On primary failure, restore the last successfully committed filter, page, URL, and rows, then show a retryable error. Enrichment failure must not blank or disable the primary table.
19. Primary rows use a lightweight table-summary DTO. Persisted ledger drawer details load only when the row is opened and are cached by row ID and version. Synthetic expected rows continue opening from their primary summary. Drawer loading and failure remain local to the drawer.
20. Add `Server-Timing` and structured duration logs for both new endpoints, separating database work, page hydration, aggregate work, and total time.
21. Require repeatable Postgres and browser evidence for cold load, every sortable header in both directions, page 1 → 2 → 1 row identities, page sizes 10/25/50, and a filter change that refreshes primary and enrichment.

## Hard Performance Acceptance Criteria

- Primary API: P95 below 800 ms where realistic.
- Cold Dividends Review usable table: P95 below 2.5 seconds.
- Sort, pagination, page-size, and filter interactions: updated rows within 1.5 seconds P95.
- Loading feedback begins within 100 ms.
- Enrichment is non-blocking and completes within 5 seconds P95.
- No rows from a previous query are presented as belonging to the newly selected query.
- Use at least 20 repeated samples per scenario against the dev Postgres environment after warm-up.
- Do not add ordinary CI wall-clock assertions; shared-runner timing is too unstable. Use deterministic boundary assertions plus recorded local/deployed measurements.

## Out of Scope

- Persisted or materialized Dividends Review projections unless the targeted SQL approach demonstrably misses the budgets.
- Numbered-page navigation or other pagination redesign.
- Multi-column sorting.
- New reconciliation-status ranking semantics.
- Redesign of the wider Dividends page or Calendar tab.
- Changes to eligible-year business semantics.
- General performance work on unrelated routes.

## Implementation Steps

- [x] Define shared primary, enrichment, lightweight row-summary, filter, sort, pagination, and response DTOs. Preserve the combined compatibility response contract.
- [x] Add focused persistence tests that pin current review-row semantics, all 12 sort columns in both directions, stable tie-breakers, pagination identities, filters, totals, and aggregate behavior before replacing the Postgres path.
- [x] Implement the targeted Postgres primary read model without calling the unlimited calendar snapshot. Apply validated filters before expensive row construction and hydrate only the selected page.
- [x] Implement the independent Postgres enrichment aggregate read using the same filter semantics but no sort/page dependency. Add indexes only when `EXPLAIN ANALYZE` evidence justifies them.
- [x] Implement memory-persistence equivalents for primary and enrichment and retain semantic parity with Postgres.
- [x] Add `/portfolio/dividends/review/primary` and `/portfolio/dividends/review/enrichment`; update the compatibility endpoint to compose the optimized reads.
- [x] Wrap both hot reads with `Server-Timing` and structured duration logging. Add route tests for the timing dimensions and verify the primary path does not call the unlimited snapshot implementation.
- [x] Update the web dividend service with primary, enrichment, abort-signal, and lazy row-detail requests.
- [x] Server-fetch initial Review primary data and seed account/year metadata into the page and AppShell where applicable, without blocking on enrichment.
- [x] Add route DTO cache policy support, exact-query primary/enrichment keys, Dividends Review cache tags, and invalidation for writes, SSE, and context switches.
- [x] Refactor Review client state into requested versus committed query state. Implement cache precedence, local skeletons, `aria-busy`, request cancellation, pagination disabling, stale enrichment presentation, retry, and URL/data rollback.
- [x] Move source-composition pending filtering from current-page client filtering into the shared server query and ensure primary totals and enrichment aggregates match it.
- [x] Replace full row-detail primary payloads with table summaries. Add drawer-local lazy loading, row/version detail caching, skeletons, and isolated retry behavior.
- [x] Add web unit/component coverage for initial server data, exact cache hits, stale revalidation, cache misses, rapid superseding sorts, page navigation, rollback after failure, source-composition filtering, and drawer detail loading.
- [x] Add API and Postgres integration coverage for primary/enrichment contracts, memory parity, every sort field and direction, page 1 → 2 → 1 row identities, page sizes 10/25/50, deterministic ties, filtered aggregates, and compatibility behavior.
- [x] Run `/aaa` to add or update E2E tests covering every sortable header, visible loading state, page 1 → 2 → 1 row changes, page-size changes, source-composition filtering, and primary/enrichment failure isolation.
- [x] Measure at least 20 warmed samples for each locked performance scenario against Postgres and capture before/after browser-visible and `Server-Timing` evidence.
- [x] Update `docs/001-architecture/backend-db-api.md`, `docs/001-architecture/web-frontend.md`, and the relevant performance evidence note with the final route map, cache behavior, and measured results.
- [x] Run the smallest relevant tests first, then the repository-required broader regression suites. Do not claim all tests pass unless all eight suites listed in the root `AGENTS.md` are clean.
- [x] Revisit this file after implementation and change each delivered checkbox to `- [x]`; leave any undelivered item unchecked for an explicit carry-forward or scope decision.

## Open Items

None.

## References

- `apps/web/app/dividends/page.tsx`
- `apps/web/components/dividends/DividendsTabsClient.tsx`
- `apps/web/components/dividends/DividendReviewClient.tsx`
- `apps/web/features/dividends/services/dividendService.ts`
- `apps/api/src/routes/registerRoutes.ts`
- `apps/api/src/persistence/postgres.ts`
- `apps/api/src/persistence/memory.ts`
- `apps/web/lib/routeDtoCache.ts`
- `docs/001-architecture/backend-db-api.md`
- `docs/001-architecture/web-frontend.md`
- Scope debate note: none; no debate was required.
- Linear tickets: none provided.
