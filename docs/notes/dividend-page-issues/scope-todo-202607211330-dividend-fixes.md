---
slug: dividend-page-issues
source: scope-grill
created: 2026-07-21
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Dividend Page Confirmed Issues

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Revisit this file after implementation and tick only deliverables that were actually completed.

## Goal

Make the dividends page immediately truthful after refresh, lifecycle-correct when posting expected dividends, visually aligned and unambiguous, and capable of filtering multiple eligible portfolio tickers.

## Locked Decisions

1. Paying Today is server-rendered from a targeted persistence read rather than loaded through a client-only full-store request.
2. A hard refresh in the deployed test environment shows the correct Paying Today result within two seconds without flashing a false empty state.
3. Daily-highlight failures are isolated to their cards. The rest of the dividend page remains usable, and retry replaces only the affected card data.
4. During subsequent refreshes, the previous daily-highlight result remains visible with a refresh indicator.
5. An expected dividend row displays **Post**, prefills expected values, and creates a posted ledger entry without treating the expected record as an editable posted entry.
6. Successful posting removes the row from Needs Action, shows it as **Posted** in This Month, changes its action to **Edit**, and refreshes receipt totals and history.
7. Retry safety uses the existing idempotency-key and active-posting conflict protections; no general replay-result subsystem is added.
8. The This Month header and rows share one desktop five-column grid definition. The current stacked mobile presentation remains unchanged.
9. Reconciliation badges visibly identify both component and status, for example **Cash · Matched** and **Stock · Matched**, without relying on color or badge order.
10. The ticker filter is a searchable checkbox dropdown showing ticker and name, sorted by ticker, with a compact selection summary and clear-all action.
11. Eligible ticker metadata comes from the complete dividend-review universe for the selected year and accounts, independent of status filters and pagination. Multiple selections use OR semantics.
12. Multi-ticker URLs use backward-compatible repeated query parameters such as `ticker=2886&ticker=3714`; the API normalizes a single value or repeated values into one ticker array.
13. When year or account filters change, only ticker selections that are no longer eligible are pruned. The URL and review results update immediately.
14. Relevant English and Traditional Chinese labels are updated for posting, reconciliation components, ticker filtering, loading, errors, and retry.
15. Regression coverage uses focused component, API/persistence, E2E, desktop geometry, and deployed-smoke checks.

## Implementation Steps

- [x] Add a targeted daily-highlights persistence read that does not call `loadUserStore` or load unrelated portfolio aggregates.
- [x] Fetch daily highlights independently during server rendering and pass explicit success/error state into the dividends overview.
- [x] Retain the prior daily result during refresh, add a refresh indicator, and add card-level retryable errors without false empty states.
- [x] Normalize expected calendar rows into the new-posting flow, display **Post**, and omit posted-entry edit identifiers from their submission payloads.
- [x] After a successful posting, refresh every affected overview projection so Needs Action, This Month, action labels, receipt totals, and history agree.
- [x] Preserve and test the existing idempotency-key and active-posting conflict safeguards against duplicate active postings.
- [x] Define one reusable desktop grid template for the This Month header and every event row while preserving the mobile layout.
- [x] Render visible component-qualified cash and stock reconciliation badges and add their English and Traditional Chinese translations.
- [x] Extend review metadata and shared types with the complete eligible ticker option set for the selected year and accounts.
- [x] Accept a single or repeated `ticker` query parameter, normalize it into an array, and apply OR filtering without breaking existing single-ticker URLs.
- [x] Build an accessible searchable checkbox dropdown with ticker/name options, compact selection summary, clear-all, immediate URL updates, and invalid-selection pruning.
- [x] Add component regressions for daily loading/error/refresh behavior, expected-row Post payloads, shared grid usage, visible component labels, and ticker multiselect interactions.
- [x] Add API and persistence regressions for targeted daily reads, eligible ticker metadata, repeated ticker parsing, and multi-ticker OR filtering.
- [x] Run `/aaa` to add or update E2E tests for the expected-row posting and multi-ticker review flows agreed in this scope.
- [x] Add a desktop browser geometry assertion that header and row column starts align within one pixel at the existing desktop breakpoint.
- [ ] Validate Paying Today after a hard refresh against the deployed test environment and record evidence that the correct state appears within two seconds.
- [x] Run the smallest focused checks first, then the repository's complete eight-suite test gate before claiming that all tests pass.

## Acceptance Criteria

- [ ] Paying Today is correct on the first rendered overview, never flashes a false empty message, and meets the two-second deployed smoke target.
- [x] A daily-highlight failure leaves the calendar usable and exposes a working card-level retry.
- [x] Posting a deterministic expected-row fixture with received cash and an additional bank-fee deduction succeeds through the create/post path.
- [x] After posting, all affected overview cards reflect one active posted entry with the recorded deduction and no duplicate posting.
- [x] Every This Month desktop column header aligns with the corresponding row values within one pixel.
- [x] Cash and stock reconciliation results remain distinguishable when both statuses have the same value.
- [x] The ticker dropdown lists the complete eligible year/account universe, supports multiple OR selections, preserves old single-ticker URLs, and prunes only invalid selections.
- [x] English and Traditional Chinese experiences remain complete and accessible.
- [x] Focused regressions pass, and any statement that all tests pass is backed by all eight repository suites.

## Out of Scope

- Dividend reversal or replacement support.
- Retirement of the legacy corporate-action dividend endpoint.
- Stock-dividend lot-model changes.
- A general dividend-page redesign.
- Multi-market ticker-identity changes.
- Broad caching or idempotency infrastructure.

## Open Items

None.

## Local-Only Design Reference

Proposed-state mockups were reviewed during scoping but contain live portfolio data, so they are intentionally excluded from version control. The numbered decisions and acceptance criteria above are the implementation source of truth. Any local visual-validation artifacts must remain under gitignored `.worklog/` paths.

## Implementation Evidence

- Targeted daily-highlight reads are implemented in persistence and route layers without the old full-store read path:
  - `apps/api/src/persistence/memory.ts`
  - `apps/api/src/persistence/postgres.ts`
  - `apps/api/src/routes/registerRoutes.ts`
- Server rendering now fetches daily highlights independently and passes explicit success/error state into the calendar overview:
  - `apps/web/app/dividends/page.tsx`
  - `apps/web/test/app/dividends/dividendsPage.test.tsx`
- Card-level retained-data, retry, and refreshing behavior landed in the calendar client:
  - `apps/web/components/dividends/DividendCalendarClient.tsx`
  - `apps/web/test/features/dividends/DividendCalendarClient.test.tsx`
- Expected rows now use the create/post flow and omit posted-entry edit identifiers:
  - `apps/web/components/dividends/DividendPostingForm.tsx`
  - `apps/web/test/features/dividends/DividendPostingForm.test.tsx`
- Review metadata, repeated `ticker` params, OR semantics, eligible ticker options, and pruning logic landed across shared types, API normalization, and the review client:
  - `libs/shared-types/src/index.ts`
  - `apps/web/components/dividends/dividendsPageQuery.ts`
  - `apps/web/features/dividends/services/dividendService.ts`
  - `apps/web/components/dividends/DividendReviewClient.tsx`
  - `apps/api/test/integration/dividends.integration.test.ts`
  - `apps/api/test/integration/dividendReadModelsPostgres.integration.test.ts`
- Focused E2E coverage and helper support were added for resilience, posting, multiselect filtering, badge clarity, accessibility, and desktop geometry:
  - `apps/web/tests/e2e/specs/dividend-improvements-aaa.spec.ts`
  - `apps/web/tests/e2e/specs/dividend-review-aaa.spec.ts`
  - `libs/test-e2e/src/assistants/dividend-review/DividendReviewActions.ts`
  - `libs/test-e2e/src/assistants/dividend-review/DividendReviewAssert.ts`
  - `libs/test-e2e/src/assistants/dividends/DividendsActions.ts`
  - `libs/test-e2e/src/assistants/dividends/DividendsAssert.ts`

## Focused Validation Evidence

- Tuesday, July 21, 2026 authoritative worktree reruns recorded in `.worklog/team/qa-issue-ledger.md`:
  - `npx eslint apps/web/tests/e2e/specs/dividend-improvements-aaa.spec.ts apps/web/tests/e2e/specs/dividend-review-aaa.spec.ts libs/test-e2e/src/assistants/dividend-review/DividendReviewActions.ts libs/test-e2e/src/assistants/dividend-review/DividendReviewAssert.ts libs/test-e2e/src/assistants/dividends/DividendsActions.ts libs/test-e2e/src/assistants/dividends/DividendsAssert.ts libs/test-e2e/src/pages/dividends/DeductionSubFormComponent.ts libs/test-e2e/src/pages/dividends/DividendCalendarPage.ts libs/test-e2e/src/pages/dividends/DividendReviewPage.ts` -> pass with 0 errors and 33 existing Playwright warnings.
  - `npm run build -w @vakwen/test-framework` -> pass.
  - `npm run build -w @vakwen/test-e2e` -> pass.
  - `NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL:-http://localhost:${API_PORT:-4000}} npm run build -w @vakwen/web` -> pass.
  - `npx playwright test apps/web/tests/e2e/specs/dividend-improvements-aaa.spec.ts -g "dividend review filters" --config=apps/web/tests/e2e/playwright.config.ts --repeat-each=5 --retries=0 --workers=1` -> `5 passed (40.8s)`.
  - `npx playwright test apps/web/tests/e2e/specs/dividend-improvements-aaa.spec.ts -g "dividend overview resilience|dividend overview posting|dividend review filters|dividend review statuses|dividend overview layout|dividend review a11y" --config=apps/web/tests/e2e/playwright.config.ts --workers=1` -> `6 passed (25.2s)`.
  - `git diff --check` -> pass.
- These focused reruns support the checked implementation items above.
- The repository-wide eight-suite gate passed in the worktree after the final compatibility and deterministic-date fixes:
  - `npx eslint .` -> pass with 0 errors (44 existing warnings).
  - `npm run typecheck` -> pass.
  - `npm run test --prefix apps/web` -> pass.
  - `npm run test --prefix apps/api` -> pass: 2,141 passed and 485 skipped.
  - `npm run test:integration:full:host` -> pass: 1,102 passed and 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` -> pass: 413 passed and 20 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` -> pass: 121 passed.
  - `npm run test:http --prefix apps/api` -> pass: 312 passed and 2 skipped.
- A final `npx eslint . && npm run typecheck` rerun also passed after the last source and test edits.
- The deployed hard-refresh two-second smoke remains intentionally unverified here. The opt-in deployed check exists in `apps/web/tests/e2e/specs/dividend-improvements-aaa.spec.ts`, but no deployment was authorized or available for this documentation pass.

## References

- Relevant frontend: `apps/web/app/dividends/page.tsx`, `apps/web/components/dividends/DividendCalendarClient.tsx`, `apps/web/components/dividends/DividendPostingForm.tsx`, `apps/web/components/dividends/DividendReviewClient.tsx`
- Relevant backend: `apps/api/src/routes/registerRoutes.ts`, `apps/api/src/services/dividends.ts`, `apps/api/src/persistence/postgres.ts`
- Shared contracts: `libs/shared-types/src/index.ts`
- Local-only visual references: `.worklog/scopes/dividend-page-issues/mockups/` (gitignored; never stage or commit)
