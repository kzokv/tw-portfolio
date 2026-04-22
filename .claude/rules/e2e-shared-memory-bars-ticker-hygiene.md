# MemoryPersistence Daily-Bars: Ticker Hygiene Across Specs

`MemoryPersistence` keeps daily bars in a **single process-global array**, not scoped per user. Every `_seedDailyBars` / `seed-daily-bars` / `seedQuoteBars` call appends — never clears — and `getLatestBars(ticker, n)` returns the two most-recent dates for that ticker across **all** seeds in the process.

This means any new spec that seeds daily bars for a ticker another spec uses will collide at runtime, with symptoms that look like your test is broken when the actual cause is cross-spec contamination.

## Symptoms

- Test seeds a trade for ticker `X` and expects "No market data / missing quote" — fails because another spec seeded bars for `X` earlier in the run.
- Test expects a specific close price for ticker `X` — receives the close from another spec's bars for the same ticker and date.
- Flake pattern: passes in isolation (`--grep "my test"`), fails when the full suite runs.

## The rule

**Any new spec that seeds daily bars must use a ticker that no other spec uses.**

Before adding a new seed, grep to confirm uniqueness:

```bash
grep -rn '"NEW_TICKER"' \
  apps/web/tests/e2e/specs/ \
  apps/web/tests/e2e/specs-oauth/ \
  apps/api/test/http/specs/ \
  apps/api/test/integration/
```

If any match exists outside the new spec, pick another ticker.

## Currently-reserved tickers (avoid)

As of 2026-04-22:
- `2330` — dashboard-daily-change, portfolio-snapshots, quotes-aaa, various dividend/transaction specs
- `2454`, `0050` — portfolio-snapshots, portfolio-transactions, quotes-aaa
- `00919`, `2317` — dashboard-daily-change
- `6770`, `5880`, `6669` — anon-public-view-aaa (KZO-147)
- Any ticker referenced in `quotes-aaa.http.spec.ts` expectations

Safe picks: any TWSE code (4-digit or 5-digit) not in the list above; grep first.

## Why not fix MemoryPersistence?

Possible, but out of scope per ticket-by-ticket. `_seedDailyBars` is test-only (`/__e2e/seed-daily-bars` endpoint) and the global-array pattern mirrors how FinMind delivers catalog-wide data. Per-user scoping would diverge from the production path. Do the grep; don't change the persistence layer.

## Why this is a rule

Promoted from auto-memory after the third relearning threshold (the memory entry itself flagged this as the promotion trigger). Concrete regressions the rule prevents:

- **KZO-147 E2E:** `anon-public-view-rendered-aaa.spec.ts` seeded `2330` / `2454` / `0050` bars at `2026-04-18`, which broke `dashboard-daily-change-aaa.spec.ts` (expected "No market data" for `2330`).
- **KZO-147 HTTP:** `anon-public-view-dto-shape-aaa.http.spec.ts` seeded `2330` bars at `2026-04-18` with close=610, which broke `quotes-aaa.http.spec.ts` (expected close=598).

## How to apply

- When writing any new spec that uses `dashboard.arrange.seedDailyBars` / `quotesApi.actions.seedDailyBars` / `seedQuoteBars` helper, pick a unique ticker and grep-verify it is unused.
- When reviewing a PR that adds bar seeding, run the grep above and flag collisions as a blocking finding.
- Companion code comments already live in `dashboard-daily-change-aaa.spec.ts` (top-of-file NOTE) and `portfolio-snapshots-aaa.spec.ts`. Keep them in sync if the reserved-ticker list above changes.
