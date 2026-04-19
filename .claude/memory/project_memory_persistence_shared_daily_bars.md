---
name: MemoryPersistence daily-bars ticker hygiene
description: `_seedDailyBars` / `seedDailyBars` / `seedQuoteBars` append to a process-global non-per-user array; tests seeding the same ticker collide across specs
type: project
---

`MemoryPersistence` keeps daily bars in a single process-global array, **not** scoped per user. Every `_seedDailyBars` / `seed-daily-bars` call appends — never clears — and `getLatestBars(ticker, n)` always returns the two most-recent dates for that ticker across all seeds in the process.

## Symptoms of contamination

- A test that seeds a trade for ticker `X` and expects "No market data / missing quote" suddenly fails because another spec seeded bars for `X` earlier in the run.
- A test that expects a specific close price for ticker `X` receives the close from another spec's bars for the same ticker and date.

Concrete regressions:
- **KZO-147 E2E:** `anon-public-view-rendered-aaa.spec.ts` seeded `2330` / `2454` / `0050` bars at `2026-04-18`, which broke `dashboard-daily-change-aaa.spec.ts` (expected "No market data" for `2330`).
- **KZO-147 HTTP:** `anon-public-view-dto-shape-aaa.http.spec.ts` seeded `2330` bars at `2026-04-18` with close=610, which broke `quotes-aaa.http.spec.ts` (expected close=598).

## Rule

**Any new spec that seeds daily bars must use a ticker that no other spec uses.** The existing popular tickers to avoid (as of 2026-04-19):

- `2330` — dashboard-daily-change, portfolio-snapshots, quotes-aaa, various dividend/transaction specs
- `2454`, `0050` — portfolio-snapshots, portfolio-transactions, quotes-aaa
- `00919`, `2317` — dashboard-daily-change
- Any ticker referenced in `quotes-aaa.http.spec.ts` expectations

Safe, currently-unused tickers for anon-share specs: `6770`, `5880`, `6669` (real TWS codes; reserved by KZO-147 anon-public-view specs).

## Before adding a new seed

```bash
# Check that your intended ticker isn't already seeded or asserted elsewhere.
grep -rn '"NEW_TICKER"' apps/web/tests/e2e/specs/ apps/api/test/http/specs/ apps/api/test/integration/
```

If any match exists outside the new spec, pick another ticker.

## Why not fix MemoryPersistence?

Possible, but out of scope per ticket-by-ticket; `_seedDailyBars` is test-only (`/__e2e/seed-daily-bars` endpoint) and the global-array pattern mirrors how FinMind delivers catalog-wide data. A per-user scoping would diverge from the production path.

## How to apply

- When writing any new spec that uses `dashboard.arrange.seedDailyBars` / `quotesApi.actions.seedDailyBars` / `seedQuoteBars` helper, pick a unique ticker and grep-verify it is unused.
- When reviewing a PR that adds bar seeding, run the grep above and flag collisions.
- Companion code comments already exist in `dashboard-daily-change-aaa.spec.ts` (top-of-file NOTE) and `portfolio-snapshots-aaa.spec.ts`.

**Watch for:** if this rule is relearned a third time, promote to `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`.
