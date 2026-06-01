# QA Test Strategy: Portfolio Holdings Aggregation

Date: 2026-06-01
Branch: `codex/portfolio-holdings-aggregation`
Scope source: `docs/notes/portfolio-holdings-aggregation/scope-todo-202606011425-holdings-aggregation.md`

## Status

Grouped holdings are implemented for the V1 route surfaces:

- `/dashboard` and `/portfolio` consume grouped `holdingGroups` with parent ticker/market rows and account child rows.
- `/tickers/[ticker]` supports market-scoped aggregate state plus account-scoped child links.
- `/share/[token]` renders public-safe grouped rows without cost basis or account child detail.
- Allocation basis defaults to market value, supports cost basis, and labels missing-quote fallback.

## Added Or Updated Coverage

### API Unit

- `apps/api/test/unit/dashboardHoldingGroups.test.ts`
  - Same ticker/market across accounts aggregates into one parent row.
  - Same bare ticker across markets remains split by market.
  - Reporting-currency translation is applied to grouped rows.
  - Missing quotes fall back to cost basis for allocation and surface fallback metadata.
- `apps/api/test/unit/holdingAllocationBasis.test.ts`
  - Default basis resolution.
  - Stored valid basis passthrough.
  - Invalid preference fallback.

### API HTTP AAA

- `apps/api/test/http/specs/user-preferences-aaa.http.spec.ts`
  - `holdingAllocationBasis` PATCH/GET round trip.
- `apps/api/test/http/specs/dashboard-reporting-currency-aaa.http.spec.ts`
  - Dashboard overview contract includes grouped holdings.
- `apps/api/test/http/specs/anon-public-view-dto-shape-aaa.http.spec.ts`
  - Public share contract includes grouped rows and continues to exclude forbidden private fields.

### Web Unit

- `apps/web/test/features/dashboard/components.test.tsx`
  - Grouped holdings table render, aggregate ticker link, child account link, allocation/chart consumers.
- `apps/web/test/app/tickers/TickerHistoryClient.test.tsx`
  - Aggregate holding summary and account contribution presentation.
- `apps/web/test/app/share/publicSharePage.test.tsx`
  - Public grouped rows and no child-account render.
- `apps/web/test/features/portfolio/services/tickerDetailsService.test.ts`
  - Ticker details service uses market-scoped aggregate data and account breakdown fallback.

### E2E AAA

- `apps/web/tests/e2e/specs/portfolio-holdings-grouping-aaa.spec.ts`
  - Multi-account same-ticker setup.
  - Toolbar filter controls present.
  - Display mode changes grouped/expanded behavior.
  - Parent row expansion shows child account rows.
  - Cost-basis allocation preference persists after reload.
  - Parent ticker link routes to market-scoped ticker view.
  - Child account link routes to account-scoped ticker view.
- `apps/web/tests/e2e/specs/anon-public-view-rendered-aaa.spec.ts`
  - Anonymous public share renders grouped ticker/market rows.
  - Multi-account same ticker reports account count.
  - Public page still hides cost basis and account child rows.

## Focused Validation Run

- `npm run build -w libs/shared-types -w @vakwen/test-e2e -w @vakwen/test-api`
- `npx tsc --noEmit -p apps/api/tsconfig.json --pretty false`
- `npx tsc --noEmit -p apps/api/test/tsconfig.json --pretty false`
- `npx tsc --noEmit -p apps/web/tsconfig.json --pretty false`
- `npx vitest run apps/api/test/unit/dashboardHoldingGroups.test.ts apps/api/test/unit/holdingAllocationBasis.test.ts --reporter=dot`
- `npm run test --prefix apps/web -- test/app/share/publicSharePage.test.tsx test/features/dashboard/components.test.tsx test/app/tickers/TickerHistoryClient.test.tsx test/features/portfolio/services/tickerDetailsService.test.ts --reporter=dot`
- `npx playwright test apps/api/test/http/specs/anon-public-view-dto-shape-aaa.http.spec.ts apps/api/test/http/specs/dashboard-reporting-currency-aaa.http.spec.ts apps/api/test/http/specs/user-preferences-aaa.http.spec.ts --config=apps/api/test/http/playwright.config.ts`
- `npx playwright test apps/web/tests/e2e/specs/anon-public-view-rendered-aaa.spec.ts --config=apps/web/tests/e2e/playwright.config.ts`
- `npx playwright test apps/web/tests/e2e/specs/portfolio-holdings-grouping-aaa.spec.ts --config=apps/web/tests/e2e/playwright.config.ts`

## Remaining Risk Focus For Full Gates

- Full regression may surface assumptions in older E2E specs that expected flat holding-row test ids.
- Full API integration may reveal Postgres-specific persistence differences for the new user preference key.
- Public share full-suite coverage should confirm no accidental cost-basis leakage outside the focused DTO/page tests.
- Full lint may require minor formatting cleanup in newly added grouped table and E2E helper code.
