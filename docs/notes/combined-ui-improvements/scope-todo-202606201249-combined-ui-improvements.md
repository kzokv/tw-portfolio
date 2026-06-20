---
slug: combined-ui-improvements
source: scope-grill
created: 2026-06-20
tickets: []
required_reading:
  - docs/notes/realized-pnl-breakdown/scope-todo-20260618-realized-pnl-breakdown.md
superseded_by: null
---

# Todo: Combined UI Improvements

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Keep the prior realized P&L breakdown UI scope in this combined PR.
- Admin Market Data tables: add row-tap drawers for Instruments, Activity, generic Operations, and KR Operations.
- Admin Market Data tables: add sticky identity columns and persisted column order, visibility, width, and mobile summary settings under `adminMarketDataTableSettings`.
- Remove Operations tab auto-open behavior; no drawer should open until the user taps a row.
- AI Connectors: redesign into responsive tabs for Connections, MCP Tools, Access Log, and compact policy/status.
- AI Connectors: on mobile, render the connector sub-tabs as a dropdown-style selector instead of a horizontal tab strip.
- AI Connectors: show the active ChatGPT connector first; collapse revoked connectors by default.
- MCP Tools is the only searchable and toggleable tool surface; remove the duplicated connection-tool inventory.
- Public share: limit the fix to preventing anonymous public share links from redirecting to login.
- Value animations: use rolling digit style for quote-refresh-driven dashboard and portfolio market values.
- Value animations: respect reduced-motion fallback and exclude reports, charts, and public share.

## Implementation Steps

- [x] Reconcile the prior realized P&L breakdown deliverables from `docs/notes/realized-pnl-breakdown/scope-todo-20260618-realized-pnl-breakdown.md` into the combined PR plan.
- [x] Add `RealizedPnlBreakdownDto` to shared transaction types with available and unavailable variants.
- [x] Add a backend read-model helper that derives weighted-average realized P&L breakdowns by replaying account/ticker/market trades.
- [x] Include pre-sale open quantity, pre-sale open cost, exact average cost/share, rounded average used, allocated cost, gross proceeds, commission, tax, net proceeds, and realized P&L in the available breakdown variant.
- [x] Return unavailable realized P&L breakdown reasons such as `insufficient_quantity`, `currency_mismatch`, `unsupported_cost_basis_method`, and `unknown`.
- [x] Reuse the backend breakdown helper in `/portfolio/transactions` and ticker details transaction DTO mapping.
- [x] Add row-level realized P&L breakdown UI for `TransactionHistoryTable`.
- [x] Add row-level realized P&L breakdown UI for `RecentTransactionsCard`, including dashboard usage.
- [x] Add weighted-average notes to `/transactions` and ticker transaction history only; keep dashboard compact with row trigger only.
- [x] Ensure BUY rows render no realized P&L breakdown trigger.
- [x] Add `adminMarketDataTableSettings` shared preference schema and persistence support without overloading `holdingsTableSettings`.
- [x] Extract or generalize the holdings column settings primitives so admin tables can reuse the column order, visibility, width, and mobile summary interactions.
- [x] Update Instruments with sticky ticker column, configurable desktop columns, mobile summary fields, row-tap drawer, and drawer detail rows for full instrument metadata and controls.
- [x] Update Activity with sticky identity column, configurable desktop columns, mobile summary fields, and row-tap drawer polish.
- [x] Update generic Operations with sticky operation column, configurable desktop columns, mobile summary fields, row-tap drawer, and no initial selected operation.
- [x] Update KR Operations to match the generic Operations table/drawer UX.
- [x] Redesign AI Connectors into responsive tabs with compact policy/status, Connections, MCP Tools, and Access Log.
- [x] Render AI Connectors mobile sub-tabs as a dropdown-style selector so Connections, MCP Tools, Access Log, and Policy stay reachable without horizontal overflow.
- [x] In Connections, show active ChatGPT first and keep revoked/expired connectors collapsed by default.
- [x] Move MCP tool search, filters, availability/status display, and per-tool toggles into the MCP Tools tab as the single source of truth.
- [x] Remove duplicated per-connection tool inventory from connector cards.
- [x] Fix anonymous public share login redirects, likely by skipping authenticated preference hydration on `/share` and `/share/*`.
- [x] Add a reusable rolling digit value animation component with reduced-motion fallback.
- [x] Wire rolling digit animation only to quote-refresh-driven dashboard hero market value/daily change, dashboard market strip values, portfolio holdings market-value cells, and dashboard holdings preview market-value cells.
- [x] Cap or coalesce table-row animations so clustered quote refreshes do not make dense holdings tables noisy.
- [x] Add API tests for available realized P&L breakdowns, BUY/null breakdowns, and unavailable breakdown reasons.
- [x] Add component tests for realized P&L SELL trigger, BUY trigger absence, available math display, and unavailable message.
- [x] Add unit/component tests for `adminMarketDataTableSettings`, admin table drawer/column behavior, AI connector tabs/tool search/toggles, public share preference hydration skip, and animation reduced-motion fallback.
- [x] Run `/aaa` to add or update E2E tests covering the realized P&L disclosure, admin market-data drawer/table flows, AI Connectors tab/tool search flow, and anonymous public share auth regression.

## Open Items

- [x] Run `/aaa` or equivalent E2E coverage for realized P&L disclosure, admin market-data drawer/table flows, AI Connectors MCP Tools flow, and anonymous public share auth regression.
- [x] Run browser visual validation for the responsive UI changes.
- [x] Run the remaining AGENTS.md full-gate suites before PR readiness.
- [ ] Keep broad admin market-data localization as a follow-up unless the PR scope is expanded beyond the new responsive table/drawer copy.

## Evidence / Validation

- Focused web Vitest passed: `RealizedPnlBreakdown`, `AccentApplier`, `AiConnectorsSettingsClient`, `AdminMarketDataClient`, `RollingNumber`, `HoldingsTable` — 6 files, 42 tests.
- Focused AI Connectors Vitest rerun passed after MCP Tools filters/toggle coverage was strengthened: `apps/web/test/components/settings/AiConnectorsSettingsClient.test.tsx` — 1 file, 4 tests.
- Focused API tests passed: `apps/api/test/unit/realizedPnlBreakdown.test.ts`, `apps/api/test/integration/portfolio.integration.test.ts`, and `apps/api/test/integration/ticker-details.integration.test.ts` — 3 files, 36 tests.
- Post-review focused API rerun passed: `npx vitest run test/unit/realizedPnlBreakdown.test.ts` — 1 file, 4 tests, including the split-before-sell unavailable guard.
- Post-review focused HTTP rerun passed: `npm run test:http --prefix apps/api -- user-preferences-aaa.http.spec.ts` — 21 tests, including `adminMarketDataTableSettings` PATCH/GET persistence.
- Second post-review focused web rerun passed: `npx vitest run test/components/admin/AdminMarketDataClient.test.tsx test/components/ui/RollingNumber.test.tsx` — 2 files, 26 tests, including route-backed KR operation outcome loading and requestAnimationFrame-started rolling digits.
- Third post-review focused API rerun passed: `npx vitest run test/unit/realizedPnlBreakdown.test.ts test/integration/portfolio.integration.test.ts test/integration/ticker-details.integration.test.ts` — 3 files, 38 tests, including persisted allocation divergence protection for realized P&L breakdowns.
- Fourth post-review focused web rerun passed: `npx vitest run test/components/ui/RollingNumber.test.tsx` — 1 file, 3 tests, including RAF cancellation protection and transition cleanup for same-length quote-refresh updates.
- Fifth post-review focused web rerun passed: `npx vitest run test/components/ui/RollingNumber.test.tsx` — 1 file, 3 tests, including configurable animation-frame mocks so Vitest teardown can restore jsdom globals.
- CI unit-test reproduction passed after the RollingNumber mock-descriptor fix: `npm run test:unit` — all workspace unit suites completed with exit code 0.
- Shared-types build passed.
- `npm run typecheck` passed after installing the worktree-local dependency tree and ensuring `@vakwen/*` resolves to this worktree.
- Post-review `npm run typecheck` and `npx eslint .` passed after review fixes.
- Third post-review `npm run typecheck`, `npx eslint .`, and `git diff --check` passed after realized P&L consistency/performance fixes.
- Fourth post-review `npm run typecheck`, `npx eslint .`, and `git diff --check` passed after the rolling-number effect dependency fix.
- Fifth post-review `npm run typecheck`, `npx eslint .`, and `git diff --check` passed after the RollingNumber test teardown fix.
- Full AGENTS.md suite evidence before browser validation:
  - `npx eslint .` passed cleanly after moving the new AAA guard conditionals into helper functions.
  - `npm run typecheck` passed.
  - `npm run test --prefix apps/web` passed: 50 files / 310 tests, then 59 files / 410 tests.
  - `npm run test --prefix apps/api` passed: 171 files / 1697 tests, 44 files / 428 tests skipped.
  - `npm run test:integration:full:host` passed: 90 files / 877 tests, 1 skipped.
  - `npm run test:e2e:bypass:mem --prefix apps/web` passed: 286 tests, 17 skipped.
  - `npm run test:e2e:oauth:mem --prefix apps/web` passed: 120 tests.
  - `npm run test:http --prefix apps/api` passed: 291 tests, 2 skipped.
- E2E/AAA coverage added and verified in `apps/web/tests/e2e/specs/combined-ui-improvements-aaa.spec.ts` for realized P&L disclosure, admin market-data drawer/settings/no-auto-open behavior, and AI Connectors MCP Tools search/filter flow.
- Anonymous public share auth regression is covered in `apps/web/tests/e2e/specs/anon-public-view-rendered-aaa.spec.ts`, which asserts `/share/:token` remains visible and does not redirect to `/login`.
- Targeted post-warning-cleanup E2E rerun passed: `NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 npx playwright test tests/e2e/specs/combined-ui-improvements-aaa.spec.ts tests/e2e/specs/anon-public-view-rendered-aaa.spec.ts --config=tests/e2e/playwright.config.ts --project=chromium` — 4 passed.
- OAuth admin instrument flow was updated for the row-drawer interaction in `apps/web/tests/e2e/specs-oauth/admin-instruments-aaa.spec.ts`.
- OAuth memory E2E harness now avoids root `.env.local` leakage by forcing memory persistence in `apps/web/tests/e2e/playwright.oauth.config.ts` and removing `.env.local` sourcing from the `test:e2e:oauth:mem` script.
- Chrome visual validation passed against local `dev:local:bypass:mem` with seeded memory-only ticker `VIZ7755` and anonymous share token `Mo4OTIcJQRNIaVCdZaZk5C`:
  - Desktop realized P&L disclosure opened on `/transactions`; no horizontal overflow.
  - Desktop Admin Market Data Instruments table rendered, column settings opened, row drawer opened, and no drawer details appeared before row activation.
  - Mobile Admin Market Data Instruments rendered the dropdown tab selector and row drawer; no horizontal overflow.
  - Desktop and mobile AI Connectors rendered MCP Tools search/filter UI, with mobile using the dropdown-style sub-tab selector; no horizontal overflow.
  - Desktop Dashboard and Portfolio rendered the seeded quote-backed holding values; no horizontal overflow.
  - Anonymous mobile public share stayed on `/share/:token` and did not redirect to `/login`.
  - Screenshots: `docs/notes/combined-ui-improvements/validation-screenshots-20260620/desktop-realized-pnl-breakdown.png`, `desktop-admin-market-data-column-settings.png`, `desktop-admin-market-data-drawer.png`, `mobile-admin-market-data-drawer.png`, `desktop-ai-connectors-mcp-tools.png`, `mobile-ai-connectors-mcp-tools.png`, `desktop-dashboard-rolling-values.png`, `desktop-portfolio-rolling-values.png`, and `mobile-public-share-no-login-redirect.png`.
  - Residual browser console noise: existing React hydration warnings about transient `caret-color: transparent` attributes on search inputs during Portfolio/Dashboard hydration; screenshots and checks still completed.
- Direct source evidence supports the checked non-test items above:
  - `libs/shared-types/src/index.ts` defines `RealizedPnlBreakdownDto` and `adminMarketDataTableSettingsPreferenceSchema`.
  - `apps/api/src/routes/registerRoutes.ts` accepts `adminMarketDataTableSettings` in the strict `/user-preferences` PATCH schema.
  - `apps/api/src/routes/registerRoutes.ts` applies transaction history limits before DTO/breakdown mapping to avoid building realized P&L breakdowns for rows that will not be returned.
  - `apps/api/src/services/realizedPnlBreakdown.ts` implements the replay helper, unavailable reasons, conservative split/reverse-split unavailable guard, and persisted-allocation consistency guard.
  - `apps/web/components/portfolio/RealizedPnlBreakdown.tsx`, `TransactionHistoryTable.tsx`, and `RecentTransactionsCard.tsx` wire the realized P&L disclosure UI.
  - `apps/web/components/admin/AdminMarketDataResponsiveTable.tsx` and `HoldingsColumnSettings.tsx` provide the shared admin table settings + sticky/mobile-summary behavior.
  - `apps/web/components/admin/AdminMarketDataKrResolver.tsx` keeps KR operation outcome rows route-backed after row selection so drawer headers cannot show one operation while stale outcomes show another.
  - `apps/web/components/settings/AiConnectorsSettingsClient.tsx` implements responsive tabs, mobile select, current-first ordering, collapsed revoked/expired history, and MCP Tools search/group/availability filters with per-tool toggles.
  - `apps/web/components/ui/RollingNumber.tsx`, `DashboardHero.tsx`, `DashboardHoldingsPreview.tsx`, and `HoldingsTable.tsx` wire the rolling-value animation and row-cap behavior; `RollingNumber` starts changed digits at the initial transform before applying the final transform in the next animation frame without canceling its own RAF/timeout on state updates.
  - `apps/web/components/layout/AccentApplier.tsx` skips preference hydration on `/share` and `/share/*`.

## Remaining Gaps

- zh-TW coverage improved for realized P&L, AI Connectors, and the new admin table/drawer/settings copy. The broader pre-existing admin market-data English surface still needs a separate localization pass if full admin zh-TW coverage is required.

## References

- Realized P&L scope: `docs/notes/realized-pnl-breakdown/scope-todo-20260618-realized-pnl-breakdown.md`
- Realized P&L desktop mockup: `docs/notes/realized-pnl-breakdown/mockups/realized-pnl-desktop.png`
- Realized P&L mobile mockup: `docs/notes/realized-pnl-breakdown/mockups/realized-pnl-mobile.png`
- Value animation options mockup: `docs/notes/combined-ui-improvements/mockups/value-animation-options.html`
- Admin Market Data mockup: `docs/notes/combined-ui-improvements/mockups/admin-market-data-redesign.html`
- Admin Market Data desktop screenshot: `docs/notes/combined-ui-improvements/mockups/admin-market-data-desktop.png`
- Admin Market Data mobile screenshot: `docs/notes/combined-ui-improvements/mockups/admin-market-data-mobile.png`
- AI Connectors mockup: `docs/notes/combined-ui-improvements/mockups/ai-connectors-redesign.html`
- AI Connectors desktop screenshot: `docs/notes/combined-ui-improvements/mockups/ai-connectors-desktop.png`
- AI Connectors mobile screenshot: `docs/notes/combined-ui-improvements/mockups/ai-connectors-mobile.png`
- Rolling digit mockup: `docs/notes/combined-ui-improvements/mockups/quote-refresh-rolling-digits.html`
- Rolling digit desktop screenshot: `docs/notes/combined-ui-improvements/mockups/quote-refresh-rolling-digits-desktop.png`
- Rolling digit mobile screenshot: `docs/notes/combined-ui-improvements/mockups/quote-refresh-rolling-digits-mobile.png`
