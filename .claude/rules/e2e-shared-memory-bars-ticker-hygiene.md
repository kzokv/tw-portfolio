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

As of 2026-05-04 (KZO-172):
- `2330` — dashboard-daily-change, portfolio-snapshots, quotes-aaa, various dividend/transaction specs
- `2454`, `0050` — portfolio-snapshots, portfolio-transactions, quotes-aaa
- `00919`, `2317` — dashboard-daily-change
- `6770`, `5880`, `6669` — anon-public-view-aaa (KZO-147)
- Any ticker referenced in `quotes-aaa.http.spec.ts` expectations

As of 2026-05-02 (KZO-170 — US market data ingestion):
- `AAPL` — us-backfill-aaa.spec.ts (E2E), market-data-price-aaa.http.spec.ts (HTTP). Reserved for KZO-187's us-dividends-aaa.spec.ts when it lands.
- `MSFT` — reserved for us-bars-roundtrip-aaa.spec.ts (KZO-170/future US specs)
- `VOO` — reserved for us-etf-aaa.spec.ts (KZO-170/future US specs)
- `BND` — reserved for us-bond-etf-aaa.spec.ts (KZO-170/future US specs)

Note: MSFT/VOO/BND are currently only referenced in Postgres-backed integration tests (which don't share the global MemoryPersistence bar array). They are listed here to prevent future memory-backed E2E/HTTP specs from accidentally reusing them.

As of 2026-05-02 (KZO-172 — AU market data ingestion via yahoo-finance2):
- `BHP` — au-backfill-aaa.spec.ts (E2E), market-data-price-aaa.http.spec.ts and market-data-search-aaa.http.spec.ts (HTTP). Reserved for KZO-187's au-dividends-aaa.spec.ts when it lands.
- `CSL` — au-backfill-aaa.spec.ts (E2E)
- `VAS` — reserved for au-etf-aaa.spec.ts (KZO-172/future AU specs)
- `WBC` — au-backfill-aaa.spec.ts (E2E)
- `AFI` — reserved for au-lic-aaa.spec.ts (KZO-172/future AU specs)
- `GMG` — reserved for `auStockBackfill.integration.test.ts` (Postgres-only)
- `IMD` — reserved for `auStockBackfill.integration.test.ts` (Postgres-only)
- `CBA` — reserved for KZO-188's `au-ticker-discovery-aaa.spec.ts` (AU discovery test ticker; included in mock `searchInstruments` fixture by Backend Implementer)

Note: GMG/IMD are currently only referenced in Postgres-backed integration tests (which don't share the global MemoryPersistence bar array). They are listed here to prevent future memory-backed E2E/HTTP specs from accidentally reusing them — same precedent as MSFT/VOO/BND in the US section above.

Safe picks: any TWSE code (4-digit or 5-digit) not in the list above, any US ticker not in the US list above, or any ASX ticker not in the AU list above; grep first.

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
