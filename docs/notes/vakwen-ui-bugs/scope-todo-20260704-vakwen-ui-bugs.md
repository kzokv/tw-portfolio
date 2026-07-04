---
slug: vakwen-ui-bugs
source: scope-grill
created: 2026-07-04
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Vakwen UI Bugs

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Locked Scope

1. Apply gain/loss tone to P&L/change values across Unrealized P&L selected ticker detail cards, detail table, and focus value strip.
2. Add Reports Data Health deep-linking with `health=1`, `healthReason`, and `healthReasons`.
3. Reports Data Health becomes a guided checklist showing active causes, affected tickers/pairs/markets when available, explanation, and action guidance.
4. Backfill/market-data repair causes route primarily to `/settings/tickers?repair=1...`; Admin Market Data is secondary.
5. Admin users get Admin Market Data links. Regular users get copyable admin-link/help actions.
6. Settings > Tickers repair mode opens from query state, shows Data Health origin, preserves `returnTo`, and uses passed ticker context for guidance/highlighting only.
7. Dashboard Data Health links stay sparse: top hero missing KPI states, holdings missing valuation alert, explicit FX incomplete states, and existing valuation health warnings only.
8. Reports links preserve current report route state; dashboard global surfaces use `scope=all`.
9. `health=1` scrolls/focuses the Reports Data Health card once, expands details, and highlights requested causes.
10. Inactive requested causes are still shown with “not active in this scope” style copy.
11. Mobile transaction dialogs become viewport-safe with max-height and vertical scrolling; no sticky footer in this pass.
12. Tests: component coverage for formatting/Data Health/settings repair query behavior/dialog classes, plus one mobile E2E for transaction submit reachability.

## Implementation Steps

- [x] Add shared helpers for report health query parsing/building.
- [x] Apply P&L gain/loss tone in Unrealized P&L selected detail cards/table/focus strip.
- [x] Add Reports Data Health guided checklist with active/inactive cause handling.
- [x] Add affected ticker/pair/market extraction from existing report payloads.
- [x] Add Data Health deep-link CTAs from Reports strict-total/missing states.
- [x] Add sparse Dashboard Data Health links for agreed warning/missing states.
- [x] Add Settings > Tickers repair query handling, origin banner, return link, and suggested ticker highlighting.
- [x] Add admin-vs-regular-user secondary action behavior.
- [x] Make transaction dialog wrappers mobile viewport-safe with vertical scrolling.
- [x] Add/update component tests for analysis tone, reports health, settings repair query, and dialog layout classes.
- [x] Add one mobile Playwright regression for transaction submit reachability.
- [x] Run focused validation, then broader relevant web checks.

## Decisions

- Admin Market Data secondary action uses `/admin/market-data/{marketCode}/overview` when market context is available; otherwise it falls back to `/admin/market-data`. Regular users receive the same destination as copyable admin-help text instead of a direct navigation link.

## Validation Evidence

- `npx tsc --noEmit -p apps/web/tsconfig.json`
- `npm run typecheck`
- `npx eslint .` (passed with existing unrelated Playwright conditional warnings in AI connector responsive specs)
- `npm run test --prefix apps/web` (component/app: 68 files, 464 tests; features/hooks/lib: 69 files, 462 tests)
- `npx vitest run test/features/reports/reportHealthDeepLinks.test.ts test/components/reports/ReportsClient.test.tsx test/components/analysis/UnrealizedPnlAnalysisClient.test.tsx test/features/dashboard/components.test.tsx test/components/settings/TickersSettingsClient.test.tsx test/components/portfolio/TransactionDialogs.test.tsx --reporter=dot`
- `NEXT_PUBLIC_AUTH_MODE=dev_bypass NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 npm run build -w @vakwen/config -w @vakwen/test-framework -w @vakwen/test-e2e -w @vakwen/web`
- `npx playwright test tests/e2e/specs/mobile-transaction-dialog-submit-aaa.spec.ts --config tests/e2e/playwright.config.ts --project=chromium-mobile`
- `npm run test:integration:full:host` (94 files, 959 tests passed, 1 skipped)
- `npm run test:e2e:bypass:mem --prefix apps/web` (313 passed, 19 skipped)
- `npm run test:e2e:oauth:mem --prefix apps/web` (121 passed)
- `npm run test:http --prefix apps/api` (301 passed, 2 skipped)
- Durable-memory review (`/si-review`): repo-local team memory reviewed; no new durable pattern promoted because candidates were scope-specific or already covered by existing rules.
- Pre-PR code review: Code Reviewer quality checks plus targeted diff review found no blocking defect; `ReportsClient.tsx` remains a large pre-existing component and is not new scope debt.
- Post-review cleanup: `git diff --check` and `npx tsc --noEmit -p apps/web/tsconfig.json` passed after indentation-only cleanup.

## References

- Mockup HTML: `docs/notes/vakwen-ui-bugs/data-health-panel-mockup.html`
- Mockup screenshot: `docs/notes/vakwen-ui-bugs/data-health-panel-mockup.png`
- Unrealized P&L tone mockup HTML: `docs/notes/vakwen-ui-bugs/unrealized-pnl-tone-mockup.html`
- Unrealized P&L tone mockup screenshot: `docs/notes/vakwen-ui-bugs/unrealized-pnl-tone-mockup.png`
- Dashboard Data Health links mockup HTML: `docs/notes/vakwen-ui-bugs/dashboard-health-links-mockup.html`
- Dashboard Data Health links mockup screenshot: `docs/notes/vakwen-ui-bugs/dashboard-health-links-mockup.png`
- Reports KPI Data Health deep-link mockup HTML: `docs/notes/vakwen-ui-bugs/reports-kpi-deeplink-mockup.html`
- Reports KPI Data Health deep-link mockup screenshot: `docs/notes/vakwen-ui-bugs/reports-kpi-deeplink-mockup.png`
- Settings ticker repair mockup HTML: `docs/notes/vakwen-ui-bugs/settings-ticker-repair-mockup.html`
- Settings ticker repair mockup screenshot: `docs/notes/vakwen-ui-bugs/settings-ticker-repair-mockup.png`
- Mobile transaction dialog mockup HTML: `docs/notes/vakwen-ui-bugs/mobile-transaction-dialog-mockup.html`
- Mobile transaction dialog mockup screenshot: `docs/notes/vakwen-ui-bugs/mobile-transaction-dialog-mockup.png`
- Mobile transaction dialog bottom-state screenshot: `docs/notes/vakwen-ui-bugs/mobile-transaction-dialog-bottom-mockup.png`
