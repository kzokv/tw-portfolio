---
slug: price-color-convention
source: scope-grill
created: 2026-06-21
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Price Color Convention

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope
- Store the user-level preference in `/user-preferences`.
- Use preference key `priceColorConvention`.
- Support values `gain_green_loss_red` and `gain_red_loss_green`.
- Default unset behavior remains `gain_green_loss_red`.
- Use user-facing labels `Green gains, red losses` and `Red gains, green losses`.
- Apply only to signed price and finance direction values: gains, losses, P&L, returns, quote changes, and daily changes.
- Do not recolor absolute prices, market value, cost basis, status colors, BUY/SELL pills, cash ledger direction, errors, warnings, destructive actions, or neutral/categorical chart series.
- Put the control in `/settings/display` as `Gain/loss colors`.
- Apply changes immediately after save, without requiring a page refresh.
- Include directional chart series only when the series explicitly represents gain/loss, return, or change.
- Do not change financial data semantics, API DTO meanings, stored values, exports, or calculations.

## Implementation Steps
- [x] Add shared `priceColorConvention` constants, type, default, and Zod schema.
- [x] Extend `/user-preferences` PATCH validation for `priceColorConvention`.
- [x] Add a read-side resolver/default helper for the saved preference.
- [x] Add the `/settings/display` `Gain/loss colors` control with immediate save.
- [x] Add a client-side provider or equivalent hydration path so the convention applies without refresh.
- [x] Centralize signed finance tone mapping for both supported conventions.
- [x] Refactor dashboard hero, holdings preview, biggest movers, and return-card signed finance colors.
- [x] Refactor portfolio holdings table and mobile/detail signed finance colors.
- [x] Refactor reports holdings and P&L summary signed finance colors.
- [x] Refactor ticker history quote change and P&L card signed finance colors.
- [x] Refactor transaction history realized P&L signed finance colors.
- [x] Update directional chart series that explicitly represent gain/loss, return, or change.
- [x] Add API validation/unit tests.
- [x] Add UI/component tests proving both color conventions render correctly.
- [x] Run `/aaa` to add or update E2E tests covering the settings flow.

## Open Items
- [x] During implementation, inventory exact signed finance call sites and keep any newly discovered changes within the locked boundary.

## Implementation Evidence
- Shared contract: `libs/shared-types/src/index.ts` now exports `PRICE_COLOR_CONVENTIONS`, `PriceColorConvention`, `priceColorConventionSchema`, and `DEFAULT_PRICE_COLOR_CONVENTION`.
- API contract: `/user-preferences` accepts, persists, clears, and rejects `priceColorConvention` through the same top-level JSONB preference patch path.
- Frontend hydration: `AccentApplier` and `/settings/display` apply `applyPriceColorConvention()` to root `--finance-gain`, `--finance-loss`, `--chart-direction-positive`, and `--chart-direction-negative` variables.
- Finance tone mapping: signed finance text/surface/dot helpers are centralized in `apps/web/components/holdings/holdingsStyle.ts`.
- In-scope UI surfaces refactored: dashboard hero/holdings preview/movers/return cards, portfolio holdings signed daily/P&L values, reports signed holdings/P&L values, ticker quote/P&L values, transaction realized P&L, and directional return/change chart lines.
- Boundary inventory: remaining hard-coded success/destructive/emerald/rose hits are status, errors, warnings, BUY/SELL pills, absolute price comparison, destructive actions, and other excluded surfaces.

## Validation Evidence
- Full AGENTS gate suite:
  - `npx eslint .` — passed after final E2E helper update.
  - `npm run typecheck` — passed after final E2E helper update.
  - `npm run test --prefix apps/web` — passed, 61 files / 417 tests.
  - `npm run test --prefix apps/api` — passed, 172 files / 1710 tests / 431 skipped.
  - `npm run test:integration:full:host` — passed, 91 files / 885 tests / 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` — first full pass found the dashboard assertion issue below; rerun passed, 293 tests / 17 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` — passed, 120 tests.
  - `npm run test:http --prefix apps/api` — passed, 296 tests / 2 skipped.
- `npm run typecheck` — passed.
- `npm run test --prefix apps/api -- userPreferences` — passed, 19 tests.
- `npm run test --prefix apps/api -- test/integration/user-preferences.integration.test.ts` — passed memory-backed parity slice, 14 passed / 35 Postgres-gated skipped.
- `npm run build -w @vakwen/config -w @vakwen/test-framework -w @vakwen/test-api && npx playwright test test/http/specs/user-preferences-aaa.http.spec.ts --config test/http/playwright.config.ts` from `apps/api` — passed, 25 tests.
- `npx vitest run test/components/settings/DisplayTabSection.test.tsx test/lib/theme.priceColorConvention.test.ts test/components/reports/ReportsClient.test.tsx test/app/tickers/TickerHistoryClient.test.tsx` from `apps/web` — passed, 41 tests.
- `NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 npm run build -w @vakwen/config -w @vakwen/test-framework -w @vakwen/test-e2e -w @vakwen/web` — passed.
- `NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 npx playwright test tests/e2e/specs/settings-aaa.spec.ts --config=tests/e2e/playwright.config.ts --project=chromium` from `apps/web` — passed, 3 tests including desktop save/persist and mobile reload visibility.

## Failed-First Issues Recorded
- Broad web component run initially failed because the worktree had no installed `recharts` dependency; fixed by running `npm install` before rerunning focused chart-related tests.
- The first settings E2E run failed because the test expected raw CSS custom-property aliases while Chromium resolves them to HSL channel values; fixed the test to compare resolved browser channels and reran the full settings spec successfully.
- The first full `test:e2e:bypass:mem` run failed because `dashboard-daily-change-aaa` still expected legacy green/success classes while the app now emits `text-[hsl(var(--finance-gain))]`; fixed the dashboard E2E assertion helper/spec to use the finance gain token and reran the targeted dashboard spec plus the full standard E2E gate successfully.

## References
- Worktree: `/Users/lume/repos/tw-portfolio/.worktrees/codex/user-settings-price-color-format`
- Branch: `codex/user-settings-price-color-format`
