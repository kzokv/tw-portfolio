# Dividend Stock Calculation Validation Ledger

Scope: `scope-todo-202607171217-dividend-stock-calculation.md`

| Area | First-pass finding | Resolution | Evidence |
| --- | --- | --- | --- |
| Review DTO | An unavailable expected-stock quantity could be coerced from `null` to `0` in the drawer. | Preserve `null` through normalization and render an em dash with Needs calculation. | Focused Review component tests and browser captures 13/14. |
| Stock reconciliation | An existing explanation note could not be cleared. | Accept explicit `null` across route, persistence, and client semantics while preserving omitted values. | Dividend integration test for set-then-clear. |
| Postgres/MCP types | Nullable calculation and provider fields were assumed to be present in two backend paths. | Corrected nullable contracts and hydration handling. | API TypeScript build and full memory-backed API suite. |
| E2E fixtures | New provider metadata and split reconciliation fields were missing from test fixture shapes. | Extended the dividend arrange helper and review fixture records. | Monorepo typecheck. |
| Review copy | Received stock displayed a calculation-needed count, and raw `unresolved` language remained visible. | Limit calculation-needed counts to expected stock; use `150 shares`, `Needs calculation`, and `1 event needs calculation`. | Desktop/mobile Browser validation and focused Review tests. |
| Settings deep link | Focus waited for the settings GET, making navigation depend on network timing. | Focus and scroll the section as soon as it mounts; load the setting independently. | Settings component test and full dividend E2E spec. |
| New-tab E2E | Multiple SSE streams exhausted the HTTP/1.1 test connection pool, and assertions raced save/refresh responses. | Block SSE only in that scenario, reset retry state, and wait for PATCH and return-focus GET completion. | `dividend-improvements-aaa.spec.ts`: 6 passed. |
| Postgres full-store round trip | `saveStore` did not persist active calculation versions, so a custom 0.5 calculation fell back to the provider-derived quantity. | Persist calculation versions before ledger rows, deactivate omitted versions, and restore ledger links after both sides exist. | Managed Postgres read-model and migration integration tests. |
| Undated expected detail | Targeted Review detail lookup inherited the default dated-list boundary and returned `null` for a materialized undated expectation. | Use an explicit minimum date only for the targeted detail read while retaining the list default. | Managed Postgres read-model integration test. |
| Read-only calculation details | Shared viewers could open a stock calculation drawer through a button labeled Edit/Post. | Keep stock calculation facts inspectable, label the action View details, and suppress cash-only drawers that contain no read-only detail. | Focused calendar component tests and full dev-bypass E2E. |
| E2E row identity | The Review page object treated new `review-row-…-open` action buttons as rows because its selector matched the shared prefix. | Restrict the page-object row locator to actual rows and exclude action controls. | Focused sort test and full 419-case dev-bypass E2E. |
| Split-status test contracts | E2E assertions still targeted legacy Status/Open Items controls and expected Open for stock variance. | Target Cash status, Needs Attention, and the independent Stock status Variance label. | Focused eight-case regression run and full dev-bypass E2E. |
| Shared account settings | Existing E2E expected a permission wall, but the locked scope intentionally exposes account dividend defaults read-only without `account:manage`. | Assert visible disabled account controls and preserve write/delete gating; keep hard purge owner-only. | Focused shared-context E2E and full dev-bypass E2E. |
| Reset-state integration fixture | The unresolved-provider assertion re-saved its confirmed custom calculation, so 105 resolved shares correctly remained active. | Exercise the real reset operation, then assert unavailable `null` expected shares and Needs calculation. | Final managed Postgres integration run. |

## Verified Commands

- `npx eslint .` (0 errors; 37 Playwright conditional-test warnings)
- `npm run typecheck`
- `npm run test --prefix apps/api` (201 files passed, 2,127 tests passed; 49 files and 481 Postgres-dependent tests skipped by this suite)
- `npm run test:integration:full:host` (103 files passed; 1,091 tests passed; 1 skipped)
- `npm run test --prefix apps/web` (169 files passed; 1,155 tests passed across both phases)
- `npm run test:e2e:bypass:mem --prefix apps/web` (400 passed; 19 skipped)
- `npm run test:e2e:oauth:mem --prefix apps/web` (121 passed)
- `npm run test:http --prefix apps/api` (310 passed; 2 skipped)
- Focused dividend and settings Vitest scopes
- `npx playwright test --config=tests/e2e/playwright.config.ts specs/dividend-improvements-aaa.spec.ts` (6 passed)
- Focused E2E regressions for Review filters/enrichment, read-only accounts, and stock variance (8 passed)
- `npx playwright test --config=test/http/playwright.config.ts specs/dividends-aaa.http.spec.ts` (7 passed)
- `npm run build --prefix apps/web`
- Browser validation at 1536x1024 and 390x844

All eight repository-required suites are green.
