# Dividends Redesign Plan

Updated: 2026-07-06

This note translates the locked scope in `scope-todo-20260706-dividends-ui-ux.md` into a durable product and implementation plan for the dividends redesign. It is intentionally UI- and IA-focused. It does not reopen domain semantics, and it does not count as implementation evidence by itself.

## Goals

- Reframe `/dividends` first-tab usage around month-based income operations instead of a sparse calendar-only view.
- Keep Dividend Review as the full reconciliation workspace for post, edit, source-composition, explained, and resolved flows.
- Add ticker display names and market-aware ticker links everywhere dividend data is shown so users can move between dashboard, dividends, and ticker detail without losing context.
- Add a ticker detail `Dividends` tab that surfaces the same operational signals at ticker scope without embedding the full review workspace.
- Preserve or improve the prior dividends-page performance work by avoiding duplicate or inactive-tab fetches.

## Non-Goals

- Replacing Dividend Review charts, filters, or reconciliation architecture.
- Rewriting dividend persistence, matching rules, or posting semantics.
- Embedding the full `DividendPostingForm` workflow directly into ticker detail.
- Adding tax, forecasting, or annual dividend reporting features.

## Information Architecture

### Route and surface model

| Surface | Purpose | Primary actions | Notes |
|---|---|---|---|
| `/dividends` Overview tab | Month-scoped income operations command surface | Change month, inspect summary, act on open items, open review/deep links | UI label changes from `Calendar` to `Overview`; URL compatibility for existing `view=calendar` callers should be preserved unless implementation proves a safe migration path |
| `/dividends` Review tab | Full reconciliation workspace | Post, edit, mark matched, explain, resolve, inspect source composition | Remains the authoritative detailed workflow surface |
| `/tickers/[ticker]` Dividends tab | Ticker-scoped dividend summary and action entry point | Inspect upcoming/posted rows, quick `Mark matched`, jump to Review | Always visible in desktop and mobile ticker tab selectors |
| Dashboard dividend surfaces | Portfolio-level early warning and recent activity | Open `/dividends`, open ticker detail, inspect display names | Should render ticker code plus enriched display name |

### URL state

- `month=YYYY-MM` is the authoritative Overview month state.
- Initial `/dividends` render should parse and seed the active month on the server.
- Invalid or missing month values should fall back predictably to the current month.
- Ticker deep links from dividend surfaces should preserve `marketCode` when known so cross-listed tickers resolve safely.

## Overview Tab Layout

### Desktop structure

1. Compact page header with title, short explanation, and month picker.
2. Summary tiles row for the active month.
3. Two-column operations band:
   - Main column: `This Month` grouped event list.
   - Side rail: `Needs Action` queue.
4. Full-width `Recent Receipts` section below the operations band.

### Summary tiles

The top summary row should stay dense and decision-oriented. Recommended tiles:

- `Expected this month`
- `Posted this month`
- `Open reconciliation`
- `Recent receipts`

Each tile should include one primary amount or count and one secondary note that explains why the number matters, for example next payment date, unresolved row count, or how many receipts were posted recently.

### Needs Action rail

The rail is the operational priority stack, not a duplicate of the monthly list. It should prefer rows that need an immediate user decision:

- Posted but still open ledger rows.
- Expected events that are due or recently passed without a matched receipt.
- Rows with source or reconciliation context worth escalating into Dividend Review.

Each rail item should expose a compact primary action. `Mark matched` is appropriate only when a posted ledger row is already open and the action is safe at row level. More complex remediation should deep-link into Review.

### This Month event list

The main list should group the active month into a scannable operational sequence:

- Upcoming events first.
- Recently posted events next.
- Clear badge treatment for `expected`, `posted/open`, `matched`, `explained`, and `resolved`.

Each row should show:

- Ticker code and API-enriched display name.
- Account label.
- Key dates relevant to the row.
- Cash amount and currency.
- Status badge.
- Safe ticker and review deep links.

### Recent Receipts

This section exists to answer "what actually landed recently?" without forcing a full jump into Review. It should emphasize posted ledger rows, receipt timing, account, and reconciliation status. The section is not a second copy of the action queue.

## Ticker Detail Dividends Tab

### Placement and role

- The tab should be permanently available in ticker detail navigation on desktop and mobile.
- It is a ticker-scoped summary and action surface, not a replacement for Dividend Review.
- The tab should keep the user inside ticker context for quick inspection, then hand off to Review for deep edits.

### Content structure

1. Summary card row:
   - Upcoming count
   - Next payment
   - Last posted
   - Open reconciliation count
2. `Upcoming Events` section for expected or scheduled rows.
3. `Posted History` section for posted rows, with newest first.

### Row behavior

- Show ticker code, display name where helpful, account label, amount, currency, and status.
- `Mark matched` appears only for open posted rows.
- Full edit, explained, resolved, and source-composition actions should route into Dividend Review rather than reimplementing those workflows in place.
- Review deep links should use `/dividends?view=ledger&ticker={ticker}&marketCode={marketCode}` when market context is known.

## Mobile Behavior

### `/dividends` Overview mobile order

The mobile order is locked and should stay action-first:

1. Header and month picker
2. Summary tiles
3. `Needs Action`
4. `This Month`
5. `Recent Receipts`

### Mobile interaction rules

- The month picker must stay reachable without horizontal layout breakage.
- Summary tiles should stack into a clean single-column or two-up pattern without truncating the primary metric.
- `Needs Action` should become the first scroll target after the header.
- Long ticker names should wrap or clamp without overlapping status chips or amounts.
- Ticker detail dividend sections should prefer stacked cards over compressed tables.

## Loading, Empty, and Error States

### Loading states

- Initial `/dividends` Overview load should render the active month from server-prefetched data.
- Month changes should show local section-level loading treatment instead of collapsing the entire page shell.
- Review should continue to own its own loading path and must not be blocked by Overview prefetches.
- Ticker detail should keep the `Dividends` tab visible even when dividend data is still loading.

### Empty states

- Empty month: explain that no dividend events or receipts exist for the selected month.
- Empty action queue: explicitly confirm that nothing currently needs reconciliation attention.
- Empty ticker history/upcoming sections: explain whether the ticker has no dividend history or only no records in that slice.

### Error states

- Calendar snapshot or combined-endpoint failures should show a recoverable inline state scoped to the affected section.
- Deep links into Review should fail safe when optional filters are unsupported; the user should still land in Review with the ticker context preserved as far as the route accepts it.
- Ticker links without known `marketCode` should still navigate by ticker, but the plan should treat `marketCode` preservation as the preferred path.

## Performance Goals

The redesign should preserve the dividends-page performance direction established in the 2026-05-20 dividends/ticker-details scope:

- Only fetch the active `/dividends` tab payload on initial render.
- Server-prefetch the active Overview month so first paint does not wait on client coordination between separate calendar and ledger requests.
- Replace the current client-side month composition path with one combined month snapshot endpoint for events plus related ledger rows.
- Avoid duplicate inactive-tab RSC or API requests during Overview and Review tab switches.
- Keep warmed dev behavior aligned with the existing target direction:
  - active-tab visible content around or under `1.5s`
  - tab switch visible response around or under `500ms`
- Keep month changes scoped to one authoritative month request instead of multiple competing fetches.

## Validation Evidence Template

Fill this section only when evidence exists in current files, command output, or Browser checks.

### Focused automated checks

- [x] Query/helper tests updated for `month=YYYY-MM` parsing and fallback behavior.
- [x] API tests updated for the combined calendar endpoint and enriched dividend DTO fields.
- [x] Web/unit tests updated for Overview layout, display names, and ticker detail `Dividends` tab rendering.
- [x] E2E coverage updated for month picker flow, action queue, mobile layout, dashboard display names, and ticker quick reconciliation.

### Browser validation

- [x] Desktop checked: `/dashboard`
- [x] Desktop checked: `/dividends`
- [x] Desktop checked: `/dividends?month=2026-07`
- [x] Desktop checked: `/dividends?view=ledger&ticker=2330&marketCode=TW`
- [x] Desktop checked: `/tickers/2330?marketCode=TW`
- [x] Mobile checked: `/dividends?month=2026-07`
- [x] Mobile checked: `/tickers/2330?marketCode=TW`

### Full repo gate

- [x] `npx eslint .`
- [x] `npm run typecheck`
- [x] `npm run test --prefix apps/web`
- [x] `npm run test --prefix apps/api`
- [x] `npm run test:integration:full:host`
- [x] `npm run test:e2e:bypass:mem --prefix apps/web`
- [x] `npm run test:e2e:oauth:mem --prefix apps/web`
- [x] `npm run test:http --prefix apps/api`

### Notes

- Evidence links, screenshots, timings, and follow-up failures:
  - No Linear ticket is attached to the locked scope (`tickets: []`), so PR/commit metadata requires the repository Linear waiver path unless a ticket is supplied before PR creation.
  - Focused web checks passed: `npx eslint apps/web/components/dividends/TickerDividendsTab.tsx apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx libs/test-e2e/src/assistants/tickers/TickerDetailActions.ts`; `npx tsc --noEmit -p apps/web/tsconfig.json`; focused dividend/ticker Vitest files.
  - Focused API checks passed: `npx tsc --noEmit -p apps/api/tsconfig.json`; focused dashboard/dividend/ticker API tests.
  - Focused E2E passed: `npm run test:e2e:bypass:mem --prefix apps/web -- dividends-ui-ux-aaa.spec.ts` and `npm run test:e2e:bypass:mem --prefix apps/web -- mobile-dividends-ui-ux-aaa.spec.ts`.
  - Browser plugin local validation used `npm run dev:local:bypass:mem` and seeded `user-1` with `7788 Browser Dividend Systems` plus default `2330 台積電`.
  - Browser desktop evidence: Dashboard Dividend Progress rendered ticker code, display name, account, and expected amount; Overview preserved `month=2026-07`; Review preserved `ticker=2330&marketCode=TW`; ticker detail rendered Dividends tab with display name, Posted History, Reconciliation, `Mark matched`, and filtered ledger links.
  - Browser mobile evidence at `390x844`: Overview had month picker, Needs Action visually before This Month, ticker display names, and no horizontal overflow; ticker detail opened Dividends from the compact selector, rendered display name/history/reconciliation, and had no horizontal overflow.
  - Mockup screenshots generated under `docs/notes/dividends-ui-ux/mockups/screenshots/` for dashboard progress, dividends overview, and ticker detail dividends in desktop and mobile viewports.
  - Final AGENTS gate passed on 2026-07-06 after post team-review fixes and after confirming `HEAD` and `origin/dev` are both `d72de434`: `git diff --check`, `npx eslint .` with existing unrelated AI connector warnings, `npm run typecheck`, web Vitest with 467 tests passing, API tests with 1942 tests passing and 443 skipped, Postgres integration with 970 tests passing and 1 skipped, bypass E2E with 321 passed and 19 skipped, OAuth E2E with 121 passed, and API HTTP with 301 passed and 2 skipped.
  - First full bypass E2E run found compatibility regressions in legacy dividend tests: duplicate status badge locators, missing `View all dividends` link, and edited posted amount visibility. These were fixed and the full bypass suite reran clean.
  - Post team-review focused fixes passed: API/web TypeScript, touched UI/E2E eslint, `npm run build --prefix libs/test-e2e`, focused API tests for dividend review/dashboard/ticker/calendar, and focused web Vitest for tabs/query/service/ticker history.
  - Browser evidence is local `npm run dev:local:bypass:mem` validation. Post-deployment hosted validation for this implementation is pending deployment.

## Future Work

- Decide whether the user-facing route token should move from `view=calendar` to `view=overview`, with compatibility handling if that migration is worth the churn.
- Consider adding a visible market filter control to Dividend Review if users need to adjust market context after landing from a ticker deep link.
- Re-evaluate exact ticker tab ordering after the visual implementation lands and real browser checks confirm scanning behavior.
- Consider adding annual income summaries, forecasting, or tax/reporting follow-ups only in a later separate scope.

## References

- Locked scope: `docs/notes/dividends-ui-ux/scope-todo-20260706-dividends-ui-ux.md`
- Prior dividends performance scope: `docs/notes/ticker-details-sticky-dividends-perf/scope-todo-20260520.md`
- Dividend review background: `docs/004-notes/ui-bugs-dashboard-dividends/scope-todo-2026051916-dashboard-dividends.md`
- Dividend review v2 background: `docs/004-notes/kzo-136/scope-todo-202604121200-dividend-review-v2.md`
- Mockup source: `docs/notes/dividends-ui-ux/mockups/mockup.html`
- Mockup renderer: `docs/notes/dividends-ui-ux/mockups/render-mockups.mjs`
- Mockup screenshots:
  - `docs/notes/dividends-ui-ux/mockups/screenshots/dashboard-progress-desktop.png`
  - `docs/notes/dividends-ui-ux/mockups/screenshots/dashboard-progress-mobile.png`
  - `docs/notes/dividends-ui-ux/mockups/screenshots/dividends-overview-desktop.png`
  - `docs/notes/dividends-ui-ux/mockups/screenshots/dividends-overview-mobile.png`
  - `docs/notes/dividends-ui-ux/mockups/screenshots/ticker-dividends-desktop.png`
  - `docs/notes/dividends-ui-ux/mockups/screenshots/ticker-dividends-mobile.png`
