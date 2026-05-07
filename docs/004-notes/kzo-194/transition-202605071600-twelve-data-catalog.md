---
slug: kzo-194
type: transition
created: 2026-05-07
tickets: [KZO-194]
supersedes_in_runbook: docs/002-operations/runbook.md §"Bounded AU catalog"
supersedes_in_arch: docs/001-architecture/backend-db-api.md:1541 (AU bounded catalog bullet)
---

# KZO-194 transition — AU catalog moves from Yahoo 7-ticker reserved set to Twelve Data

## What changed

The AU catalog ingestion path now reads from Twelve Data instead of a hardcoded list:

- **Before (KZO-172):** `YahooFinanceAuMarketDataProvider.fetchInstrumentCatalog()` returned `AU_RESERVED_INSTRUMENTS` — a hardcoded 7-row constant (BHP, CSL, VAS, WBC, AFI, GMG, IMD). Browse Full Catalog → AU showed only those 7 tickers; the daily `catalog-sync` cron upserted the same 7 rows on every run.
- **After (KZO-194):** New `TwelveDataAuCatalogProvider` class fetches `/stocks?exchange=ASX` (~2,013 rows) and `/etf?exchange=ASX` (~449 rows) from Twelve Data's free Basic tier, filters warrants, dedups across endpoints (preferring `/etf` classification), and emits ~2,439 instruments. `YahooFinanceAuMarketDataProvider.fetchInstrumentCatalog()` now returns `[]`. The `AU_RESERVED_INSTRUMENTS` constant is deleted.

Yahoo Finance is **retained** for AU bars/dividends/metadata/search — the new TD class composes a Yahoo provider via `yahooFallback` and delegates `fetchInstrumentMetadata` and `searchInstruments` to it. This preserves KZO-188's live autocomplete and the per-ticker `quote()` enrichment path used by the backfill worker.

## Architectural shape (Option A composition)

```
marketData["AU"] = YahooFinanceAuMarketDataProvider          // bars, dividends (unchanged)
catalog["AU"]    = TwelveDataAuCatalogProvider({              // catalog (new owner)
                     apiKey, baseUrl, rateLimiter,
                     yahooFallback: yahooAuProvider,          // delegate target
                   })

TwelveDataAuCatalogProvider.fetchInstrumentCatalog()  → /stocks + /etf, filter, dedup
TwelveDataAuCatalogProvider.fetchInstrumentMetadata() → yahooFallback.fetchInstrumentMetadata()
TwelveDataAuCatalogProvider.searchInstruments()       → yahooFallback.searchInstruments()
TwelveDataAuCatalogProvider.fetchDelistingHistory()   → []   (matches US precedent)
```

The split was chosen over (B) splitting the `InstrumentCatalogProvider` interface or (C) returning no-op metadata/search from the new provider. Rationale: zero schema delta, zero interface change, zero impact on the backfill worker — only the registry wiring and one provider class moved.

## TD `type` → `instrument_type` classification (truth table)

| TD `type` field        | Endpoint    | `industryCategory` stamped | `classifyInstrument` AU branch result |
|------------------------|-------------|----------------------------|---------------------------------------|
| `Common Stock`         | `/stocks`   | `"Common Stock"`           | `STOCK`                               |
| `ETF`                  | `/etf`      | `"ETF"`                    | `ETF`                                 |
| `REIT`                 | `/stocks`   | `"REIT"`                   | `STOCK` (AU v1 — REIT not distinct)   |
| `Preferred Stock`      | `/stocks`   | `"Preferred Stock"`        | `STOCK`                               |
| `Depositary Receipt`   | `/stocks`   | `"Depositary Receipt"`     | `STOCK`                               |
| `Warrant`              | `/stocks`   | (filtered before mapping)  | (not ingested)                        |

The AU classifier is unchanged: `industryCategory === "ETF" → "ETF"` else `"STOCK"`. The provider stamps `industryCategory = "ETF"` for `/etf` rows so the existing `classifyInstrument` AU branch fires correctly without modification.

## LIC/CEF coverage gap (accepted)

Twelve Data's bulk endpoints do not include some Australian listed investment companies (AFI, ARG, AUI). They are reachable only via `/symbol_search` per-query, which we do not call. Mitigation:

1. **Discovery** — `searchInstruments(query)` delegates to Yahoo's live `search()` SDK call. Users typing "AFI" still get the autocomplete result.
2. **Enrichment** — `fetchInstrumentMetadata(ticker)` delegates to Yahoo's `quote(ticker.AX)`. When the user adds an AFI transaction, the backfill worker enriches the catalog row inline with a real name and metadata.

Net UX: LICs are absent from the Browse Full Catalog grid but fully usable everywhere else.

## Operational changes

- **New env vars:** `TWELVE_DATA_API_KEY` (optional — absence routes to mock per FinMind precedent), `TWELVE_DATA_BASE_URL` (default `https://api.twelvedata.com`), `TWELVE_DATA_RATE_LIMIT_PER_MINUTE` (default 8). `AU_CATALOG_PROVIDER_MOCK` is a separate mock toggle from `AU_PROVIDER_MOCK` (which now scopes to AU bars only).
- **Startup-tick:** `pgBoss.ts` now enqueues `boss.send(CATALOG_SYNC_QUEUE, {}, { singletonKey: CATALOG_SYNC_QUEUE })` immediately after `boss.schedule()`. Without this, a Friday-evening deploy would leave the AU catalog empty until Monday's 17:30 UTC cron tick (~72h gap). The send is singleton-keyed against the same queue key as the cron, so it coalesces if the cron has already fired.
- **Failure path:** `RateLimitedError` is re-thrown to the outer reschedule path (per `typed-transient-error-catch-audit.md`); HTTP 4xx/5xx throw for pg-boss retry. Idempotent upsert preserves yesterday's catalog rows on transient failure — no risk of empty-catalog windows mid-day.
- **Provider health:** `provider_health_status` for `twelve-data-au` is auto-wired via the existing KZO-177 framework. Operators should verify `last_successful_run` populates after the first sync against a real API key.

## Out of scope (deferred)

| Item                                          | Follow-up ticket | Rationale                                                              |
|-----------------------------------------------|------------------|------------------------------------------------------------------------|
| ASX delisting detection                        | KZO-195          | TD bulk endpoints don't expose delisting flags; needs separate path.   |
| GICS / sector classification enrichment        | KZO-196          | TD doesn't provide sector data on free tier.                           |
| Catalog-bootstrap orphan / provider-health "down" symptom | KZO-197 | Structural health-check vs. operational truth — separate scope.        |
| Splits ingestion (replay invariant 6)          | KZO-186          | Pre-existing scope; unaffected by 194.                                 |
| Tax / franking credits                         | (v3 commercial)  | Requires EODHD Fundamentals tier ($59.99/mo).                          |
| Yahoo provider retirement                      | (v3 commercial)  | TD free tier doesn't cover bars/dividends/quotes; retire with EODHD.   |

## Schema delta

**None.** The new provider maps TD fields into existing columns (`ticker`, `name`, `industry_category`, `instrument_type`). FIGI/MIC/CFI columns are deferred to commercialization.

## Test fixture changes (ticker hygiene)

`MockTwelveDataAuCatalogProvider` exports `MOCK_TD_AU_CATALOG_TICKERS = [RIO, STW, SCG, NABPF, RYDAF]` (5 non-Warrant rows; STW is the `/etf`-origin ETF; RIOWAR is the warrant probe entry filtered before emit). E2E synthetic prefixes:

- `AUTEST*` — `apps/api/test/http/specs/au-catalog-browser-aaa.http.spec.ts` (≥100-row catalog assertion).
- `AUCAT*` — `apps/web/tests/e2e/specs/au-catalog-browser-aaa.spec.ts`.

The 7 historical reserved tickers (BHP, CSL, VAS, WBC, AFI, GMG, IMD) are no longer auto-seeded by the catalog-sync cron. They remain reservation-only as test fixtures — see updated `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` AU section for the full reservation table.

## Process notes

- **Phase 3 timing-tangle:** Code review iter-1 found 1 HIGH (wrong `RateLimitedError` constructor in T4 integration test), 1 MEDIUM (missing `/etf` MIC validation unit test), 1 LOW (3 new test files outside `apps/api/test/tsconfig.json` include). All addressed in Phase 4 — including adding the test files to the tsconfig include list, which is the structural fix that prevents this class of false-green typecheck.
- **Iter-2 amendment:** Phase 5 iter-2 surfaced 4 carry-over findings (2 ESLint AAA violations in QA tests, 1 instrument-count assertion drift in `app-config.integration.test.ts`, 1 chip-filter diagnosis in `au-catalog-browser-aaa.spec.ts`). Phase 4 amendment ran QA + Implementer in parallel.
- **Validator activation discipline:** Validator gated strictly on Architect-issued `[GO]` per `validator-activation-gate.md`. No unauthorized runs recorded.

## References

- Locked scope: `docs/004-notes/kzo-194/scope-todo-202605071412-locked.md`
- Iter-1 review: `docs/004-notes/kzo-194/review-202605071445-iter1.md`
- Spike (catalog-source decision): `docs/004-notes/kzo-171/spike-202605021634-au-provider-spike.md`
- Updated rule: `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` (AU section)
- Updated runbook: `docs/002-operations/runbook.md` §"AU catalog (Twelve Data, KZO-194)"
- Updated arch doc: `docs/001-architecture/backend-db-api.md` (AU catalog bullet)
- Updated memory: `.claude/memory/project_market_data_architecture.md` §"Twelve Data AU catalog provider (KZO-194)"
