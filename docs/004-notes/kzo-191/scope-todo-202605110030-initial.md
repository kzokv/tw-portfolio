---
slug: kzo-191
source: scope-grill
created: 2026-05-11
tickets: [KZO-191]
required_reading: []
superseded_by: null
---

# Todo: KZO-191 — Refactor weekend/non-trading-day logic to use TradingCalendarCache helpers

> **For agents starting a fresh session:** read this entire file plus the Linear ticket KZO-191 before starting implementation. Pay particular attention to the "Locked design decisions" section — the ticket's literal wording was extended in scope-grill to fix two latent correctness defects in `computeIsProvisional`, not just remove `getUTCDay()` lexically.

## Locked design decisions

### D1 — Reframe `computeIsProvisional` around `latestSettledTradingDay`

`apps/api/src/services/market-data/quoteSnapshotService.ts:67` currently uses `getUTCDay()` against a TST-converted clock — structurally wrong for US/AU tickers and a known latent bug since KZO-170/172 expanded markets.

Replace with: `isProvisional = barDate < latestSettledTradingDay(marketCode, now)`. Fixes both the TST-hardcoding and the "trading-day-morning before today's bar lands" regression that a naive `isTradingDay` swap would introduce (`isTradingDay` is backward-looking — false on a real trading-day morning before bars are ingested).

### D2 — Tolerant pair signature for `resolveQuoteSnapshots`

```ts
export async function resolveQuoteSnapshots(
  pairs: Array<{ ticker: string; marketCode?: MarketCode }>,
  persistence: Persistence,
  settledByMarket: ReadonlyMap<MarketCode, string>,
  now?: Date,
): Promise<Record<string, QuoteSnapshot | null>>
```

- Pairs are tolerant: missing `marketCode` → `isProvisional = false` (unifies the "manual instrument" and "`/quotes` raw-list" fallbacks under one rule).
- `settledByMarket` is pre-resolved by the caller, one entry per distinct `marketCode` in the pair set — keeps the service pure (no `TradingCalendarCache` dep) and mirrors KZO-177's `enrichHoldingsWithFreshness` shape.
- `now?: Date` testability hook, same pattern as `enrichHoldingsWithFreshness`.
- Result map keyed by bare `ticker` — cross-listed `BHP/AU` vs `BHP/US` collision is pre-existing per the `getLatestBars(tickers)` shape and explicitly out of scope.

### D3 — Reason discriminator semantics

Keep `"weekend" | "no_bar"` union as-is. `"weekend"` literal widens to mean "non-trading day" (weekend OR holiday-with-bar-missing). No web/i18n changes — `apps/web/components/portfolio/AddTransactionCard.tsx:79-82` and `apps/web/features/portfolio/i18n.ts:106-107` map both reasons to identical copy ("Previous close • {date}"), so the semantic widening is invisible to users. No `"holiday"` variant.

### D4 — Route-level swap (literal AC compliance)

In `apps/api/src/routes/registerRoutes.ts`:

- Delete `isWeekendIsoDate` (line 1299).
- `GET /market-data/price` handler (~line 3155) awaits `app.tradingCalendarCache.isTradingDay(query.market_code, query.date)` once before calling the response builders.
- `buildPriceLookupResponse` and `buildFetchedPriceLookupResponse` accept a new `requestedDateIsTradingDay: boolean` arg. Their `reason` becomes `requestedDateIsTradingDay ? "no_bar" : "weekend"`. Builders stay sync.

### D5 — Manual-instrument and unknown-market fallback

When a pair has no `marketCode` (either because the consumer didn't supply one, like `/quotes`, or because the `store.instruments` lookup returned undefined for a manual instrument), `isProvisional = false`. Single rule, single code path.

## Implementation Steps

- [x] **Step 1 — Modify `apps/api/src/services/market-data/quoteSnapshotService.ts`:**
  - Updated `resolveQuoteSnapshots` signature per D2 — now takes `(pairs, persistence, settledByMarket)`. `now?: Date` testability hook moved to the caller-side helper (`buildQuoteSnapshotInputs`) since `settledByMarket` is pre-resolved; tests inject `settledByMarket` directly. Functionally equivalent, cleaner test surface.
  - Rewrote `computeIsProvisional(barDate, marketCode?, settledByMarket)` per D1 + D5.
  - Service stays sync (per-market settled lookup is pre-resolved outside).
- [x] **Step 2 — Updated 4 callers in `apps/api/src/routes/registerRoutes.ts`:**
  - L2611 (`anonymous share view`), L3677 (`/dashboard/overview`), L3736 (`/dashboard/performance`) — use new `buildQuoteSnapshotInputs(app, store, tickers)` helper.
  - L4294 (`/quotes`) — passes pairs with no marketCode; falls into the `isProvisional = false` fallback.
  - **Extracted `buildQuoteSnapshotInputs` into the route file** (4 callers × ~5 lines justified the extraction).
- [x] **Step 3 — Route-level swap in `apps/api/src/routes/registerRoutes.ts` per D4:**
  - Deleted `isWeekendIsoDate` function.
  - `buildPriceLookupResponse` and `buildFetchedPriceLookupResponse` accept `requestedDateIsTradingDay: boolean`.
  - `GET /market-data/price` handler awaits `app.tradingCalendarCache.isTradingDay(query.market_code, query.date)` once after `query` parse; threads the boolean into both builders.
- [x] **Step 4 — Added 3 new unit-test cases (TC-U9/U10/U11) plus updated TC-U1–U8 for the new signature.** Also tightened TC-U5/U6 to use `settledByMarket` directly instead of `vi.useFakeTimers` TST hack.
- [x] **Step 5 — Pre-PR verification grep:** `isWeekendIsoDate` → only the explanatory comment match in `registerRoutes.ts:3208` remains (function deleted). `getUTCDay` → zero matches in `apps/api/src/routes` and `apps/api/src/services/market-data/quoteSnapshotService.ts`. All 4 `resolveQuoteSnapshots` call sites use the new signature.
- [x] **Step 6 — Full test suite results:**
  - Suite 1 (lint): ✅ green (worktree noise excluded — pre-existing junk in `.claude/worktrees/`).
  - Suite 2 (typecheck): ✅ API green (all 4 tsconfigs). Web has pre-existing `Tabs.tsx` error on missing `@radix-ui/react-tabs` install — reproduces on dev HEAD without changes.
  - Suite 3 (web unit): 48/51 files green, 352 tests pass. 3 AdminSettingsClient files fail on the same pre-existing missing-dep root cause.
  - Suite 4 (API unit + memory): ✅ 1252 passed, 370 skipped (146 files). Includes 11 quoteSnapshotService cases.
  - Suite 5 (Postgres integration): ✅ 676 passed, 1 skipped (69 files), 315s.
  - Suites 6, 7 (E2E): blocked by the same pre-existing web build failure.
  - Suite 8 (API HTTP): ✅ 251 passed, 2 skipped, 22.5s. Includes `/market-data/price` route tests.
- [ ] **Step 7 — PR description structural compliance** (per `.claude/rules/pr-bound-docs-review-compliance.md`):
  - `## Problem` — TST hardcoding in `computeIsProvisional` + `getUTCDay()` ignores holidays.
  - `## Solution` — Reframe around `latestSettledTradingDay`; tolerant pair signature; route-level helper swap.
  - `## Testing` — `Evidence:` block with suite results from Step 6.
  - `## Risk/Rollback` — Reason discriminator semantic widening ("weekend" now fires on holidays); revert by restoring `isWeekendIsoDate` and reverting service signature.
  - **Behavioral deltas explicitly called out:** (1) `isProvisional` now market-aware; previously TST-only. (2) `"weekend"` discriminator widens to "non-trading day". (3) `resolveQuoteSnapshots` signature change — listed as renamed-types table.

## Out of scope (documented, intentional)

- `apps/api/src/services/market-data/tradingCalendar.ts:75` (`isWeekdayIsoDate` — bootstrap fallback inside the helper itself; rewriting would be circular).
- `apps/api/src/services/market-data/providers/mockFinmindUsStock.ts:64` (deterministic synthetic-bar generator; coupling to live cache defeats the mock's purpose).
- `apps/api/src/services/market-data/providers/mockYahooFinanceAu.ts:63` (same as above).
- Cross-listed `.find(item => item.ticker === symbol)` collision in `store.instruments` lookups — pre-existing pattern shared with KZO-177's `enrichHoldingsWithFreshness`.
- Result-map key collision on bare-ticker cross-listed pairs — pre-existing per the `getLatestBars(tickers)` shape.
- Renaming or dropping the `"weekend"` discriminator string — future cleanup ticket; D3 keeps the literal but widens the semantics.
- New `"holiday"` reason variant — ticket called it optional; UI maps both existing reasons to identical copy, so it'd be carrying weight nobody reads.

## Open Items

None — all decisions resolved in Phase 1 / 1.5.

## References

- Linear ticket: KZO-191
- Related tickets: KZO-173 (TradingCalendarCache helper origin), KZO-177 (freshness DTO pattern this mirrors), KZO-170 / KZO-172 (US / AU market expansion that surfaced the TST-hardcoding defect).
- Companion rules:
  - `.claude/rules/interface-caller-verification.md` — grep callers before signature change (Step 5).
  - `.claude/rules/process-refactor-rename-verification.md` — list signature change in PR body (Step 7).
  - `.claude/rules/service-error-pattern.md` — no new throws introduced.
  - `.claude/rules/full-test-suite.md` — definition of "all tests pass" (Step 6).
  - `.claude/rules/pr-bound-docs-review-compliance.md` — PR body structural compliance (Step 7).
  - `.claude/rules/commit-format.md` — commit subject shape (`refactor(api): KZO-191: ...`).
