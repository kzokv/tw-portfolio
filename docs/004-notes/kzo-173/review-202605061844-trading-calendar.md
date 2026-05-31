# KZO-173 Trading Calendar Review

## Scope Reviewed

- `TradingCalendarCache` service and pure helper exports.
- `Persistence.getDistinctBarDates` contract and memory/Postgres implementations.
- Fastify wiring and daily-bar upsert cache notifications.
- KZO-173 unit/integration coverage and Wave 2 docs.

## Findings

No blocking findings.

## Notes

- `TradingCalendarCache.getTradingDates()` returns the cached `Set` directly, matching the locked public API. Callers should treat it as read-only; no current consumer mutates it.
- The local code-reviewer helper reported a 91/100 score for `tradingCalendar.ts`. Its two smell notes were false/acceptable for this scope: constants are already named (`LOOKBACK_DAYS`, `TTL_MS`), and the helper complexity is covered by targeted DST, grace-window, FX, fallback, TTL, and in-flight tests.
- `pr_analyzer.py` reported no changes because this implementation is still uncommitted; the manual review covered the working tree diff.

## Validation Evidence

- `npx eslint .`
- `npm run typecheck`
- `npm run test --prefix apps/web` — 47 files, 352 tests passed.
- `npm run test --prefix apps/api` — 82 files passed, 973 tests passed, 31 files/317 tests skipped under memory mode.
- `npm run test:integration:full:host` — 59 files, 609 tests passed, 1 skipped.
- `npm run test:e2e:bypass:mem --prefix apps/web` — 196 tests passed.
- `npm run test:e2e:oauth:mem --prefix apps/web` — 90 tests passed.
- `npm run test:http --prefix apps/api` — 207 tests passed, 2 skipped.

