# Dividends Review performance evidence

Generated: 2026-07-13T09:43:51.921Z

Method: compiled API plus production-built Next standalone; 20 measured samples per scenario after an excluded warm-up; PostgreSQL fixture with 280 rows across 2020–2026. Browser timings use Chromium and user-visible committed row identities. Raw response headers, Server-Timing segments, row identities, and wrong-query-frame observations are in `raw.json`.

Measured base commit: `893cca462126567c2e3179ebc9cf23491534bf70`
Environment: darwin 25.2.0; Apple M1 Pro (Virtual); isolated local PostgreSQL 15; 280-row realistic fixture

The measurement ran from the complete feature working tree before its commits were created. That tree was later rebased without conflicts onto `origin/dev` at `be883f105c32d678c729556f9a6376321d4e4951`, and the eight repository validation suites were rerun successfully after the rebase.

Runner command: `PERF_SAMPLES=20 PERF_WEB_URL=http://localhost:3777 PERF_API_URL=http://localhost:4400 PERF_COMMIT=893cca462126567c2e3179ebc9cf23491534bf70 node docs/notes/dividend-review-performance/run-performance-measurement.mjs`. The fixture is created by `seed-performance-postgres.ts` after setting `DB_URL` to a disposable migrated database.

## Baseline comparison

The validated deployed-dev baseline was approximately 45 seconds to first rows, 58 seconds to full load, 3 seconds per current-year sort, and 9.5–10.6 seconds per all-years pagination transition. The post-change measurements below use an isolated local PostgreSQL 15 database with a deterministic realistic 280-row fixture and production-built web/API artifacts. They are repeatable acceptance evidence, not a claim that local hardware and the deployed dev environment are identical; a deployed follow-up remains useful for infrastructure-level comparison.

| Scenario | Samples | Median ms | P95 ms | Max ms | Budget |
|---|---:|---:|---:|---:|---:|
| Primary API (all sorts) | 480 | 21.0 | 40.0 | 92.8 | <800 ms P95 |
| Enrichment API | 20 | 15.8 | 47.7 | 71.2 | <5000 ms P95 |
| Cold usable table | 20 | 682.7 | 958.3 | 1022.2 | <2500 ms P95 |
| Cold enrichment complete | 20 | 890.6 | 1348.0 | 1414.7 | <5000 ms P95 |
| Sort interactions | 480 | 163.0 | 438.1 | 740.1 | <1500 ms P95 |
| Pagination interactions | 40 | 69.5 | 155.8 | 277.4 | <1500 ms P95 |
| Page-size interactions | 60 | 51.9 | 89.7 | 101.4 | <1500 ms P95 |
| Filter primary | 20 | 54.6 | 132.4 | 137.6 | <1500 ms P95 |
| Loading feedback | 560 | 9.7 | 51.9 | 92.4 | <100 ms P95 |

Wrong-query frames: 0. Pagination identity failures: 0.

## Sort scenarios

| Sort | Samples | Median ms | P95 ms | Max ms |
|---|---:|---:|---:|---:|
| paymentDate:asc | 20 | 318.5 | 479.9 | 497.9 |
| paymentDate:desc | 20 | 150.3 | 263.2 | 268.5 |
| ticker:asc | 20 | 262.8 | 648.4 | 712.3 |
| ticker:desc | 20 | 184.7 | 258.5 | 311.9 |
| account:asc | 20 | 289.0 | 457.9 | 467.0 |
| account:desc | 20 | 237.3 | 335.3 | 358.6 |
| expectedGrossAmount:asc | 20 | 274.2 | 530.2 | 571.3 |
| expectedGrossAmount:desc | 20 | 205.3 | 300.3 | 336.1 |
| receivedCashAmount:asc | 20 | 225.8 | 438.1 | 446.1 |
| receivedCashAmount:desc | 20 | 195.3 | 262.9 | 292.1 |
| nhiAmount:asc | 20 | 223.9 | 501.4 | 740.1 |
| nhiAmount:desc | 20 | 195.0 | 440.7 | 510.8 |
| bankFeeAmount:asc | 20 | 125.4 | 170.1 | 249.3 |
| bankFeeAmount:desc | 20 | 117.2 | 202.2 | 217.8 |
| otherDeductionAmount:asc | 20 | 141.4 | 184.8 | 322.1 |
| otherDeductionAmount:desc | 20 | 129.2 | 311.6 | 467.3 |
| expectedNetAmount:asc | 20 | 184.0 | 460.1 | 504.1 |
| expectedNetAmount:desc | 20 | 130.1 | 230.1 | 289.8 |
| actualNetAmount:asc | 20 | 144.2 | 198.4 | 205.5 |
| actualNetAmount:desc | 20 | 132.1 | 221.2 | 262.8 |
| varianceAmount:asc | 20 | 112.4 | 141.2 | 188.3 |
| varianceAmount:desc | 20 | 97.3 | 169.2 | 174.9 |
| reconciliationStatus:asc | 20 | 130.7 | 172.5 | 275.5 |
| reconciliationStatus:desc | 20 | 85.0 | 143.3 | 162.0 |
