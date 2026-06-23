---
slug: prod-market-data-valuation-fixes
source: scope-grill
created: 2026-06-23
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Prod Market Data Valuation Fixes

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Implementation Steps

- [x] Add MCP draft-posting first-trade backfill parity after `confirmAiTransactionDraftPosting`.
- [x] Reuse the existing backfill queue semantics: `BACKFILL_QUEUE`, singleton key, `trigger: "first_trade"`, `app.boss`, and demo gating.
- [x] Add compact Yahoo intraday diagnostic summaries for no-same-day quote cases.
- [x] Store Yahoo diagnostic details in both structured logs and `market_calendar_activity.detail`.
- [x] Include ticker, resolved provider symbol, chart options, quote counts, first/last valid close, meta currency/previous close, and rejection reason.
- [x] Add dashboard missing-valuation explanation using existing health/status surfaces.
- [x] Add reports missing-valuation explanation using existing data-health / valuation-health surfaces.
- [x] Keep aggregate totals strict; do not show partial totals as the main KPI.
- [x] Add API test coverage for MCP draft posting backfill enqueue.
- [x] Add unit test coverage for Yahoo no-same-day diagnostic summarization.
- [x] Add web component/hook tests for dashboard and reports missing valuation explanation.

## Open Items

- [ ] None.

## Validation Evidence

- `npx eslint .` — passed.
- `npm run typecheck` — passed.
- `npm run test --prefix apps/web` — passed.
- `npm run test --prefix apps/api` — passed.
- `npm run test:integration:full:host` — passed: 92 files, 894 tests passed, 1 skipped.
- `npm run test:e2e:bypass:mem --prefix apps/web` — passed: 296 passed, 16 skipped.
- `npm run test:e2e:oauth:mem --prefix apps/web` — passed after hardening the shared dnd-kit E2E drag helper: 120 passed.
- `npm run test:http --prefix apps/api` — passed: 296 passed, 2 skipped.
- `git diff --check` — passed.

## Notes

- Durable lesson review found the dnd-kit drag readiness pattern already promoted in `.claude/rules/playwright-dnd-kit-drag-readiness.md`; no new promotion was added.
- The generated UI mockup used during implementation remains outside the repo at `/Users/lume/.codex/generated_images/019ef1e1-ab53-78e3-b77a-ee03f31d8e29/ig_057ee5f8cead19bf016a39ee5b9aa08191871df546602e06ed.png`.

## References

- Worktree: `/Users/lume/repos/tw-portfolio/.worktrees/codex/fix-prod-market-data-issues`
