---
slug: dividend-calendar-race-performance
source: scope-grill
created: 2026-07-07
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Dividend Calendar Race And Performance Fix

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Fix dividends overview month navigation with responsive latest-wins behavior.
- Keep previous, next, and direct month picker controls usable while loading.
- Abort or ignore stale month requests so older responses cannot reset the picker, snapshot, loading state, error state, URL state, or parent snapshot state.
- Slim `/portfolio/dividends/calendar` with a dedicated lightweight backend calendar snapshot path.
- Exclude `payment_date IS NULL` TBD rows from month-scoped overview responses by default.
- Keep `/portfolio/dividends/review` behavior unchanged.
- Treat the observed production RSC/internal error as a post-fix Browser validation gate. Escalate to separate server-log debugging only if it persists after this fix.
- Exclude broader dividends redesign from this bugfix.

## Implementation Steps

- [x] Add `AbortSignal` support to `fetchDividendCalendarSnapshot` and the underlying dividend calendar service call.
- [x] Add request sequencing/latest-wins protection in `DividendCalendarClient`.
- [x] Abort superseded month requests when a newer month target is selected.
- [x] Ignore `AbortError` so canceled requests do not show user-facing errors.
- [x] Ensure stale requests cannot update snapshot, loading state, error state, URL state, or `onSnapshotChange`.
- [x] Preserve cumulative rapid navigation: `2026-07` plus three previous clicks must land on `2026-04`.
- [x] Add unit tests for out-of-order month responses and rapid July-to-April navigation.
- [x] Add a dedicated lightweight calendar snapshot persistence method for month-scoped events plus matching active ledger entries.
- [x] Update `/portfolio/dividends/calendar` to use the lightweight method instead of review-oriented ledger listing aggregates.
- [x] Exclude unrelated TBD rows from default month-scoped calendar responses.
- [x] Add API/persistence tests for April 2026 and January 2026 month filtering, including no unrelated TBD rows.
- [x] Keep `/portfolio/dividends/review` tests passing unchanged.
- [x] Run focused web and API tests for dividend calendar behavior.
- [x] Run Browser validation on the deployed or local validated target for July to April rapid navigation.
- [x] Run Browser validation for direct January 2026 month picker selection.
- [x] If the RSC/internal error or `Failed to fetch` still reproduces after the fix, open a follow-up debugging scope using API/deploy logs.
- [x] Add or update E2E coverage for the dividends overview month picker flow if practical in the existing suite.

## Open Items

- [ ] Decide in a follow-up whether TBD dividend rows need a separate explicit UI surface. This is out of scope for the current bugfix unless existing tests require preserving a TBD section.

## References

- Browser validation showed slow month navigation, stale month state, `Failed to fetch`, and a production Server Components render error.
- Client race site: `apps/web/components/dividends/DividendCalendarClient.tsx`
- Parent snapshot/month sync site: `apps/web/components/dividends/DividendsTabsClient.tsx`
- Calendar route: `apps/api/src/routes/registerRoutes.ts`
- Dividend event query: `apps/api/src/persistence/postgres.ts`

## Validation Evidence

- Focused API: `cd apps/api && npx vitest run test/integration/dividends.integration.test.ts test/unit/dividendReviewRows.test.ts test/integration/dividendCalendarSnapshot.integration.test.ts --silent` passed 21 tests, with the Postgres-only snapshot spec skipped in memory mode.
- Focused web unit: `cd apps/web && npx vitest run test/features/dividends/DividendCalendarClient.test.tsx test/features/dividends/dividendService.test.ts test/components/dividends/DividendsTabsClient.test.tsx` passed 15 tests.
- Scoped lint: `npx eslint apps/web/components/dividends/DividendCalendarClient.tsx apps/web/features/dividends/services/dividendService.ts apps/web/test/features/dividends/DividendCalendarClient.test.tsx apps/web/test/features/dividends/dividendService.test.ts libs/test-e2e/src/pages/dividends/DividendCalendarPage.ts libs/test-e2e/src/assistants/dividends/DividendsActions.ts libs/test-e2e/src/assistants/dividends/DividendsAssert.ts apps/web/tests/e2e/specs/dividend-calendar-aaa.spec.ts` passed.
- Type/build: `npm run build -w @vakwen/test-e2e && npx tsc --noEmit -p apps/web/tsconfig.json` passed.
- Focused E2E: `cd apps/web && NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 npx playwright test --config=tests/e2e/playwright.config.ts specs/dividend-calendar-aaa.spec.ts -g "month navigation"` passed.
- Browser validation on local `dev_bypass` memory stack: seeded 2330 TSMC Jan/Apr/Jul 2026 paid events plus a TBD event; rapid July 2026 to April 2026 navigation landed on `2026-04`, showed `Apr 20, 2026` and `2330 TSMC`, did not show June data, and produced no console or API errors.
- Browser validation on local `dev_bypass` memory stack: direct January 2026 load showed `2026-01`, `Jan 20, 2026`, and `2330 TSMC`, with no internal error or `Failed to fetch`.
- Managed Postgres integration: `npm run test:integration:full:host` passed 96 files, 976 tests, 1 skipped; the new `dividendCalendarSnapshot.integration.test.ts` Postgres specs passed.
- Full web unit: `npm run test --prefix apps/web` passed.
- Full API package tests: `npm run test --prefix apps/api` passed 191 files, 1946 tests, 445 skipped.
- Full dev-bypass E2E: `npm run test:e2e:bypass:mem --prefix apps/web` passed 322 tests, 19 skipped. The run exposed a stale TBD-section assertion, which was updated to match the locked scope that excludes `payment_date IS NULL` rows from month-scoped overview responses.
- Full OAuth E2E: `npm run test:e2e:oauth:mem --prefix apps/web` passed 121 tests.
- Full API HTTP OAuth: `npm run test:http --prefix apps/api` passed 301 tests, 2 skipped.
- Final full lint: `npx eslint .` exited 0 with six unrelated pre-existing warnings in AI connector E2E specs.
- Final full typecheck: `npm run typecheck` passed.
- Diff hygiene: `git diff --check` passed.
- Codex review follow-up: `cd apps/web && npx vitest run test/features/dividends/DividendCalendarClient.test.tsx test/components/dividends/TickerDividendsTab.test.tsx` passed 9 tests after counting scheduled unposted events as action items and showing TBD payment-date summary copy for upcoming ticker dividends.
- Codex review follow-up lint: `npx eslint apps/web/components/dividends/DividendCalendarClient.tsx apps/web/components/dividends/TickerDividendsTab.tsx apps/web/test/features/dividends/DividendCalendarClient.test.tsx apps/web/test/components/dividends/TickerDividendsTab.test.tsx` passed.
- Codex review follow-up typecheck: `npm run typecheck` passed.
