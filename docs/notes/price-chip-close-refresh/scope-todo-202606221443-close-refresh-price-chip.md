---
slug: price-chip-close-refresh
source: scope-grill
created: 2026-06-22
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Price Chip Close Refresh

> For agents starting a fresh session: read all files listed in `required_reading` above before starting implementation.

## Implementation Steps

- [x] Update close-refresh provider ordering so no same-day close tries Yahoo chart close-only first, then TWSE close-only for TW, then the primary full-bar provider.
- [x] Update close-refresh provider ordering so existing same-day `close_only` tries the primary full-bar provider first, then Yahoo chart close-only, then TWSE close-only for TW.
- [x] Preserve current `full_bar` short-circuit behavior so same-day full bars are reported as current without provider calls.
- [x] Widen Yahoo chart close-only support to all regular-session markets supported by the intraday provider: `TW`, `US`, `AU`, and `KR`.
- [x] Implement close-refresh error behavior: Yahoo/TWSE errors and rate limits fall through; primary no-data becomes `missing`; primary ordinary errors mark the ticker `failed`; primary `RateLimitedError` remains retryable.
- [x] Keep daily bar upsert semantics intact so `close_only` cannot overwrite `full_bar`, and `full_bar` can upgrade `close_only`.
- [x] Update quote snapshot price-state classification so no same-day close after market close remains `pending_today_close` / `closed_pending`, while same-day `close_only` and `full_bar` both render as `today_close` / `closed`.
- [x] Preserve detailed source and quality facts for close-only rows, including `sourceKind: "yahoo_chart_close"` or `sourceKind: "twse_stock_day_close"` and `quality: "close_only"`.
- [x] Patch ticker details parity so ticker detail price chips agree with dashboard/portfolio behavior without a broad resolver refactor.
- [x] Update `PriceStateChip` popover formatting with friendly source and quality labels.
- [x] Add a derived popover row for closed close-only rows: `Full daily bar: Pending`.
- [x] Add or update API unit tests for close-refresh ordering, fallthrough behavior, retryable primary rate limits, and all-market Yahoo close-only support.
- [x] Add or update quote snapshot and ticker details tests for close-only versus full-bar chip classification.
- [x] Add or update web component tests for friendly popover labels and the `Full daily bar: Pending` row.
- [x] Run focused API tests for close refresh, Yahoo intraday close provider, quote snapshots, and ticker details.
- [x] Run focused web tests for `PriceStateChip`.
- [x] Run `npm run test --prefix apps/api`.
- [x] Push the follow-up commit to PR #238 and verify PR gate status.

## Open Items

- [ ] None.

## References

- Scope debate note: none
- Pull request: https://github.com/kzokv/tw-portfolio/pull/238

## Evidence

- `cd apps/api && npx vitest run test/unit/market-data/closeRefreshService.test.ts test/unit/market-data/yahooFinanceIntradayProvider.test.ts test/unit/quoteSnapshotService.test.ts test/unit/tickerDetails.test.ts` — pass, 58 tests.
- Post-review regression: `cd apps/api && npx vitest run test/unit/market-data/marketRegularSession.test.ts test/unit/quoteSnapshotService.test.ts` — pass, 41 tests.
- Post-review intraday-disabled regression: `cd apps/api && npx vitest run test/unit/quoteSnapshotService.test.ts` — pass, 28 tests.
- `cd apps/web && npx vitest run test/components/holdings/PriceStateChip.test.tsx` — pass, 12 tests.
- `npm run test --prefix apps/web` — pass, 55 files / 334 tests plus 61 files / 419 tests.
- `npm run test --prefix apps/api` — pass, 173 files / 1734 tests, 44 files / 431 tests skipped.
- `npm run typecheck` — pass.
- `npx eslint .` — pass.
- `npm run test:integration:full:host` — pass, 92 files / 894 tests, 1 skipped.
- `npm run test:e2e:bypass:mem --prefix apps/web` — pass, 296 tests, 16 skipped.
- `npm run test:e2e:oauth:mem --prefix apps/web` — pass, 120 tests.
- `npm run test:http --prefix apps/api` — pass, 296 tests, 2 skipped.
