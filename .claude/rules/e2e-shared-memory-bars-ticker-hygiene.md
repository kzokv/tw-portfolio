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
- `AFI` — reserved for au-lic-aaa.spec.ts (KZO-172/future AU specs); also referenced in KZO-194 `auLicMetadataDelegation.integration.test.ts` (Postgres-only)
- `GMG` — reserved for `auStockBackfill.integration.test.ts` (Postgres-only)
- `IMD` — reserved for `auStockBackfill.integration.test.ts` (Postgres-only)
- `CBA` — reserved for KZO-188's `au-ticker-discovery-aaa.spec.ts` (AU discovery test ticker; included in mock `searchInstruments` fixture by Backend Implementer)

Note: GMG/IMD are currently only referenced in Postgres-backed integration tests (which don't share the global MemoryPersistence bar array). They are listed here to prevent future memory-backed E2E/HTTP specs from accidentally reusing them — same precedent as MSFT/VOO/BND in the US section above.

**Status change post-KZO-194:** BHP/CSL/VAS/WBC/AFI/GMG/IMD were originally seeded into `market_data.instruments` by every catalog-sync run via the hardcoded `AU_RESERVED_INSTRUMENTS` constant in `yahooFinanceAu.ts`. KZO-194 deleted that constant — `YahooFinanceAuMarketDataProvider.fetchInstrumentCatalog()` now returns `[]` and the AU catalog is sourced from `TwelveDataAuCatalogProvider`. The 7 tickers are no longer auto-seeded by the catalog-sync cron; they are now reservation-only as test fixtures. Specs that previously assumed these rows would be present in `instruments` after a sync run must seed explicitly (see `auLicMetadataDelegation.integration.test.ts` for the AFI pattern).

As of 2026-05-07 (KZO-194 — Twelve Data AU catalog provider):
- `AUTEST*` — synthetic prefix used by `apps/api/test/http/specs/au-catalog-browser-aaa.http.spec.ts` for ≥100-row catalog assertions. Do not reuse for any non-KZO-194 spec.
- `AUCAT*` — synthetic prefix used by `apps/web/tests/e2e/specs/au-catalog-browser-aaa.spec.ts` (chosen to avoid collision with `AUTEST`). Do not reuse.
- `RIO`, `STW`, `SCG`, `NABPF`, `RYDAF`, `RIOWAR` — fixture tickers for `MockTwelveDataAuCatalogProvider` exported as `MOCK_TD_AU_CATALOG_TICKERS`. Used by `auCatalogSyncTwelveData.integration.test.ts` and `auStockBackfill.integration.test.ts` case 6. STW is the `/etf`-origin row; RIOWAR is the warrant filter probe.

As of 2026-05-09 (KZO-195 — ASX delisting detection via consecutive-absence diff):
- `AUDEL*` — synthetic prefix (`AUDEL01`, `AUDEL02`, `AUDEL90`, etc.) used by `apps/api/test/integration/auCatalogDelistingDetector.integration.test.ts` for absence-detection streak/guard/undelete/exclude test cases, and by `apps/api/test/http/specs/admin-instruments-aaa.http.spec.ts` and `apps/web/tests/e2e/specs-oauth/admin-instruments-aaa.spec.ts` for undelete/exclude admin endpoint tests. Do not reuse for any non-KZO-195 spec.

As of 2026-05-09 (KZO-196 — AU sector / GICS enrichment):
- `AUGICS*` — synthetic prefix used across the GICS enrichment test surface. Do not reuse for any non-KZO-196 spec. Reserved tickers:
  - `AUGICS01`–`AUGICS05` — E2E spec `apps/web/tests/e2e/specs/au-catalog-sector-filter-aaa.spec.ts` (sector-filter visibility, filter narrowing, live-search bypass, industry-group label render)
  - `AUGICS99` — integration spec `apps/api/test/integration/asxGicsCatalogSync.integration.test.ts` ASX-only ticker case (unmatched ticker in DB — never in the CSV fixture)
  - `AUGICSH00001`–`AUGICSH05001` — sanity-high case in the same integration spec (> 5 000 rows fixture; these tickers are synthetic header-row anchors)
  - `AUGICSG1` / `TWGICSG1` — migration cleanup case in the same integration spec; `AUGICSG1` is an AU row expected to have `industry_category_raw` NULLed by migration 050; `TWGICSG1` is a TW row that must be left unchanged

As of 2026-05-09 (KZO-197 — AU catalog warm-up bootstrap):
- `AUWARM*` — synthetic prefix used across the AU catalog-rerun-union test surface (the `yahoo-finance-au` "Re-run now" button now performs a union of catalog warm-up + monitored refresh). Do not reuse for any non-KZO-197 spec. Reserved tickers:
  - `AUWARM01`–`AUWARM05` — `apps/api/test/integration/auCatalogRerunUnion.integration.test.ts` fresh-deploy case: 5 AU `bars_backfill_status='pending'` rows with no monitored entries → catalog warm-up enqueues 5 jobs.
  - `AUWARM06`–`AUWARM07` — same integration test post-warm-up case: 2 rows promoted to `bars_backfill_status='ready'` AND added to `user_monitored_tickers`; subsequent rerun produces 3 catalog-warm-up jobs (`AUWARM01`–`AUWARM03`) + 2 monitored-refresh jobs (`AUWARM06`–`AUWARM07`).
  - `AUWARM08`–`AUWARM10` — reserved for `apps/web/tests/e2e/specs-oauth/provider-health-aaa.spec.ts` AU rerun case (seed `AUWARM08`–`AUWARM10` as `pending` so the click produces a non-zero `tickerCount` from the catalog warm-up branch).

As of 2026-05-13 (ui-enhancement — account soft-delete and form fixes):
- `ACCDEL*` — synthetic prefix for account-deletion fixture tickers. Do not reuse for any non-ui-enhancement spec. Reserved tickers:
  - `ACCDEL01`, `ACCDEL02`, `ACCDEL03` — `apps/web/tests/e2e/specs-oauth/account-deletion-aaa.spec.ts`: seed BUY trade on each ticker into the test account; soft-delete account; verify holdings disappear from dashboard; restore account; verify holdings reappear.
  - `ACCDEL04` — `apps/web/tests/e2e/specs-oauth/transaction-fee-tax-render-aaa.spec.ts`: 4-tuple gate fixture (any single ticker suffices; reserved to prevent collision).
  - `ACCDEL05` — `apps/web/tests/e2e/specs-oauth/transaction-market-chip-aaa.spec.ts`: chip auto-sync fixture.

Pre-PR grep for this prefix:
```bash
grep -rn '"ACCDEL0[1-5]"' apps/web/tests apps/api/test
```
Every match must be in the three specs above.

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
