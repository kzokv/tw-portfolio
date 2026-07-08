---
slug: stock-dividend-corporate-actions
source: scope-grill
created: 2026-07-08
tickets: []
required_reading:
  - docs/004-notes/002-accounting/posted-fact-correction-rules.md
  - docs/004-notes/001-planning/kzo-33-dividend-lifecycle.md
superseded_by: null
---

# Todo: Stock Dividend Corporate Actions

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

1. Build a corporate-action platform cut covering stock dividends, splits, reverse splits, and stock-dividend cash-in-lieu.
2. Use a dedicated `position_actions` ledger as the canonical source for non-cash position effects.
3. Replay uses a chronological stream of trades plus position actions; lots remain projections.
4. Stock dividends add shares with zero added portfolio cost basis; store par-value/premium base separately for Taiwan NHI/bookkeeping.
5. Same-day ordering uses timestamps when present; otherwise position actions run before trades.
6. Corrections use audited pre-sell amendment until a blocking sell exists; after that, reversal plus replacement.
7. Same-date sells block amendment by default unless timestamps prove the sell happened before the action.
8. Migrate posted stock/mixed dividend entries and existing split/reverse-split `corporateActions` into `position_actions`; retire old source paths from replay.
9. UI MVP is embedded in portfolio/ticker/holding surfaces, not a standalone corporate-actions page.
10. Split/reverse-split entry is contextual from holding detail, with blocking preview and explicit fractional/cash-in-lieu handling.
11. Stock-dividend amendments/corrections live in the dividend drawer.
12. Holdings table stays clean; action explanation goes in holding detail timeline.
13. Dividend review gets compact stock columns plus drawer details.
14. API gets operational write surface; MCP gets read plus confirmation-gated quantity mutations.
15. Test gate is full cross-layer coverage, including E2E/AAA.

## Implementation Steps

- [x] Add `position_actions` schema, types, persistence, correction/audit fields, and dividend-ledger source links.
- [x] Migrate posted stock/mixed dividend rows and existing split/reverse-split corporate actions into `position_actions`.
- [x] Emit an audit report for suspicious orphan zero-cost stock-dividend lots.
- [x] Refactor replay and realized-PnL breakdown to consume trades plus position actions in deterministic order.
- [x] Implement stock dividend posting as dividend ledger plus linked position action plus real cash effects only.
- [x] Trigger projection/snapshot refresh after stock-dividend and split/reverse-split mutations.
- [x] Add audited pre-sell amendment guard and reversal/replacement path after blocking sells.
- [x] Add contextual holding-detail split/reverse-split UI with blocking preview.
- [x] Extend dividend drawer for stock-dividend amendment/correction UX.
- [x] Add holding detail action timeline and compact dividend-review stock columns.
- [x] Harden TW dividend ingestion tests for stock dividend rows.
- [x] Add API endpoints and MCP read/confirmation-gated mutation tools.
- [x] Run `/aaa` to add or update E2E tests covering agreed UI and API flows.

## Open Items

- [x] None.

## Evidence

- Mockup screenshots generated under `docs/notes/stock-dividend-corporate-actions/mockups/screenshots/`:
  `holdings-overview.png`, `holding-detail-timeline.png`, `split-blocking-preview.png`,
  `dividend-review-drawer.png`, and `mobile-split-preview.png`.
- Runtime UI validation refreshed in `/tmp/stock-dividend-ui-validation/`:
  `dividends-review-desktop.png` and `dividends-review-mobile.png`; both show the adjusted stock-dividend
  review row with stock received `12`, no `validation_error`, and no horizontal viewport overflow.
- Focused checks run:
  - `npx vitest run test/integration/dividends.integration.test.ts test/unit/mcpDividendServices.test.ts test/unit/replayPositionHistory.test.ts`
  - `npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p apps/api/test/unit/tsconfig.json && npx tsc --noEmit -p apps/api/test/integration/tsconfig.json`
  - `npm run test --prefix apps/web -- test/features/dividends/useDividendPosting.test.ts test/features/dividends/DividendPostingForm.test.tsx test/components/dividends/DividendReviewClient.test.tsx test/features/portfolio/holdingActionTimeline.test.ts`
  - `npx vitest run test/components/dividends/dividendsPageQuery.test.ts`
  - `npm run test:e2e:bypass:mem --prefix apps/web -- tests/e2e/specs/stock-dividend-corporate-actions-aaa.spec.ts`
- Additional focused checks run after scope reconciliation:
  - `npx vitest run test/unit/finmind-dividend-mapper.test.ts`
  - `npx vitest run test/integration/dividends.integration.test.ts test/integration/corporate-actions.integration.test.ts test/unit/dividendReviewRows.test.ts`
  - `npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json`
  - `npm run test --prefix apps/web -- test/features/portfolio/holdingActionTimeline.test.ts test/features/dividends/DividendPostingForm.test.tsx`
  - `npx vitest run test/unit/dividendReviewRows.test.ts` from `apps/api`
  - `npm run test:e2e:bypass:mem --prefix apps/web -- tests/e2e/specs/stock-dividend-corporate-actions-aaa.spec.ts`
- Validation issue recorded and fixed: the focused stock-dividend drawer E2E initially failed because
  `/portfolio/dividends/review` returned persistence review rows without canonical stock-dividend correction
  metadata, so the drawer rendered reconcile-only instead of the stock quantity amendment field. The route now
  enriches ledger review rows with `buildDividendLedgerEntryDetails(..., { preserveOrder: true })`, and the
  focused E2E passed afterward.
- Local Postgres migration command `npx vitest run test/integration/postgres-migrations.integration.test.ts`
  was invoked in the API package; it skipped because managed Postgres env was absent locally.
- Full local eight-suite gate completed after scope reconciliation:
  - `npx eslint .` — passed with 10 warnings.
  - `npm run typecheck` — passed.
  - `npm run test --prefix apps/web` — passed.
  - `npm run test --prefix apps/api` — passed.
  - `npm run test:integration:full:host` — passed (`97` files, `989` tests, `1` skipped).
  - `npm run test:e2e:bypass:mem --prefix apps/web` — passed (`327` tests, `19` skipped).
  - `npm run test:e2e:oauth:mem --prefix apps/web` — passed (`121` tests).
  - `npm run test:http --prefix apps/api` — passed (`301` tests, `2` skipped).
- Full PR/CI loop is still pending until Linear ticket or waiver metadata is provided and the PR is opened.

## References

- Posted-fact correction rules: `docs/004-notes/002-accounting/posted-fact-correction-rules.md`
- Dividend lifecycle plan: `docs/004-notes/001-planning/kzo-33-dividend-lifecycle.md`
