---
slug: kzo-127
source: scope-grill
created: 2026-03-30
tickets: [KZO-127]
required_reading: []
superseded_by: null
---

# Todo: KZO-127 — Glossary consistency: rename "symbol" to "ticker"/"instrument"

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also read the root `AGENTS.md` and the `process-refactor-rename-verification` rule in `.claude/rules/`.

## Naming Model

Two-concept split — not a flat rename:

| Layer | "Symbol" becomes | Rationale |
|---|---|---|
| DB catalog / backend types | **Instrument** | Matches `market_data.instruments` table, `InstrumentCatalogSheet`, entity with metadata |
| User-facing / monitoring | **Ticker** | The identifier string users type/see; "Tickers" tab, monitored tickers |

## Implementation Steps

### 1. Database migration (edit in-place per migration strategy rule)

- [x] Confirm `market_data.instruments` table already exists (migration 018) — no new migration needed for the catalog table
- [x] Rename `user_monitored_symbols` → `user_monitored_tickers` in migration 019 (edit in-place: table name, PK constraint, FK constraint, index names)

### 2. TypeScript type renames (libs/shared-types)

- [x] `SymbolOptionDto` → `InstrumentOptionDto`
- [x] `MonitoredSymbolDto` → `MonitoredTickerDto`
- [x] `MonitoredSymbolSource` → `MonitoredTickerSource`
- [x] `DashboardOverviewDto.symbols` field → `DashboardOverviewDto.instruments`

### 3. API layer type renames (apps/api)

- [x] `SymbolDef` (types/store.ts) → `InstrumentDef`
- [x] `symbolSchema` (registerRoutes.ts) → `tickerSchema`
- [x] `store.symbols` field → update all references

### 4. Service/module renames (apps/api)

- [x] Rename file: `symbolRegistry.ts` → `instrumentRegistry.ts`
- [x] `DEFAULT_SYMBOLS` → `DEFAULT_INSTRUMENTS`
- [x] `createDefaultSymbols()` → `createDefaultInstruments()`
- [x] `buildProvisionalSymbol()` → `buildProvisionalInstrument()`
- [x] `listTransactionSymbols()` → `listTransactionInstruments()`
- [x] `ensureSymbolDefinition()` → `ensureInstrumentDefinition()`
- [x] `upsertSymbolDefinitions()` → `upsertInstrumentDefinitions()`
- [x] `demoData.ts` — update calls to renamed functions

### 5. Conversion functions (apps/api/services/store.ts) — simplify names

- [x] `symbolDefToInstrumentRef()` → `instrumentDefToRef()`
- [x] `instrumentRefToSymbolDef()` → `instrumentRefToDef()`

### 6. Persistence layer (apps/api)

- [x] `upsertSymbols()` → `upsertInstruments()` (types.ts, postgres.ts, memory.ts)
- [x] `monitoredSymbols` private Map (memory.ts) → `monitoredTickers`
- [x] Update all SQL queries referencing `user_monitored_symbols` → `user_monitored_tickers`

### 7. API endpoint rename

- [x] `/monitored-symbols` → `/monitored-tickers` (GET + PUT in registerRoutes.ts)
- [x] Update frontend service: `monitoredSymbolsService.ts` → `monitoredTickersService.ts`
- [x] Update all fetch URLs in the new service file

### 8. React component/hook renames (apps/web)

- [x] Rename file: `MonitoredSymbolsSection.tsx` → `MonitoredTickersSection.tsx`
- [x] Rename component: `MonitoredSymbolsSection` → `MonitoredTickersSection`
- [x] Rename file: `useMonitoredSymbols.ts` → `useMonitoredTickers.ts`
- [x] Rename hook: `useMonitoredSymbols` → `useMonitoredTickers`
- [x] Update all imports in `SettingsDrawer.tsx` and other consumers

### 9. i18n renames (apps/web)

- [x] Rename all `symbols*` keys → `tickers*` in `lib/i18n/types.ts`
- [x] Update EN dictionary in `features/settings/i18n.ts`
- [x] Update ZH-TW dictionary in `features/settings/i18n.ts`
- [x] Update EN dictionary in `features/dashboard/i18n.ts`
- [x] Update ZH-TW dictionary in `features/dashboard/i18n.ts`
- [x] Validation/binding strings: "symbol" → "ticker"
- [x] Settings tab label: "Tickers" (not "Monitored Tickers")
- [x] Update all component references to renamed i18n keys

### 10. Test ID renames (components → POMs → specs)

- [x] Component test IDs: `settings-tab-symbols` → `settings-tab-tickers`, `monitored-symbols-section` → `monitored-tickers-section`, `symbols-search` → `tickers-search`, `symbols-save-btn` → `tickers-save-btn`, `position-symbol-{ticker}` → `position-ticker-{ticker}`, `manual-symbol-{ticker}` → `manual-ticker-{ticker}`
- [x] `symbol-history-*` test IDs in `TransactionHistoryTable.tsx` → `ticker-history-*`
- [x] `tx-symbol-select` in `AddTransactionCard.tsx` → `tx-ticker-select`
- [x] POM updates in `libs/test-e2e/src/pages/settings/SettingsDrawerPage.ts`
- [x] Update all triplet and spec references to renamed test IDs

### 11. Test file renames

- [x] `monitored-symbols-aaa.spec.ts` → `monitored-tickers-aaa.spec.ts`
- [x] `demo-symbol-history-aaa.spec.ts` → `demo-ticker-history-aaa.spec.ts`
- [x] `monitored-symbols.integration.test.ts` → `monitored-tickers.integration.test.ts`
- [x] `monitored-symbols.test.ts` → `monitored-tickers.test.ts`

### 12. Remove legacy redirect route

- [x] Delete `apps/web/app/symbols/[symbol]/page.tsx`
- [x] Delete `apps/web/app/symbols/[symbol]/error.tsx`
- [x] Delete `apps/web/app/symbols/[symbol]/loading.tsx`
- [x] Delete `apps/web/app/symbols/[symbol]/` directory
- [x] Delete `apps/web/app/symbols/` directory (if empty)

### 13. Verification (mandatory — per process-refactor-rename-verification rule)

- [x] `grep -r "Symbol" --include="*.ts" --include="*.tsx" .` — verify no stale type references
- [x] `grep -r "symbol" --include="*.ts" --include="*.tsx" .` — verify no stale variable/field/import references
- [x] `grep -r "monitored-symbols" --include="*.ts" --include="*.tsx" .` — verify no stale API paths
- [x] `grep -r "symbols" --include="*.sql" .` — verify no stale SQL references
- [x] `grep -r "symbol" --include="*.spec.ts" --include="*.test.ts" .` — verify no stale test references
- [x] Run full 7-suite test pass (per full-test-suite rule)

## Out of Scope

- `InstrumentCatalogSheet` component name — stays as-is
- `InstrumentCatalogItemDto` — already correct
- `market_data.instruments` table — already renamed in migration 018
- Any external API consumers — none exist

## References

- Linear ticket: [KZO-127](https://linear.app/kzokv/issue/KZO-127)
- Prior art: KZO-82 (migration 017 column renames, migration 018 market_data schema)
- Rules: `process-refactor-rename-verification`, `migration-strategy`, `full-test-suite`
