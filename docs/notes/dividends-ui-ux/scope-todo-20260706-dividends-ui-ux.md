---
slug: dividends-ui-ux
source: scope-grill
created: 2026-07-06
tickets: []
required_reading:
  - docs/notes/ticker-details-sticky-dividends-perf/scope-todo-20260520.md
  - docs/004-notes/ui-bugs-dashboard-dividends/scope-todo-2026051916-dashboard-dividends.md
  - docs/004-notes/kzo-136/scope-todo-202604121200-dividend-review-v2.md
superseded_by: null
---

# Todo: Dividends UI/UX

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Locked Scope

1. Keep this as a focused dividends UX enhancement slice, not a dividend domain rewrite.
2. Redesign `/dividends` first tab as an Overview / Income Operations view.
3. Rename the Calendar tab to Overview.
4. Add active-month server prefetch, one combined calendar endpoint, and `month=YYYY-MM` URL state.
5. Add a direct month picker.
6. Use dense operational UI: summary tiles, action queue, monthly event list, and recent receipts.
7. Mobile Overview order: header/month picker, summary tiles, Needs Action, This Month, Recent Receipts.
8. Add API-enriched ticker display names on dividend surfaces.
9. Add a ticker detail Dividends tab that is always visible.
10. Ticker Dividends tab includes summary cards, Upcoming Events, Posted History, quick `Mark matched`, and deep links to Dividend Review.
11. Keep full post/edit/source composition/explained/resolved workflows in Dividend Review.
12. Preserve `marketCode` in ticker detail links where known.
13. Write a durable dividends redesign plan doc.
14. Validate with the full 8-suite gate plus Browser plugin desktop/mobile checks.

## Implementation Steps

- [x] Reconcile the existing partial draft edits in this worktree; finish them cleanly or replace them deliberately before continuing.
- [x] Add shared/API dividend display metadata fields, including optional ticker display name, dividend ledger entry id for posted rows, reconciliation status, and enough market context for safe ticker links.
- [x] Enrich dashboard, dividend event, dividend ledger/review, and ticker detail dividend mappers with ticker display names from the instrument catalog.
- [x] Update dashboard Dividend Progress cards to render ticker code, ticker display name, and account for upcoming and recent dividend events.
- [x] Add a combined calendar read endpoint that returns events and related ledger entries for a selected month without requiring the client to coordinate two requests.
- [x] Update web dividend services to use the combined calendar endpoint while preserving existing event/ledger services for current callers.
- [x] Add month parsing/query helpers for `month=YYYY-MM`, including fallback to the current month.
- [x] Server-prefetch the active Overview month in `/dividends` and pass the initial snapshot/month into the tabs client.
- [x] Rename the tab label from Calendar to Overview in English and zh-TW i18n.
- [x] Redesign the Overview tab as the Income Operations view: compact header, month picker, summary tiles, monthly grouped event list, Needs Action rail, and Recent Receipts section.
- [x] Implement mobile responsive Overview layout with action-first order and no incoherent text/content overlap.
- [x] Preserve existing post/edit drawer behavior from dividend rows, including dirty-state confirmation and source composition/NHI safeguards.
- [x] Add ticker detail model fields for dividend upcoming/recent arrays instead of reducing them to count/date-only cadence data.
- [x] Add a ticker detail Dividends tab to desktop and mobile tab selectors.
- [x] Implement ticker Dividends summary cards: upcoming count, next payment, last posted, and open reconciliation count.
- [x] Implement ticker Upcoming Events and Posted History sections with compact rows/cards, status badges, currency amounts, account labels, and empty states.
- [x] Add quick `Mark matched` only for open posted ticker dividend rows, with full edit/explained/resolved/source-composition actions deep-linking to Dividend Review.
- [x] Add filtered deep links to `/dividends?view=ledger&ticker={ticker}&marketCode={marketCode}` where market context is known.
- [x] Preserve `marketCode` in ticker-detail links from dashboard/dividend/portfolio contexts where the source row has market context.
- [x] Add a durable redesign plan doc under `docs/notes/dividends-ui-ux/` covering information architecture, Overview tab layout, ticker detail Dividends tab, mobile behavior, loading/error states, performance goals, and future work.
- [x] Update unit tests for dividend query helpers, dashboard dividend display names, calendar snapshot service, ticker detail dividend model mapping, and ticker Dividends tab rendering.
- [x] Update API tests for the combined calendar endpoint, enriched dividend DTO fields, and ticker detail dividend reconciliation metadata.
- [x] Update E2E/page-object coverage for `/dividends` Overview month picker, action queue, responsive mobile layout, Dashboard Dividend Progress display names, and ticker detail Dividends tab quick reconciliation.
- [x] Run Browser plugin validation locally on desktop for `/dashboard`, `/dividends`, `/dividends?month=2026-07`, `/dividends?view=ledger&ticker=2330`, and `/tickers/2330?marketCode=TW`.
- [x] Run Browser plugin validation locally on mobile viewport for `/dividends?month=2026-07` and `/tickers/2330?marketCode=TW`.
- [x] Run the full 8-suite gate before declaring implementation complete:
  - [x] `npx eslint .`
  - [x] `npm run typecheck`
  - [x] `npm run test --prefix apps/web`
  - [x] `npm run test --prefix apps/api`
  - [x] `npm run test:integration:full:host`
  - [x] `npm run test:e2e:bypass:mem --prefix apps/web`
  - [x] `npm run test:e2e:oauth:mem --prefix apps/web`
  - [x] `npm run test:http --prefix apps/api`

## Open Items

- [x] Confirm during implementation whether `marketCode` needs to be accepted by the Dividend Review query schema for deep links, or whether ticker-only filtering is sufficient for the current UI.
- [x] Confirm whether the ticker detail Dividends tab should live before or after Fundamentals once visual implementation is in place.

## Evidence

- Ticket/PR metadata note:
  - No Linear ticket is attached to this scope (`tickets: []`). Commit and PR metadata must use the repository Linear waiver path unless a ticket is supplied before PR creation.
- Focused web checks passed:
  - `npx eslint apps/web/components/dividends/TickerDividendsTab.tsx apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx libs/test-e2e/src/assistants/tickers/TickerDetailActions.ts`
  - `npx tsc --noEmit -p apps/web/tsconfig.json`
  - `cd apps/web && npx vitest run test/features/dividends/DividendCalendarClient.test.tsx test/components/dividends/DividendsTabsClient.test.tsx test/app/tickers/TickerHistoryClient.test.tsx`
- Focused API checks passed:
  - `npx tsc --noEmit -p apps/api/tsconfig.json`
  - `npm run test --prefix apps/api -- test/unit/dashboardDividends.test.ts test/unit/dividendReviewRows.test.ts test/integration/dividends.integration.test.ts`
- Focused E2E checks passed:
  - `npm run test:e2e:bypass:mem --prefix apps/web -- mobile-dividends-ui-ux-aaa.spec.ts`
  - `npm run test:e2e:bypass:mem --prefix apps/web -- dividends-ui-ux-aaa.spec.ts`
- Post team-review fixes:
  - Fixed Overview month preservation when switching Review back to Overview.
  - Fixed Dividend Review `marketCode` query propagation through web query helpers, service calls, API schema, memory persistence, and Postgres persistence.
  - Fixed Overview row review links to use API-supplied event market context instead of currency inference.
  - Fixed Postgres store hydration so instrument display names remain available for dividend display-name enrichment.
  - Hardened ticker mobile tab selection and added row-level Review href coverage for ticker Dividends links.
- Post team-review focused checks passed:
  - `npx tsc --noEmit -p apps/api/tsconfig.json --pretty false`
  - `npx tsc --noEmit -p apps/web/tsconfig.json --pretty false`
  - `npx eslint apps/web/components/dividends/DividendCalendarClient.tsx apps/web/components/dividends/DividendsTabsClient.tsx apps/web/components/dividends/DividendReviewClient.tsx apps/web/components/dividends/TickerDividendsTab.tsx libs/test-e2e/src/pages/tickers/TickerDetailPage.ts libs/test-e2e/src/assistants/tickers/TickerDetailActions.ts libs/test-e2e/src/assistants/tickers/TickerDetailAssert.ts apps/web/tests/e2e/specs/dividends-ui-ux-aaa.spec.ts`
  - `npm run build --prefix libs/test-e2e`
  - `npm run test --prefix apps/api -- test/unit/dividendReviewRows.test.ts test/unit/dashboardDividends.test.ts test/unit/tickerDetails.test.ts test/integration/dividends.integration.test.ts`
  - `cd apps/web && npx vitest run test/components/dividends/DividendsTabsClient.test.tsx test/components/dividends/dividendsPageQuery.test.ts test/features/dividends/dividendService.test.ts test/app/tickers/TickerHistoryClient.test.tsx --config vitest.config.ts`
- Browser plugin local validation passed on `npm run dev:local:bypass:mem` with seeded `user-1` data:
  - Desktop `/dashboard`: Dividend Progress rendered ticker code `7788`, display name `Browser Dividend Systems`, account label, and expected dividend progress.
  - Desktop `/dividends`: Overview tab and direct month picker rendered.
  - Desktop `/dividends?month=2026-07`: month picker value stayed `2026-07`; This Month, Needs Action, and Recent Receipts all rendered ticker display names.
  - Desktop `/dividends?view=ledger&ticker=2330&marketCode=TW`: Review route loaded and preserved both `ticker=2330` and `marketCode=TW`.
  - Desktop `/tickers/2330?marketCode=TW`: Dividends tab was always available and rendered ticker display name `台積電`, summary, posted history, reconciliation, and market-aware ledger links.
  - Mobile `390x844` `/dividends?month=2026-07`: month picker present, Needs Action visually stacked before This Month, and no horizontal overflow.
  - Mobile `390x844` `/tickers/2330?marketCode=TW`: compact tab selector opened Dividends; tab rendered display name, Posted History, Reconciliation, and no horizontal overflow.
- Mockup screenshots generated for the scoped UI surfaces:
  - `docs/notes/dividends-ui-ux/mockups/screenshots/dashboard-progress-desktop.png`
  - `docs/notes/dividends-ui-ux/mockups/screenshots/dashboard-progress-mobile.png`
  - `docs/notes/dividends-ui-ux/mockups/screenshots/dividends-overview-desktop.png`
  - `docs/notes/dividends-ui-ux/mockups/screenshots/dividends-overview-mobile.png`
  - `docs/notes/dividends-ui-ux/mockups/screenshots/ticker-dividends-desktop.png`
  - `docs/notes/dividends-ui-ux/mockups/screenshots/ticker-dividends-mobile.png`
- Final AGENTS gate passed on 2026-07-06 after post team-review fixes and after confirming `origin/dev` stayed at `d72de434`:
  - `git fetch origin dev` plus HEAD/origin checks confirmed `HEAD` and `origin/dev` are both `d72de434`, with `origin/dev` an ancestor of `HEAD`.
  - `git diff --check` passed.
  - `npx eslint .` passed with 6 existing unrelated Playwright conditional-test warnings in AI connector E2E specs.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: 70 files passed; 467 tests passed.
  - `npm run test --prefix apps/api` passed: 191 files passed, 44 skipped; 1942 tests passed, 443 skipped.
  - `npm run test:integration:full:host` passed: 95 files passed; 970 tests passed, 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: 321 passed, 19 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: 121 passed.
  - `npm run test:http --prefix apps/api` passed: 301 passed, 2 skipped.
- Post-PR Codex review fixes:
  - Preserved active `month=YYYY-MM` in Overview-to-Review links so returning from Review restores the selected month.
  - Added review query-key invalidation so opening Review with a different month/ticker/market filter refetches rows instead of reusing stale Review data.
  - Focused validation passed: `npx eslint apps/web/components/dividends/DividendCalendarClient.tsx apps/web/components/dividends/DividendsTabsClient.tsx apps/web/test/features/dividends/DividendCalendarClient.test.tsx apps/web/test/components/dividends/DividendsTabsClient.test.tsx`; `npx tsc --noEmit -p apps/web/tsconfig.json --pretty false`; `cd apps/web && npx vitest run test/features/dividends/DividendCalendarClient.test.tsx test/components/dividends/DividendsTabsClient.test.tsx --config vitest.config.ts`.

## Explicit Out Of Scope

- Full dividend domain or persistence model rewrite.
- Replacing Dividend Review charts/filter architecture.
- Embedding the full `DividendPostingForm` workflow directly inside ticker detail.
- Inline explained/resolved reconciliation with notes inside ticker detail.
- Dividend tax export, forecasting, or annual tax reporting.
- Drag/drop customization for the new Overview sections.

## References

- Hosted routes initially inspected before implementation scoping:
  - `https://vakwen-dev-web.kzokvdevs.dpdns.org/dashboard`
  - `https://vakwen-dev-web.kzokvdevs.dpdns.org/dividends?view=calendar`
  - `https://vakwen-dev-web.kzokvdevs.dpdns.org/dividends?view=ledger`
  - `https://vakwen-dev-web.kzokvdevs.dpdns.org/tickers/2330`
- Post-deployment hosted validation for this implementation is not recorded yet; current Browser evidence is local `dev:local:bypass:mem` validation.
- Relevant web files:
  - `apps/web/app/dividends/page.tsx`
  - `apps/web/components/dividends/DividendsTabsClient.tsx`
  - `apps/web/components/dividends/DividendCalendarClient.tsx`
  - `apps/web/components/dividends/DividendReviewClient.tsx`
  - `apps/web/components/dividends/DividendPostingForm.tsx`
  - `apps/web/components/dashboard/DividendsSection.tsx`
  - `apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx`
  - `apps/web/features/portfolio/services/tickerDetailsService.ts`
  - `apps/web/features/dividends/services/dividendService.ts`
- Relevant API/shared files:
  - `libs/shared-types/src/index.ts`
  - `apps/api/src/routes/registerRoutes.ts`
  - `apps/api/src/services/dashboard.ts`
  - `apps/api/src/services/dividends.ts`
  - `apps/api/src/services/tickerDetails.ts`
  - `apps/api/src/persistence/types.ts`
  - `apps/api/src/persistence/memory.ts`
  - `apps/api/src/persistence/postgres.ts`
