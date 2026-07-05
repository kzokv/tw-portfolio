---
slug: etpmag-eodhd-fallback
source: scope-grill
created: 2026-07-05
tickets: []
required_reading: []
superseded_by: null
---

# Todo: ETPMAG EODHD Fallback

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Build a generic quote fallback policy system, not an ETPMAG hardcode.
- Add EODHD EOD as the only implemented fallback provider in v1.
- Keep the schema and UI multi-market, but validate and enable only AU initially.
- Store the EODHD API key as encrypted Admin Settings config with env fallback.
- Add a configurable EODHD daily call limit, defaulting to 20, with strict local budget enforcement.
- Manage per-ticker fallback policies from Admin Market Data instrument detail.
- Store editable provider symbols, such as `ETPMAG.AU`, with app-suggested defaults.
- Refresh fallback snapshots after market close using existing calendar/session helpers.
- Never call EODHD from normal dashboard or portfolio reads.
- Use cached EODHD raw `close` as the trusted valuation source while a policy is active.
- Suppress Yahoo intraday and Yahoo daily display price for active fallback policies.
- Keep normal daily bars and historical reports untouched in v1.
- Show fallback source and freshness to normal users via the existing price-state chip.
- Keep policy controls admin-only.
- If fallback daily change is stale or unavailable, mark portfolio aggregate daily change stale/unavailable rather than computing a partial total.
- Make policies global market-data configuration across all accounts and portfolios.
- Do not seed `ETPMAG.AU`; create it through the new UI after deployment.
- Audit admin policy changes and manual refreshes; log scheduled refresh outcomes as market-data activity.

## Implementation Steps

- [x] Add DB tables for fallback policies, snapshots, EODHD budget usage, and required persistence methods.
- [x] Add EODHD encrypted API key and daily call limit to app config, API schema, shared DTOs, and Admin Settings UI.
- [x] Implement an EODHD EOD provider adapter using one short-range EOD call per policy refresh.
- [x] Implement a separate fallback-refresh worker using existing market calendar/session close-date helpers.
- [x] Integrate fallback snapshot selection into the quote snapshot and valuation path ahead of Yahoo intraday and Yahoo daily display price.
- [x] Extend the price-state DTO, i18n, and chip tooltip for EODHD EOD fallback, stale/error states, provider symbol, and market date.
- [x] Add Admin Market Data policy UI for create, edit, deactivate, manual refresh, and status viewing.
- [x] Add audit and market-data activity events for admin changes and refresh outcomes.
- [x] Add focused unit and integration tests for provider, budget, worker, quote selection, daily-change behavior, and admin APIs.
- [x] Run `/aaa` to add or update E2E tests covering the new admin UI and fallback visibility flow.

## Open Items

- [ ] None.

## References

- Mockup screenshots generated from the HTML source with Playwright on 2026-07-05 and visually spot-checked.
- Mockup HTML: `docs/notes/etpmag-eodhd-fallback/etpmag-eodhd-fallback-mockup.html`
- Admin Market Data mockup: `docs/notes/etpmag-eodhd-fallback/mockup-admin-market-data-fallback-policy.png`
- Admin Settings mockup: `docs/notes/etpmag-eodhd-fallback/mockup-admin-settings-eodhd-budget.png`
- Portfolio price chip mockup: `docs/notes/etpmag-eodhd-fallback/mockup-portfolio-eodhd-price-chip.png`
- Scope debate note: none.
- Linear tickets: none.

## Verification

- `npm run build -w @vakwen/shared-types -w @vakwen/config` — passed.
- `npm run build --prefix apps/api` — passed.
- `npx eslint .` — passed with 0 errors and 6 pre-existing Playwright conditional warnings in unrelated E2E specs.
- `npm run typecheck` — passed.
- `npm run test --prefix apps/api` — passed: 190 files passed, 44 skipped, 1924 tests passed, 439 skipped.
- `npm run test --prefix apps/web` — passed: Vitest batches reported 68 files / 477 tests and 69 files / 464 tests.
- `npm run test:integration:full:host` — passed: 95 files, 964 tests, 1 skipped.
- `npm run test:e2e:bypass:mem --prefix apps/web` — passed: 316 tests, 20 skipped.
- `npm run test:e2e:oauth:mem --prefix apps/web` — passed: 121 tests.
- `npm run test:http --prefix apps/api` — passed: 301 tests, 2 skipped.
- `npx eslint apps/web/components/admin/AdminMarketDataClient.tsx apps/web/tests/e2e/specs/quote-fallback-eodhd-aaa.spec.ts apps/web/tests/e2e/specs/mobile-quote-fallback-eodhd-aaa.spec.ts` — passed.
- `NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 npm run build -w @vakwen/config -w @vakwen/test-framework -w @vakwen/test-e2e -w @vakwen/web && npx playwright test tests/e2e/specs/quote-fallback-eodhd-aaa.spec.ts --config=tests/e2e/playwright.config.ts --project=chromium --reporter=list` — after fixes, passed: 2 tests.
- `NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 npx playwright test tests/e2e/specs/mobile-quote-fallback-eodhd-aaa.spec.ts --config=tests/e2e/playwright.config.ts --project=chromium-mobile --reporter=list` — passed: 1 test.
- Focused API and web unit/integration tests for the EODHD provider, fallback refresh service, admin fallback routes, quote snapshot selection, price-state mapping, Admin Settings UI, Admin Market Data UI, and admin market data service passed before the broader suites above.
- Validation issues fixed during `/aaa` E2E:
  - Admin fallback save status was cleared immediately after row state updated; fixed by keying drawer fallback-form reset to the selected `(marketCode, ticker)` instead of every selected row object update.
  - AU portfolio E2E seeding used the default TWD account for an AUD trade; fixed by seeding an AUD account for the AU holding.
  - Portfolio chip route mock targeted `/dashboard/enrichment` and read initial primary data too early; fixed by mocking `/portfolio/enrichment` and waiting for the chip's enriched fallback text.
