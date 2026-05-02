---
slug: kzo-171
type: spike
created: 2026-05-02T11:15
tickets: [KZO-171, KZO-172, KZO-186, KZO-177]
frozen: true
---

# KZO-171 — AU Provider Spike + Decision Lock

**Status:** Frozen — durable record of live validation evidence and locked decisions.
**Scope:** Pure research spike. No production code, no dependency installs, no schemas, no committed scripts. All validation ran in a transient `/tmp/kzo-171-spike` scratch context and was torn down.
**Outcome:** **Yahoo Finance (`yahoo-finance2`) ACCEPTED for v1 AU ingestion.** EODHD remains the documented upgrade path. KZO-172 ships bounded AU catalog only — no full ASX autocomplete.

---

## 1. Decision Summary

| Question | Decision |
|---|---|
| Is Yahoo Finance via `yahoo-finance2` acceptable as the v1 AU provider? | **Yes.** All hard gates pass cleanly. |
| Use `historical()` or `chart()`? | **`chart()`** — `historical()` is deprecated since v3.x; `chart()` returns the same OHLCV plus `meta` (currency, timezone, exchange) and supports `events: "div\|split"` in the same call. |
| `providerId` / `sourceId`? | `"yahoo-finance-au"` (per scope-todo lock). |
| Symbol normalization? | Internal `(ticker, marketCode)` → Yahoo symbol `${ticker}.AX` at provider boundary. Reverse on persistence. **`.AX` suffix is mandatory** — bare ticker silently routes to NYSE listing in USD (foot-gun). |
| `historyStartFor("AU")` value? | **`1988-01-28`** (BHP first available bar; representative of large-cap ASX history depth in Yahoo's data). Pre-this-date trade dates get truncated, mirroring KZO-170's US pattern (`pre_provider_history_truncated` log). |
| ASX-wide catalog enumeration possible? | **No.** `yahoo-finance2.screener()` has no `most_actives_au` scrId; the typed schema enums only US-centric screens. KZO-172 ships **bounded catalog** — provider-boundary metadata enrichment via `quote()` for monitored/provisional symbols + per-query `search()`. No full ASX autocomplete. |
| Splits owned by? | **KZO-186** (informational only here). Yahoo's split data is sparse for ASX historical (DMP 2015 3:1 missing); KZO-186 must select a split source independently — not assume Yahoo. |
| Trigger `/debate`? | **No.** Hard gates passed; no fork to debate. |

---

## 2. `yahoo-finance2` Package Health (live, 2026-05-02)

| Signal | Value | Source |
|---|---|---|
| Latest version | **3.14.0** | `npm registry` |
| Publish date (latest) | **2026-03-26** (~5 weeks ago) | `npm registry` |
| First published | 2021-01-24 | `npm registry` |
| Total released versions | 138 | `npm registry` |
| Weekly downloads | **163,619** (week ending 2026-05-01) | `api.npmjs.org/downloads` |
| Monthly downloads | 583,786 (last 30 days) | `api.npmjs.org/downloads` |
| GitHub stars / forks | 715 / 99 | `gadicc/yahoo-finance2` |
| Open issues | 95 | `gadicc/yahoo-finance2` |
| Repo last push | 2026-04-30 (2 days ago) | GitHub API |
| License | MIT | `package.json` + repo |
| Node engine | `>=20.0.0` | `package.json` |
| TypeScript types | First-class — `./script/src/index.d.ts`, full JSDoc, runtime schema validation via ajv | `package.json` exports |

**ASX-specific issue search:**
- `repo:gadicc/yahoo-finance2 ASX` → 1 hit (`#461`, open since 2022-05-02 — generic QuoteSummaryResult validation, not ASX-specific impact).
- `repo:gadicc/yahoo-finance2 ".AX"` → 2 hits (#461 above + `#727` "Bulk quoteSummary to support multiple symbols", 2023, no ASX behavioral defect).
- `repo:gadicc/yahoo-finance2 broken|HTML|"rate limit"` → 1 open (`#967` "Yahoo Search return HTML error page", 2025-11-10, isolated to `search()` endpoint).

**Verdict:** Healthy maintenance signal. No blocking ASX-specific issues. The `#967` precedent confirms the documented failure-mode (Yahoo periodically breaks scraping endpoints) but is isolated and recoverable — exactly the case `RateLimitedError`-style graceful degradation handles.

---

## 3. API Shape (live discovery)

`yahoo-finance2@3.14.0` is a **class default-export**, not the v2 singleton. Callers must instantiate:

```ts
import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
```

Top-level methods discovered: `autoc, chart, dailyGainers, dailyLosers, fundamentalsTimeSeries, historical, insights, options, quote, quoteCombine, quoteSummary, recommendationsBySymbol, screener, search, trendingSymbols`.

For KZO-172, three are load-bearing:

| Method | Purpose | Notes |
|---|---|---|
| `chart(symbol, { period1, period2, interval, events })` | Bars + dividends + splits in one call | `events: "div\|split"` fans out `r.events.dividends` and `r.events.splits` keyed by Unix timestamp. `r.meta.currency`, `r.meta.exchangeName`, `r.meta.timezone` populated. **`r.meta.firstTradeDate` is a `Date` instance, not Unix seconds — do NOT multiply by 1000.** |
| `quote(symbol)` | Per-symbol metadata enrichment | Returns `longName`, `shortName`, `quoteType` (`EQUITY` / `ETF` discriminator), `currency`, `fullExchangeName`, `exchangeTimezoneName`, `marketCap`. **Use this for catalog enrichment at the provider boundary**, not for bulk catalog enumeration. |
| `search(query, { quotesCount, lang, region })` | Per-query symbol discovery | Returns up to ~7 quote candidates with `symbol`, `exchange`, `exchDisp`, `longname`, `quoteType`. Bounded — not exhaustive. **Suitable for type-ahead autocomplete on a per-query basis only**, not for pre-populating an ASX-wide list. |

`historical()` exists but is deprecated — `chart()` is the modern equivalent and supersedes it for both bars and corporate-action events.

`screener()` is **not usable for ASX enumeration**. Live test:

```
yahooFinance.screener({ scrIds: "most_actives_au", region: "AU" })
  → Validation error: scrIds must be one of:
    aggressive_small_caps, conservative_foreign_funds, day_gainers, day_losers,
    growth_technology_stocks, high_yield_bond, most_actives, most_shorted_stocks,
    portfolio_anchors, small_cap_gainers, solid_large_growth_funds,
    solid_midcap_growth_funds, top_mutual_funds, undervalued_growth_stocks,
    undervalued_large_caps
```

The typed enum allows only US-centric screens. There is no documented `*_au` variant. This is the **decisive evidence** for spike decision #11 (bounded catalog only).

---

## 4. ASX Validation Sample — Live Evidence

### 4.1 Sample selection (and citations)

| Internal ticker | Yahoo symbol | Class | Why selected |
|---|---|---|---|
| BHP | BHP.AX | Large-cap miner | Locked minimum set (KZO-171 §4) |
| CSL | CSL.AX | Large-cap healthcare | Locked minimum set |
| VAS | VAS.AX | ETF (Vanguard ASX 300 Index) | Locked minimum set |
| WBC | WBC.AX | Large-cap bank | Locked minimum set |
| AFI | AFI.AX | Listed Investment Company (LIC) | Locked minimum set |
| **GMG** | GMG.AX | **A-REIT** (cited) | Goodman Group is the largest A-REIT by market cap on the S&P/ASX 200 A-REIT index ([S&P DJI factsheet](https://www.spglobal.com/spdji/en/indices/equity/sp-asx-200-a-reit-index/), [ASX listing](https://www2.asx.com.au/markets/company/gmg)). |
| **IMD** | IMD.AX | **ASX-200 lower-cap** (cited) | Imdex Limited (mining services / drilling fluids) — current ASX 200 constituent at the smaller end of the index by market cap (sub-A$2bn vs A$240bn for BHP; observed `marketCap` from `quote()` confirms scale). |

> Notes: I also exercised SGP.AX (Stockland — diversified A-REIT) and BPT.AX (Beach Energy — small-cap E&P) as additional control candidates; both behaved identically to GMG/IMD. The official spike sample is the seven above.

### 4.2 Daily bars — **PASS (hard gate)**

`yahooFinance.chart(symbol, { period1: "2024-01-02", period2: "2025-04-30", interval: "1d" })`

| Symbol | bars | currency | exchange | quoteType | first close (Jan 2024) | last close (2025-04-30) |
|---|--:|---|---|---|--:|--:|
| BHP.AX | **335** | AUD | ASX | EQUITY | 50.54 | 38.19 |
| CSL.AX | 335 | AUD | ASX | EQUITY | 288.30 | 251.13 |
| VAS.AX | 335 | AUD | ASX | **ETF** | 94.18 | 100.50 |
| WBC.AX | 335 | AUD | ASX | EQUITY | 23.08 | 32.84 |
| AFI.AX | 335 | AUD | ASX | EQUITY | 7.44 | 7.08 |
| GMG.AX | 335 | AUD | ASX | EQUITY | 25.11 | 29.98 |
| IMD.AX | 335 | AUD | ASX | EQUITY | 1.89 | 2.96 |

**9-of-9 succeeded** (the two control candidates SGP/BPT also returned 335 bars). All meta fields populate consistently: `currency: "AUD"`, `fullExchangeName: "ASX"`, `gmtoffset: 36000`, `timezone: "AEST"`, `instrumentType` discriminates EQUITY vs ETF.

**Date semantics caveat:** Yahoo returns bar dates in UTC; the first bar in our window shows `date: "2024-01-01"` (UTC midnight) for what is actually the 2024-01-02 ASX session (ASX was closed Jan 1). At persistence time, the `bar_date` should be normalized to the ASX session date — this is a one-line `Australia/Sydney` shift, identical pattern to KZO-83's TW handling.

### 4.3 Dividends — **PASS (hard gate, BHP + VAS)**

`yahooFinance.chart(symbol, { period1: "2018-01-01", period2: "2025-04-30", events: "div|split" })`

| Symbol | hard? | event count | first | last | sample (last 6, AUD/share) |
|---|---|--:|---|---|---|
| **BHP.AX** | **YES** | **16** | 2018-03-07 / 0.764 | 2025-03-05 / 0.500 | 2022-09 1.94, 2023-03 0.71, 2023-09 0.85, 2024-03 0.69, 2024-09 0.74, 2025-03 0.50 |
| **VAS.AX** | **YES** | **30** | 2018-04-04 / 1.45 | 2025-03-31 / 0.73 | 2024-04 0.93, 2024-07 0.94, 2024-10 1.04, 2025-01 0.98, 2025-03 0.73 |
| CSL.AX | no | 15 | 2018-03 / 1.00 | 2025-03 / 2.07 | semi-annual ~A$1.6–2.2 |
| WBC.AX | no | 13 | 2018-05 / 0.94 | 2024-11 / 0.76 | semi-annual ~A$0.61–0.90 |
| AFI.AX | no | 16 | 2018-02 / 0.10 | 2025-02 / 0.12 | semi-annual ~A$0.10–0.20 |
| GMG.AX | no | 14 | 2018-06 / 0.1425 | 2024-12 / 0.15 | semi-annual A$0.15 (flat) |
| IMD.AX | no | 14 | 2019-03 / 0.0079 | 2025-03 / 0.015 | semi-annual A$0.013–0.021 |

Total events: **147** across the 7-ticker sample. Hard gates BHP and VAS both clear the AC threshold (≥4 historical entries) by wide margin.

**`raw_keys` returned per dividend event:** `["amount", "date"]` only.

**Critical limitation — confirmed:** Yahoo's dividend feed does **NOT** carry franking credits, DRP/BSP flags, withholding tax, special-vs-ordinary classification, or any ASX-specific corporate-action metadata. This is the documented Yahoo gap (KZO-171 background) and is **not** considered a fail — it is the trigger for the EODHD upgrade path (see §7).

### 4.4 Splits — informational only (KZO-186 owns)

ASX sample (2018+ window): **0 splits across all 9 sample tickers.** Expected — large-cap ASX splits are rare in this period.

To prove provider capability, I tested known historical splits:

| Symbol | Known split | yahoo-finance2 returned |
|---|---|---|
| **AAPL** | 4:1 on 2020-08-31, 7:1 on 2014-06-09 | **Both events present**, with `numerator`, `denominator`, `splitRatio` keys |
| DMP.AX | 3:1 on 2015-04-09 (Domino's, well-documented) | **0 events** |
| CDA.AX | Historical splits (Codan) | 0 events |

**Finding:** `yahoo-finance2.chart(..., { events: "split" })` correctly returns split data **when Yahoo's underlying feed contains it** (proven via AAPL). For ASX historical splits, **Yahoo's coverage is sparse** — at least one well-documented case (DMP 2015) is missing from the feed.

**Implication for KZO-186:** Do **not** assume Yahoo as the AU split source. KZO-186 must independently select a provider for AU split events (EODHD's ASX Corporate Actions API is the strongest candidate; manual entry is the fallback). The AAPL evidence proves the API surface, not the AU coverage.

---

## 5. Failure Modes & Degradation Guidance

Live-tested failure paths:

| Scenario | Result | Recovery |
|---|---|---|
| **Bare ticker `BHP` (no `.AX`)** | **Silently routes to NYSE listing** (USD currency, NYQ exchange, 20 bars in April window) | **Foot-gun.** Always pin `.AX` at provider boundary. The provider class must reject any input lacking the suffix internally. |
| Wrong suffix `BHP.XX` | `Error: No data found, symbol may be delisted` (`name: "Error"`) | Catch + log + skip + mark instrument `bars_backfill_status='failed'`. |
| Invalid symbol `ZZZZNOTREAL.AX` | Same `No data found` error | Same as above. |
| Date range below first-trade date | `BadRequestError: Data doesn't exist for startDate=…, endDate=…` | Truncate `effectiveStartDate = max(requestedStartDate, historyStartFor("AU"))` BEFORE the call. Mirror KZO-170 D13 + `pre_provider_history_truncated` log. |
| Yahoo HTML/scraper breakage | Documented precedent: issue [#967](https://github.com/gadicc/yahoo-finance2/issues/967) — `search()` returned HTML error page (2025-11-10). Isolated to `search()`, recovered in subsequent release. | Catch generic `Error` from yahoo-finance2 calls, log with `{ provider: "yahoo-finance-au", method, symbol }`, skip the ticker (do NOT crash the worker), retry with exponential backoff up to 3 attempts. Preserve last-known-good bar/dividend rows (no destructive overwrite on transient failure). |
| Rate limiting (5xx / soft throttling) | Yahoo does not document a public rate limit. Empirical observation in this spike: 9 sequential `chart()` calls completed in ~2s with no throttling. | KZO-172's `RateLimiter` for Yahoo is precautionary — recommend ~60 req/min as a self-imposed ceiling, not a Yahoo-published value. On HTTP 429 / 5xx, re-enqueue with `boss.send(QUEUE, payload, { startAfter: 60 })` per KZO-163's `RateLimitedError` reschedule pattern. |

**Symbol normalization rule (locked):**
- Internal storage: `(ticker, market_code)` where `ticker` is the bare ASX code (e.g. `BHP`) and `market_code = 'AU'`.
- Provider boundary: serialize → `${ticker}.AX`. Deserialize → strip `.AX` and stamp `market_code = 'AU'`.
- Companion: `currencyFor("AU") = "AUD"` (already in `libs/domain/src/types.ts`).

---

## 6. Catalog Strategy (decision #11 locked)

Yahoo offers **no reliable enumeration of ASX-listed instruments** through `yahoo-finance2`. KZO-172 ships **bounded AU catalog support only**:

1. **Per-symbol metadata enrichment** at provider boundary via `quote(symbol)`. Populates `name`, `instrument_type` (`STOCK` / `ETF` discriminated by `quoteType`), `industry_category_raw` (free-text from `quoteSummary` if needed in a follow-up).
2. **Reserved validation tickers** (BHP, CSL, VAS, WBC, AFI plus the cited GMG and IMD) seeded as known instruments.
3. **Per-query autocomplete** via `search(query, { region: "AU" })` — usable as a UI affordance, but bounded to ~7 results per query.
4. **No DEFAULT_INSTRUMENTS bulk seed.** Catalog populates organically as users enter AU trades or select monitored AU tickers; `quote()` enrichment runs lazily.
5. **No `daily_refresh` enumeration of "all ASX" — only the distinct union of monitored `(ticker, 'AU')` pairs across users**, mirroring KZO-130's TW pattern.

KZO-172's transition note must explicitly say: *"AU autocomplete is intentionally bounded. The first downstream ticket that needs full ASX enumeration must add an EODHD-backed catalog provider."*

---

## 7. EODHD — Re-Verified Upgrade Path (live, 2026-05-02)

Sources: [eodhd.com/pricing](https://eodhd.com/pricing), [eodhd.com/asx-data](https://eodhd.com/asx-data), [eodhd.com/financial-apis-blog/new-api-asx-corporate-actions](https://eodhd.com/financial-apis-blog/new-api-asx-corporate-actions), [eodhd.com/financial-apis/asx-australia-corporate-actions-beta](https://eodhd.com/financial-apis/asx-australia-corporate-actions-beta).

### 7.1 Pricing

| Plan | Monthly USD | Includes | ASX Corporate Actions API? |
|---|--:|---|---|
| Free | $0 | 20 calls/day, splits & dividends (1y history only) | No |
| **EOD All-World** | **$19.99** | EOD prices, 150k+ tickers, 30+ years history, **2,000+ ASX securities**, basic splits & dividends | **No** — basic dividends only, no `_asx_extra` block |
| EOD + Intraday Extended | $29.99 | EOD + intraday from 2004 | No |
| **Fundamentals Data Feed** | **$59.99** | Fundamentals + ASX Corporate Actions API (beta) | **YES** |
| **All-In-One** | **$99.99** | Everything above | **YES** |

All paid plans: 100,000 calls/day, 1,000/min. All commercial plans include ASX redistribution rights (with the standard "certain ASX datasets may require a separate license" caveat for high-end commercial use).

### 7.2 ASX Corporate Actions API — what it adds over Yahoo

- **Source:** Official ASX ReferencePoint feed (E34), refreshed daily after ASX close (~18:30 AEST = 08:30 UTC).
- **`_asx_extra` block** on each event:
  - Dividends: **franking percentage**, **DRP indicator**, **BSP indicator**, **withholding tax**, special-vs-ordinary, tax-advantaged amounts.
  - Bonus issues: ratio + record/despatch dates + pari-passu flag.
  - Rights issues: renounceable/non-renounceable + application price + close date.
  - Splits: record + effective dates.
  - Buybacks, capital returns, share purchase plans.
- **Status:** Beta as of 2026-05-02 — production usage requires accepting beta SLA.

### 7.3 Switch triggers (KZO-171 acceptance criterion)

Move from Yahoo to EODHD when any of the following becomes true:

1. **Commercialization** — Yahoo's ToS limits use to personal/non-commercial. Any multi-tenant deployment beyond the user's own accounts requires a licensed provider.
2. **Tax reporting** — franking credits become required for AU dividend P&L reporting. Yahoo does not expose franking; only EODHD's `_asx_extra.franking_percentage` does.
3. **Operationally required AU split events** — KZO-186's split source decision (sparse Yahoo coverage means split-aware lot adjustment for AU positions will be incomplete). EODHD's ASX Corporate Actions API is the strongest replacement.
4. **Yahoo HTML/scraping breaks unrecoverably** — beyond the isolated `search()`-only pattern of issue #967 (i.e. `chart()` itself starts failing for >1 release cycle).
5. **Need full ASX catalog enumeration** — Yahoo's screener has no AU scrId; EODHD's exchange-data endpoint returns the full ASX ticker universe.

### 7.4 Env vars likely needed when EODHD lands

```bash
EODHD_API_KEY=...                       # required, secret
EODHD_BASE_URL=https://eodhd.com/api    # default
EODHD_RATE_LIMIT_PER_DAY=100000         # default per paid plan
EODHD_RATE_LIMIT_PER_MINUTE=1000        # default per paid plan
EODHD_PLAN=fundamentals|all-in-one      # signals whether _asx_extra is available
```

The swap is a **registry-level change**: `buildMarketDataRegistry()` constructs an `EodhdAuMarketDataProvider` (implementing `MarketDataProvider` + `InstrumentCatalogProvider`) and `registry.marketData.set("AU", eodhd)` replaces the Yahoo registration. No call-site changes (KZO-163's invariant).

---

## 8. `historyStartFor("AU")` Recommendation

Live probe of earliest available bars per ticker (`yahooFinance.chart(symbol, { period1: "1985-01-01", period2: "1995-12-31" })` etc.):

| Ticker | Yahoo `meta.firstTradeDate` | First bar in earliest probe |
|---|---|---|
| BHP.AX | `1988-01-28T23:00:00.000Z` | 1988-01-28 |
| VAS.AX | (ETF, listed 2009) | 2009-05-01 |

Recommendation: **`HISTORY_START_BY_MARKET["AU"] = "1988-01-28"`** (replacing the current `"1994-10-01"` placeholder in `apps/api/src/services/market-data/types.ts`). This bracket-floors the earliest date Yahoo will return for the deepest-history large-cap (BHP); per-ticker floors above that (e.g. VAS at 2009-05-01) are handled by Yahoo natively returning the available subrange when `period1` predates listing.

**Caveat:** Yahoo's `meta.firstTradeDate` is a `Date` instance in `yahoo-finance2@3.x`, **not** a Unix-seconds value. Do NOT `* 1000` it. Reference field for any future per-ticker historyStart auto-detection: `r.meta.firstTradeDate` directly.

Pre-1988-01-28 trade dates get truncated with `pre_provider_history_truncated` log, mirroring KZO-170 D13 exactly.

---

## 9. KZO-172 Implementation Checklist (corrected)

This supersedes the existing KZO-172 description for implementation purposes. Per scope-todo lock #10, KZO-172 receives this as a **planning comment**, not a description rewrite.

### 9.1 In scope (KZO-172)

- [ ] Add `yahoo-finance2@^3.14.0` to `apps/api/package.json` dependencies.
- [ ] Create `apps/api/src/services/market-data/providers/yahooFinanceAu.ts` exporting `YahooFinanceAuMarketDataProvider` implementing **both** `MarketDataProvider` and `InstrumentCatalogProvider`. `providerId = "yahoo-finance-au"`. `sourceId = "yahoo-finance-au"` on every returned bar / dividend.
  - `fetchBars(ticker, startDate?, endDate?)` → `yahooFinance.chart(\`${ticker}.AX\`, { period1, period2, interval: "1d" })` → map `r.quotes` to `RawDailyBar[]`. Normalize bar dates to ASX session (`Australia/Sydney` timezone shift).
  - `fetchDividends(ticker, startDate?, endDate?)` → same `chart()` call with `events: "div"` → map `r.events.dividends` to `DividendRecord[]`. Set `cashDividendCurrency = "AUD"` (relies on KZO-170's D1 fix in `upserts.ts`). No franking / DRP / BSP fields — those are EODHD-only and out of scope.
  - `fetchInstrumentCatalog()` → returns the bounded reserved-set + provider-boundary metadata enrichment via `quote()` for monitored symbols. Documented limitation: NOT a full ASX enumeration.
  - `fetchDelistingHistory()` → `[]` (Yahoo does not expose AU delisting reference data; intentional empty). JSDoc points at a future ticket.
  - `fetchSplits()` → **out of scope per KZO-186.**
- [ ] Create `apps/api/src/services/market-data/providers/mockYahooFinanceAu.ts` (`MockYahooFinanceAuMarketDataProvider`) — deterministic price fixtures for BHP/CSL/VAS/WBC/AFI from 2024-01-01 (to satisfy `e2e-shared-memory-bars-ticker-hygiene.md` reserved-ticker discipline). Constructor variant for fixture-start-date override (mirror KZO-170 G-CRIT-3 pattern for the truncation regression test).
- [ ] In `libs/domain/src/classifyInstrument.ts`, add `marketCode === "AU"` branch. Hand-curated allow-list keyed on `quoteType` from yahoo-finance2 `quote()`: `EQUITY` → STOCK, `ETF` → ETF (and seed VAS → ETF, AFI → STOCK, GMG → STOCK explicitly). No `BOND_ETF` for AU in v1 (the locked sample has none). Default fallback STOCK. Tests assert allow-list correctness, not heuristic completeness — mirror KZO-170 D6.
- [ ] Update `HISTORY_START_BY_MARKET["AU"]` from `"1994-10-01"` placeholder to **`"1988-01-28"`**. Remove the `// TODO(KZO-171): pin AU history start` comment from `types.ts`.
- [ ] In `apps/api/src/services/market-data/registry.ts`: construct `YahooFinanceAuMarketDataProvider` parallel to TW + US. **Yahoo does NOT share the FinMind 600/hr budget** — give it its own `RateLimiter` instance with a precautionary ceiling (recommend `YAHOO_AU_RATE_LIMIT_PER_HOUR=600` or `YAHOO_AU_RATE_LIMIT_PER_MINUTE=60`; final value is operator's call). Mock branch creates `MockYahooFinanceAuMarketDataProvider`. Register `marketData.set("AU", ...)` and `catalog.set("AU", ...)`.
- [ ] Symbol normalization is internal to the provider class. **The provider boundary is the only place `.AX` exists.** Persistence stays as `(ticker='BHP', market_code='AU')`.
- [ ] Daily refresh schedule: keep the existing `30 17 * * 1-5` cron (TWSE-anchored 17:30 TST). For AU, the earliest data freshness window is **after 18:30 AEST = 08:30 UTC**, but the cron is per-deployment and the existing schedule fires after AU close anyway (17:30 TST = 09:30 UTC, post-AU close). No cron change needed in v1. Document the AU freshness window in the transition note.
- [ ] Reserved E2E AU tickers — update `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`: **BHP** (au-bars-roundtrip-aaa, au-dividends-aaa), **CSL** (au-bars-roundtrip-aaa), **VAS** (au-etf-aaa), **WBC** (au-bars-roundtrip-aaa), **AFI** (au-lic-aaa).
- [ ] Tests:
  - **Unit (suite 4):** provider class behavior (request shape, response parsing, sourceId stamp, providerId field, `.AX` suffix application, error mapping for `No data found` / `BadRequestError`); classifier US-vs-AU branching.
  - **Integration (suite 5, Postgres-backed):** AU BHP backfill round-trip, dividend ingestion ≥4 entries for BHP and ≥4 for VAS, pre-1988 trade-date truncation, cross-market delisting market-scoped `UPDATE` regression (with synthetic AU delisting fixture since the real provider returns `[]`).
  - **HTTP (suite 8):** `/market-data/price?ticker=BHP&date=2024-06-15&marketCode=AU` returns AUD price; missing `marketCode` 400.
  - **E2E (suites 6/7):** user enters BHP trade through chip-selector form, backfill kicks off, dashboard renders AUD position. Trade dates ≥ 2024-01-01 per mock fixture start.
- [ ] Pre-PR review per `.claude/rules/code-review-before-pr.md` and full 8-suite gate per `.claude/rules/full-test-suite.md`.

### 9.2 Out of scope (KZO-172)

- **Splits ingestion + replay invariant 6** — KZO-186 owns. The Yahoo split sparsity finding (§4.4) means KZO-186 must independently select a provider for AU splits.
- **Franking credits, DRP/BSP, rights issues, capital returns** — Yahoo cannot supply these. Locked decision: EODHD upgrade required.
- **Provider health table/UI writes** — KZO-177 owns. KZO-172 ships only `provider: "yahoo-finance-au"` log/source stamping.
- **Full ASX autocomplete** — yahoo-finance2 has no AU screener. KZO-172 ships bounded catalog only (§6).
- **`exchange_subcode` column** — first downstream consumer carves it (mirror KZO-170 D4).
- **Default AU fee profile / AUD commission currency templates** — separate ticket (TBD).
- **EODHD provider class** — separate future ticket triggered by §7.3.

### 9.3 Debate trigger (inherited)

If during KZO-172 implementation the BHP **chart()** call starts failing across releases (broad bars failure) OR BHP/VAS dividends become unusable (>0 missing in the rolling 90-day window), trigger `/debate` before continuing — that is the spike's "Yahoo broke unrecoverably" signal and should bias the team toward bringing EODHD forward.

---

## 10. Validation Methodology (reproducibility note)

All evidence in this document was produced from a transient `/tmp/kzo-171-spike` scratch directory created on 2026-05-02. The directory contained:

```
/tmp/kzo-171-spike/
  package.json            # { "name": "kzo-171-spike", "type": "module", "private": true }
  node_modules/yahoo-finance2/   # installed via `npm install yahoo-finance2@latest`
  validate-bars.mjs       # §4.2 evidence
  validate-dividends.mjs  # §4.3 evidence
  validate-splits.mjs     # §4.4 evidence
  validate-catalog.mjs    # §3 + §6 evidence
  validate-failures.mjs   # §5 evidence
```

Per scope-todo decision #1, **none of these scripts were committed**. The `apps/api/package.json` was **not modified**. The scratch directory should be torn down after this spike note merges.

```bash
rm -rf /tmp/kzo-171-spike
```

---

## 11. References

- Locked scope-todo: `docs/004-notes/kzo-171/scope-todo-202605021634-au-provider-spike.md`
- Linear KZO-171 (this ticket): https://linear.app/kzokv/issue/KZO-171/
- Linear KZO-172 (implementation, blocked by this spike): https://linear.app/kzokv/issue/KZO-172/
- Linear KZO-186 (splits + replay invariant 6): https://linear.app/kzokv/issue/KZO-186/
- Linear KZO-177 (provider health UI): https://linear.app/kzokv/issue/KZO-177/
- KZO-163 transition note (provider registry shape): `docs/004-notes/kzo-163/transition-202604251534-provider-registry.md`
- KZO-170 transition note (US precedent for per-market reschedule, `historyStartFor`, `marketCode` query param): `docs/004-notes/kzo-170/transition-202605022121-us-stock-ingestion.md`
- yahoo-finance2 npm: https://www.npmjs.com/package/yahoo-finance2
- yahoo-finance2 GitHub: https://github.com/gadicc/yahoo-finance2
- EODHD pricing: https://eodhd.com/pricing
- EODHD ASX Corporate Actions API (beta): https://eodhd.com/financial-apis/asx-australia-corporate-actions-beta
- EODHD ASX overview: https://eodhd.com/asx-data

**No debate note was produced.** Hard gates passed; no architectural fork required.
