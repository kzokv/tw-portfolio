---
slug: instrument-catalog-sectors-ui
source: scope-grill
created: 2026-05-29
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Instrument Catalog Sectors For TW And US

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

- Add normalized GICS sector support to TW and US instrument catalog rows.
- Add additive API DTO field `sector: string | null`; compute it at read time with no database migration or persisted sector column.
- Derive AU `sector` from existing `gicsIndustryGroup`; keep AU row subtitles on the richer industry-group label.
- Map TW provider `industry_category_raw` values to normalized sectors using a small explicit mapping table.
- Map US provider `Subsector` values to normalized sectors using a small explicit mapping table.
- Keep TW/US ETF and BOND_ETF rows as `sector: null` unless a future ticket adds fund holdings or issuer sector classification.
- Show the sector dropdown only for single-market chips `TW`, `US`, and `AU`; keep it hidden for `ALL`.
- Search bypasses sector filtering for all markets.
- Row subtitle behavior: AU shows industry group; TW/US show normalized sector; sectorless rows show no subtitle.
- Required validation is focused mapping, API, web unit, and E2E coverage. Full eight-suite validation is only required when preparing a PR or when explicitly requested.

## Implementation Steps

- [x] Add a shared sector normalization helper for catalog rows, covering AU GICS industry groups plus explicit TW and US raw-category mappings.
- [x] Extend `InstrumentCatalogItemDto` with `sector: string | null`.
- [x] Update memory and Postgres `/instruments` catalog projection to populate `sector` at read time without schema changes.
- [x] Update test seed/input helpers and fixtures so seeded catalog rows can carry enough raw category data for focused tests.
- [x] Update `InstrumentCatalogSheet` to show the sector dropdown for `TW`, `US`, and `AU` market chips only.
- [x] Update filtering so AU sector selection filters via `gicsIndustryGroup`, while TW/US filter via normalized `sector`.
- [x] Update row subtitle rendering so AU shows industry group, TW/US show normalized sector, and sectorless rows show no subtitle.
- [x] Preserve search bypass behavior across TW, US, and AU.
- [x] Add or update unit tests for sector normalization, including ETF and BOND_ETF sector-null behavior.
- [x] Add API or HTTP coverage proving `/instruments` returns `sector` for representative TW, US, and AU rows.
- [x] Add or update web unit coverage for sector-dropdown visibility and filtering across TW, US, and AU.
- [x] Add E2E coverage for Settings -> Tickers -> Browse Full Catalog sector filtering for TW and US.

## Validation Notes

- Passed: `npm run build -w libs/shared-types`
- Passed: `npm run test --prefix apps/api -- test/unit/gics.test.ts test/unit/monitored-tickers.test.ts`
- Passed: `npm run test --prefix apps/web -- test/features/settings/components/InstrumentCatalogSheet.sectorFilter.test.tsx test/features/portfolio/hooks/useInstrumentCatalog.test.tsx test/features/portfolio/InstrumentCombobox.test.tsx test/features/portfolio/InstrumentCombobox-live-results.test.tsx`
- Passed after final mapping tweak: `npm run test --prefix apps/api -- test/unit/gics.test.ts`
- Passed after final mapping tweak: `npm run test --prefix apps/web -- test/features/settings/components/InstrumentCatalogSheet.sectorFilter.test.tsx`
- Passed: `npx eslint .`
- Passed: `npm run typecheck`
- Passed: `npm run test --prefix apps/web` — 64 files, 432 tests.
- Passed: `npm run test --prefix apps/api` — 125 files passed, 40 skipped; 1350 tests passed, 407 skipped.
- Passed: `npm run test:integration:full:host` — 78 files passed; 750 tests passed, 1 skipped.
- Passed: `npm run test:e2e:bypass:mem --prefix apps/web` — 255 passed, 9 skipped.
- Passed: `npm run test:e2e:oauth:mem --prefix apps/web` — 129 passed.
- Passed: `npm run test:http --prefix apps/api` — 273 passed, 2 skipped.
- Passed: `git diff --check`.

## Open Items

- [ ] Expand TW/US mapping coverage in a future ticket if production catalog audits reveal additional high-confidence categories.

## References

- Worktree: `/Users/lume/repos/tw-portfolio/.worktrees/instrument-catalog-sectors-ui`
- Branch: `codex/instrument-catalog-sectors-ui`
- Mockup: `docs/notes/instrument-catalog-sectors-ui/instrument-catalog-sectors-mockup.html`
