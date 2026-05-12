---
slug: kzo-192
source: scope-grill
created: 2026-05-12
tickets: [KZO-192]
required_reading:
  - docs/004-notes/kzo-192/scope-todo-202605121229-locked.md
superseded_by: null
---

# Todo: KZO-192 — ECB/TARGET2 holiday awareness for synthetic FX market

> **For agents starting a fresh session:** read this file end-to-end before starting implementation. Worktree: `.claude/worktrees/kzo-192` (branch `worktree-kzo-192`, based on dev @ f9ac1db). Linear: [KZO-192](https://linear.app/kzokv/issue/KZO-192/synthetic-fx-market-ecb-target2-holiday-awareness).

## Scope summary

Today the synthetic `"FX"` market in `TradingCalendarCache` (`apps/api/src/services/market-data/tradingCalendar.ts`) returns "weekday only" — but Frankfurter forward-fills on ECB/TARGET2 holidays. Result: on Good Friday / Easter Monday / Labour Day / Christmas / Boxing Day / NYD, `lastFxRate.date < latestSettledTradingDay("FX", today)` is true, and `providerHealth.computeStatus("frankfurter", ...)` flips to `"down"`. ~6 false-down days per year on the `/admin/providers` page.

**Note:** the ticket text says this affects "KZO-177's freshness badge" — that overstates surface. `dashboardFreshness.ts` does NOT traverse the FX path (it only handles TW/US/AU). The user-visible regression is **only the `frankfurter` provider-health row** flipping "down" on ECB holidays. Stock holding stale-amber badges are unaffected.

## Locked decisions from scope-grill 2026-05-12

1. **Approach:** Computus-derived Easter (Good Friday + Easter Monday) + 4 hardcoded fixed dates (Jan 1, May 1, Dec 25, Dec 26). Zero deps. Anonymous-Gregorian Computus (Meeus/Jones/Butcher form). Rejected: Frankfurter calendar probe (recursive verification — querying the provider whose data we are verifying), `date-holidays` dep (200KB+ for a 6-date problem).
2. **File:** `apps/api/src/services/market-data/tradingCalendar.ts` — extend inline, no new file (320 LOC current).
3. **New private helpers** (no exports added; behavior change only):
   - `computeEasterSunday(year: number): string` — anonymous-Gregorian Computus
   - `ecbHolidaysForYear(year: number): ReadonlySet<string>` — backed by `ECB_HOLIDAY_YEAR_CACHE = new Map<number, ReadonlySet<string>>()` for amortized O(1) lookups
   - `isEcbHoliday(date: string): boolean`
   - `isFxTradingDay(date: string): boolean` — `isWeekdayIsoDate(date) && !isEcbHoliday(date)`
   - `previousFxTradingDayOnOrBefore(date: string): string` — walks backward via `isFxTradingDay`
4. **Three FX branches updated:**
   - `resolveLatestSettledTradingDay` line 149: `previousWeekdayOnOrBefore(resolveFxSettlementCandidate(now))` → `previousFxTradingDayOnOrBefore(resolveFxSettlementCandidate(now))`
   - `tradingDaysBetweenPure` line 178-184: `isWeekdayIsoDate(current)` inside the FX loop → `isFxTradingDay(current)`
   - `isTradingDayPure` line 198-200: `isWeekdayIsoDate(date)` for FX → `isFxTradingDay(date)`
5. **Untouched:** `isWeekdayIsoDate` and `previousWeekdayOnOrBefore` stay weekday-only. The equity bootstrap fallback at line 158 (`previousWeekdayOnOrBefore(candidateDate)`) is unchanged — TW/US/AU markets do NOT inherit ECB holidays.
6. **Exported API signatures unchanged.** Pure behavior change for `market === "FX"`.

## Implementation Steps

### Source

- [x] In `apps/api/src/services/market-data/tradingCalendar.ts`, after the existing `previousWeekdayOnOrBefore` helper (~line 86), insert: `computeEasterSunday`, `ECB_HOLIDAY_YEAR_CACHE`, `ecbHolidaysForYear`, `isEcbHoliday`, `isFxTradingDay`, `previousFxTradingDayOnOrBefore`. All `function`-keyword declarations, all private to the module.
- [x] Add an inline comment above `computeEasterSunday` citing the Meeus/Jones/Butcher anonymous-Gregorian form and noting the result is **Easter Sunday**; Good Friday = Easter − 2, Easter Monday = Easter + 1.
- [x] Add a comment above the ECB holiday list noting the 6 TARGET2 closing days have been stable since 2002. ECB one-off closures (e.g., system migrations) are NOT covered — documented limitation; mint a follow-on ticket if such an event ever lands.
- [x] Update `resolveLatestSettledTradingDay` line 149: swap helper as specified in decision 4.
- [x] Update `tradingDaysBetweenPure` line 178-184: swap helper as specified.
- [x] Update `isTradingDayPure` line 198-200: swap helper as specified.

### Impl-coupled test fix (existing test)

- [x] `apps/api/test/unit/services/market-data/tradingCalendar.test.ts:150` — update expected value `"2026-05-01"` → `"2026-04-30"` because 2026-05-01 is now Labour Day (ECB holiday). Add a one-line comment: `// 2026-05-01 (Labour Day, ECB holiday) is skipped; 2026-04-30 (Thursday) is the prior trading day.` Per `.claude/rules/implementer-qa-test-ownership.md` this is implementation-coupled — Implementer owns.

### New behavioral tests

Add to the same describe block in `apps/api/test/unit/services/market-data/tradingCalendar.test.ts`:

- [x] **`computeEasterSunday` self-test** — verify 5 known Easter Sundays: `2024-03-31`, `2025-04-20`, `2026-04-05`, `2027-03-28`, `2030-04-21`. Locks the algorithm.
- [x] **`isTradingDayPure("FX", ...)` ECB holidays return false** — table-driven test enumerating all 6 holidays for 2026 + 2027 (12 dates):
  - 2026: 01-01 (Thu/NYD), 04-03 (Fri/GF), 04-06 (Mon/EM), 05-01 (Fri/Labour), 12-25 (Fri/Christmas), 12-26 (Sat — but this case is weekend-dominated; still verify both reasons cause `false`)
  - 2027: 01-01 (Fri/NYD), 03-26 (Fri/GF), 03-29 (Mon/EM), 05-01 (Sat — weekend; same verify-both-reasons), 12-25 (Sat — weekend), 12-26 (Sun — weekend)
  - Adjacent weekday sanity: `isTradingDayPure("FX", "2026-04-02")` (Thu before Good Friday) returns `true`.
- [x] **`latestSettledTradingDayPure("FX", ...)` rolls back past holidays:**
  - `new Date("2026-04-03T18:00:00.000Z")` (Good Friday, after publish) → `"2026-04-02"` (Thursday) [acceptance criterion 1 from ticket — verbatim]
  - `new Date("2026-04-06T18:00:00.000Z")` (Easter Monday, after publish) → `"2026-04-02"` (Thursday — Friday is GF, weekend, Easter Monday all skipped)
  - `new Date("2026-12-28T18:00:00.000Z")` (Monday after Christmas Friday + Boxing Saturday) → `"2026-12-24"` (Thursday, since Christmas is Friday)
  - `new Date("2027-01-04T18:00:00.000Z")` (Monday after NYD on Friday + weekend) → `"2026-12-31"` (Thursday — year-spanning case, exercises cross-year cache)
- [x] **`tradingDaysBetweenPure("FX", ...)` skips ECB holidays:**
  - `("2026-04-01", "2026-04-08", "FX")` — half-open. Walks Apr 2 (Thu: trading, count=1), Apr 3 (Fri/GF: skip), Apr 4-5 (weekend: skip), Apr 6 (Mon/EM: skip), Apr 7 (Tue: count=2), Apr 8 (Wed: count=3). Expected: 3. (Was 5 under weekday-only; delta proves holiday-skipping is active.)
  - Long-range cross-year: `("2026-12-23", "2027-01-05", "FX")`. Manual count of trading days: 12-24 (Thu, count=1), 12-25 (Fri/Christmas: skip), 12-26 (Sat), 12-27 (Sun), 12-28 (Mon, count=2), 12-29 (Tue, count=3), 12-30 (Wed, count=4), 12-31 (Thu, count=5), 01-01 (Fri/NYD: skip), 01-02 (Sat), 01-03 (Sun), 01-04 (Mon, count=6), 01-05 (Tue, count=7). Expected: 7. Verifies cross-year lazy cache works.

### Cross-cutting

- [x] Pre-PR test suite gate per `.claude/rules/full-test-suite.md`: `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`.
- [x] Pre-PR rebuild of `libs/*/dist` if any imports across packages changed (n/a here — change is contained to one apps/api file).
- [ ] Commit message: `fix(api): KZO-192: ECB/TARGET2 holiday awareness for synthetic FX market`. Per `.claude/rules/commit-format.md` — no waiver, ticket exists.
- [ ] PR body MUST follow `docs/git-pr-flow.md §3-4` per `.claude/rules/pr-bound-docs-review-compliance.md`: `## Problem`, `## Solution`, `## Testing` with `Evidence:` block (suite counts), `## Risk/Rollback`.
- [x] PR body must explicitly call out the behavior delta scope: ONLY the `/admin/providers` `frankfurter` row stops flipping "down" on ECB holidays. Per `.claude/rules/interface-caller-verification.md` — verify behavior delta is intentional. Stock holding stale-amber badges are NOT affected.
- [x] PR body must note the documented limitation: ECB one-off emergency closures (system migrations etc.) are NOT in scope; v1 accepts that.
- [ ] Labels: `bug`. Assignee: `@me`. No waiver label.

## Open Items

(None — gap check clean at scope lock.)

## References

- Linear ticket: [KZO-192](https://linear.app/kzokv/issue/KZO-192/synthetic-fx-market-ecb-target2-holiday-awareness)
- Source files in scope:
  - `apps/api/src/services/market-data/tradingCalendar.ts` (~80 LOC additions, 3 line swaps)
- Test files in scope:
  - `apps/api/test/unit/services/market-data/tradingCalendar.test.ts` (1 line fix + ~12 new test cases)
- Untouched but worth noting:
  - `apps/api/src/services/market-data/providerHealth.ts` — single consumer via `calendarMarketForProvider("frankfurter") === "FX"`. No change to this file.
  - `apps/api/src/services/dashboardFreshness.ts` — does NOT use FX path. No change.
- Related tickets:
  - KZO-173 — Option α: equity calendar derived from `daily_bars`. ECB scope is much smaller; hardcoding is a strictly smaller commitment.
  - KZO-177 — provider-health badge consumer.

## ECB / TARGET2 holiday reference (the 6 dates per year)

| Holiday | Rule | Example 2026 | Example 2027 |
|---|---|---|---|
| New Year's Day | Fixed Jan 1 | Thu Jan 1 | Fri Jan 1 |
| Good Friday | Easter − 2 | Fri Apr 3 | Fri Mar 26 |
| Easter Monday | Easter + 1 | Mon Apr 6 | Mon Mar 29 |
| Labour Day | Fixed May 1 | Fri May 1 | Sat May 1 (weekend) |
| Christmas Day | Fixed Dec 25 | Fri Dec 25 | Sat Dec 25 (weekend) |
| Boxing Day | Fixed Dec 26 | Sat Dec 26 (weekend) | Sun Dec 26 (weekend) |

(Tests should include both weekday and weekend-coinciding cases to confirm the logic correctly returns `false` for both reasons.)
