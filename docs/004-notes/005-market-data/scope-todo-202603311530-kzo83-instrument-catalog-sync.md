---
slug: kzo-83
source: scope-grill
created: 2026-03-31
tickets: [KZO-83]
required_reading:
  - docs/004-notes/005-market-data/debate-202603311500-kzo83-instrument-type-strategy.md
  - docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md
  - docs/004-notes/005-market-data/analysis-202603311000-kzo83-before-kzo130.md
superseded_by: null
---

# Todo: KZO-83 — FinMind Instrument Catalog Sync for TWSE

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also read the root `AGENTS.md` and `apps/api/AGENTS.md`.

## Context

KZO-83 populates the full TWSE instrument catalog from FinMind's `TaiwanStockInfo` API (~3,071 unique tickers across twse/tpex/emerging). The catalog sync also cross-references `TaiwanStockDelisting` for delisted instruments. A `classifyInstrument()` function derives `instrument_type` (STOCK/ETF/BOND_ETF) from raw FinMind fields at sync time (Option A — unanimous debate decision).

### FinMind API Shape

```json
{"industry_category": "半導體業", "stock_id": "2330", "stock_name": "台積電", "type": "twse", "date": "2026-03-31"}
```

- `type` = exchange (twse/tpex/emerging), NOT security type
- `industry_category` = sector label; also the only ETF signal ("ETF", "上櫃ETF", "上櫃指數股票型基金(ETF)")
- Bond ETFs detected by ticker convention: `ticker.endsWith("B")`
- Non-tradeable entries (INDEX, META, TDR, REIT) get `instrument_type = NULL`

### Dedup Strategy

4,077 API rows → 3,071 unique tickers. 942 tickers have multiple `industry_category` rows:
- **Pattern A (563):** Umbrella + specific (e.g., 2330: `電子工業` + `半導體業`) — pick non-umbrella
- **Pattern B (375):** Different dates = reclassification — pick latest date
- **Pattern C (4):** Board tag + sector — pick non-board-tag

Umbrella categories to skip: `電子工業`, `化學生技醫療`, `觀光餐旅`

### Saved API Responses

Raw FinMind responses are cached at (gitignored, re-fetch if missing):
- `.worklog/kzo-83/TaiwanStockInfo-raw.json` — 4,077 rows
- `.worklog/kzo-83/TaiwanStockDelisting-raw.json` — 277 rows

## Implementation Steps

### 1. Rewrite migration 018 (instruments table)

- [x] Add `type_raw TEXT NULL` — raw FinMind `type` value (twse/tpex/emerging)
- [x] Add `industry_category_raw TEXT NULL` — raw deduped industry category
- [x] Add `finmind_date TEXT NULL` — FinMind snapshot/report date
- [x] Relax `instrument_type` to `TEXT NULL` (drop NOT NULL, keep CHECK constraint with NULL allowed)
- [x] Drop `listed_date DATE` column
- [x] Keep all other columns unchanged (bars_backfill_status, verification_status, etc.)
- [x] Update the `INSERT INTO market_data.instruments` migration data block to match new schema

### 2. Domain types update

- [x] In `libs/domain/src/types.ts`: update `InstrumentRef.instrumentType` to `InstrumentType | null` (null = unmappable or provisional)
- [x] Add `classifyInstrument(industryCategory: string | null, ticker: string): InstrumentType | null` — pure function in domain layer

Classification rules:
```
ETF categories: ["ETF", "上櫃ETF", "上櫃指數股票型基金(ETF)"]
  → ticker.endsWith("B") ? "BOND_ETF" : "ETF"
Unmappable: ["ETN", "指數投資證券(ETN)", "Index", "大盤", "存託憑證", "受益證券", "所有證券"]
  → null
Everything else → "STOCK"
null category (provisional) → null
```

### 3. FinMind client: new methods

- [x] Add `RawInstrumentInfo` interface to `types.ts`:
  ```
  { ticker: string; name: string; typeRaw: string; industryCategory: string; date: string }
  ```
- [x] Add `RawDelistingRecord` interface:
  ```
  { ticker: string; name: string; date: string }
  ```
- [x] Extend `FinMindProvider` interface with:
  - `fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]>`
  - `fetchDelistingHistory(): Promise<RawDelistingRecord[]>`
- [x] Implement `fetchInstrumentCatalog()` in `FinMindClient`:
  - Dataset: `TaiwanStockInfo`, no `data_id` param, no `start_date`
  - Note: the existing `fetchDataset()` helper always passes `data_id` and `start_date` — need a new helper or overload for catalog-style requests
- [x] Implement `fetchDelistingHistory()` in `FinMindClient`:
  - Dataset: `TaiwanStockDelisting`, no `data_id` param, no `start_date`
- [x] Add mock implementations in `finmindClient.mock.ts`

### 4. Catalog sync service

- [x] Create `apps/api/src/services/market-data/catalogSync.ts`
- [x] Implement dedup logic:
  1. Group rows by `stock_id`
  2. For each ticker: pick row with latest `date`
  3. If still multiple rows (same date): filter out umbrella categories (`電子工業`, `化學生技醫療`, `觀光餐旅`), take first remaining
- [x] Call `classifyInstrument()` for each deduped instrument → derive `instrument_type`
- [x] Filter out INDEX/META entries (`industry_category` in `Index`, `大盤`, `所有證券`) — do not insert these into the catalog
- [x] Return normalized array ready for bulk upsert

### 5. Persistence: bulk catalog upsert

- [x] Add `upsertInstrumentCatalog(instruments: CatalogInstrument[]): Promise<void>` to persistence interface
- [x] Implement in `postgres.ts`:
  - Batch `INSERT ... ON CONFLICT (ticker) DO UPDATE`
  - Set: `name`, `type_raw`, `industry_category_raw`, `finmind_date`, `instrument_type`, `is_provisional = FALSE`, `updated_at = CURRENT_TIMESTAMP`
  - Preserve: `bars_backfill_status`, `last_synced_at`, `verification_status` (don't overwrite)
- [x] Implement delisting cross-reference:
  - After catalog upsert, UPDATE `delisted_at` for tickers found in TaiwanStockDelisting
  - Only update tickers that exist in instruments table (don't insert delisted-only tickers)
- [x] Add no-op implementation in `memory.ts`

### 6. Instrument registry update

- [x] Update `DEFAULT_INSTRUMENTS` in `instrumentRegistry.ts` to include `typeRaw` and `industryCategoryRaw` fields (or null for seeds)
- [x] Update `buildProvisionalInstrument()`: `typeRaw: null`, `industryCategoryRaw: null`, keep `instrumentType: "STOCK"` default for provisionals
- [x] Update `upsertInstrumentDefinitions()` in postgres.ts to handle new columns in upsert

### 7. CLI / service entry point

- [x] Create sync entry point (e.g., `apps/api/src/services/market-data/runCatalogSync.ts`)
- [x] Orchestration: fetch catalog → dedup → classify → bulk upsert → fetch delisting → cross-reference
- [x] Consume 2 rate limiter units (2 API calls total)
- [x] Log: total instruments fetched, deduped count, classified count, unmappable count, delisted count
- [x] Expose as callable from a script or future pg-boss cron (KZO-130)

### 8. Trade creation guard

- [x] In trade creation flow (`registerRoutes.ts` or `portfolio.ts`): if the instrument's `instrumentType` is null, reject with `routeError(400, "unclassified_instrument", "Cannot create trades for unclassified instruments")`

### 9. Tests

- [x] Unit test `classifyInstrument()` — cover STOCK, ETF, BOND_ETF (ticker ending B), unmappable categories, null category (provisional)
- [x] Unit test dedup logic — Pattern A (umbrella), Pattern B (different dates), Pattern C (board tag)
- [x] Integration test: catalog sync upsert → verify instruments table populated with correct `type_raw`, `industry_category_raw`, `instrument_type`
- [x] Integration test: delisting cross-reference → verify `delisted_at` populated
- [x] Integration test: upsert idempotency — run sync twice, verify no duplicates, provisional instruments overwritten
- [x] Integration test: trade creation guard — verify 400 for unclassified instrument
- [x] Existing test suites must continue passing (zero fixture changes per debate decision)

### 10. Verification (mandatory)

- [x] Run full 7-suite test pass (per full-test-suite rule)
- [x] Grep for stale references to `listed_date` across codebase
- [x] Verify `instrument_type` CHECK constraint allows NULL

## Out of Scope

- Scheduling / cron job for periodic sync — KZO-130
- Ticker picker UI changes — KZO-129
- `provider_symbol` column — YAGNI, add when a second provider exists
- `currency` column — all TWSE instruments are TWD, hardcode in domain layer
- TPEX/OTC filtering at ingestion — ingest all, filter in UI queries
- Backup/restore scripts — KZO-130 or separate ops ticket

## Key Decisions (from scope grill + debate)

| # | Decision | Rationale |
|---|----------|-----------|
| Q3 | Single `industry_category_raw` column, no sector/industry split | FinMind provides one field, not two |
| Q4 | Ingest all instruments (twse + tpex + emerging) | Filter in queries, not at ingestion |
| Q5 | No `provider_symbol` column | YAGNI — identical to ticker for FinMind |
| Q6 | Drop `listed_date`, hardcode TWD | Not available from API; all TWSE = TWD |
| Q7 | Keep `instrument_type` + add raw columns (Option A) | Unanimous debate: minimal blast radius |
| Q8 | Store `finmind_date` | Preserves API snapshot date, useful for debugging |
| Q11 | ON CONFLICT overwrite + clear `is_provisional` | Catalog sync is source of truth |
| Q12 | `type_raw` nullable | Provisional instruments have no catalog data |
| Q13 | Store FinMind `date` field as `finmind_date` | Aids reclassification tracking |

## References

- Scope debate note: `docs/004-notes/005-market-data/debate-202603311500-kzo83-instrument-type-strategy.md`
- KZO-122 ADR: `docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md`
- Ordering analysis: `docs/004-notes/005-market-data/analysis-202603311000-kzo83-before-kzo130.md`
- Linear ticket: [KZO-83](https://linear.app/kzokv/issue/KZO-83)
- FinMind API docs: https://finmindtrade.com/llms-full.txt
