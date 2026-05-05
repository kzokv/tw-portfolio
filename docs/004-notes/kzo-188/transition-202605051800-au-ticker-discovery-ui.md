---
slug: kzo-188
type: transition
created: 2026-05-05T18:00
status: frozen
tickets: [KZO-188]
prior_reading:
  - docs/004-notes/kzo-188/scope-todo-202605051500-au-ticker-discovery-ui.md
  - docs/004-notes/kzo-188/review-202605051700-iter1.md
  - docs/004-notes/kzo-172/transition-202605051045-au-stock-ingestion.md
---

# Transition Note: KZO-188 — AU Ticker Discovery UI

> **FROZEN SNAPSHOT** — this file records the state of the system as of 2026-05-05. Do not update after merge. For evergreen operational guidance, see `docs/002-operations/runbook.md` and `docs/001-architecture/web-frontend.md`.

Target audience: engineers picking up KZO-189 (conditional metadata enrichment), KZO-190 (`reserveCapacity` cleanup), KZO-177 (provider health dashboard), or any ticket touching the AU discovery UI pathway.

---

## 1. What Shipped

KZO-188 delivers the **frontend slice** of AU ticker discovery. The backend route (`GET /market-data/search`) and `MockYahooFinanceAuMarketDataProvider.searchInstruments` fixture were shipped by KZO-172 — see the parent transition note for those details.

### New files

- **`apps/web/lib/hooks/useDebouncedValue.ts`** — Generic `useDebouncedValue<T>(value: T, delayMs: number): T` hook. Uses `useState` + `useEffect` + `setTimeout`; cleanup clears the pending timer on every value change. Caller owns `AbortController` — this hook does not manage abort semantics.

- **`apps/web/features/settings/services/instrumentSearchService.ts`** — `searchInstruments(q, marketCode, signal?)` web service. Calls `GET /market-data/search?q={q}&market_code={marketCode}` via `getJson`. Three backend error codes collapse into one typed signal:
  - `429` (per-IP rate-limit) → `SearchUnavailableError`
  - `503 provider_rate_limited` (Yahoo budget exhausted) → `SearchUnavailableError`
  - `503 search_unavailable` (upstream failure, `X-Search-Degraded: true`) → `SearchUnavailableError`
  All other errors re-throw as-is. `ApiError.code` is sourced from `payload.error` per `service-error-pattern.md`.

- **`apps/web/tests/e2e/specs/au-ticker-discovery-aaa.spec.ts`** — Two E2E specs (bypass-mem profile):
  1. Happy path: AU chip → type "CBA" → live result with LIVE badge → toggle → save → backfill badge appears.
  2. Degraded state: inject one-time search error → AU chip → type "CBA" → `tickersSearchLiveUnavailable` message renders, CBA row hidden.

- **`apps/web/test/features/portfolio/InstrumentCombobox-live-results.test.tsx`** — Vitest unit tests covering the combobox `liveResults` Map, AU live-search trigger, `SearchUnavailableError` path, and post-commit display label fallback.

### Modified files

**`apps/web/features/settings/components/InstrumentCatalogSheet.tsx`**
- New 4-button market-chip group above the type-filter chips: `All Markets · TW · US · AU`. Default: `All Markets`.
- Client-side filter applies the selected chip to the `instruments` prop (no backend route change).
- Live-search trigger: fires when `debouncedQuery.length >= 2 && marketChip === "AU" && filteredCatalogCount === 0`. Uses `AbortController`; cleanup calls `controller.abort()`.
- Live results rendered below (or in place of) catalog rows when `filteredCatalogCount === 0` and results exist. Each live row carries a `LIVE` badge (i18n: `tickersSearchLiveBadge`).
- `tickersSearchEmptyState` ("No tickers found.") renders only when both catalog AND live return 0 or live was not triggered (chip ≠ AU).
- Count line visible only when catalog has results; hidden during loading, live-results-shown, and empty-search modes.
- Hardcoded `"No instruments found."` migrated → `dict.settings.tickersSearchEmptyState`.
- Count line `"{count} instrument{s}"` migrated → `tickersCatalogCount: "{count} instruments"` (string template; `.replace("{count}", ...)` at call site per `nextjs-i18n-serialization.md`).

**`apps/web/components/portfolio/InstrumentCombobox.tsx`**
- New `liveResults: Map<string, TransactionInstrumentOption>` (keyed `${ticker}|${marketCode}`). Populated on `commitSelection`. Used as fallback in the `selectedInstrument` lookup so un-catalogued live picks render their formatted display label after commit.
- Live-search trigger: fires when `debouncedQuery.length >= 2 && marketCodeFilter === "AU" && filtered.items.length === 0`.
- Live results rendered below catalog matches (or in place of empty state). Same row layout plus `LIVE` badge.
- **No live search in ALL mode** (`marketCodeFilter === null`). Empty state stays as `tickerNoMatches`. This is by design — live search is chip-driven.

**`apps/web/features/settings/hooks/useMonitoredTickers.ts`**
- `toggleTicker` signature extended: `(ticker: string, liveItem?: InstrumentCatalogItemDto) => void`.
- When `liveItem` is passed, appends a synthetic `LiveSourcedInstrumentCatalogItemDto` to local `instruments` state (idempotent on key collision):
  - `barsBackfillStatus: "pending"`
  - `__liveSourced: true` (non-DTO marker for LIVE badge persistence)
  - All other fields from the search result row.
- Existing catalog-row toggle call sites pass `undefined` as the second arg (pure refactor, no behavior change).

**`apps/web/features/settings/i18n.ts` / `apps/web/lib/i18n/types.ts`**
- 9 new keys added (en + zh-Hant): `tickersSearchLiveBadge`, `tickersSearchLiveSearching`, `tickersSearchLiveUnavailable`, `tickersSearchEmptyState`, `tickersMarketChipAll`, `tickersMarketChipTw`, `tickersMarketChipUs`, `tickersMarketChipAu`, `tickersCatalogCount`.

**`apps/api/src/routes/registerRoutes.ts`**
- `POST /__e2e/inject-search-error` handler added. Gated with `assertE2ESeedEnabled()` (additive, not destructive — works in oauth mode). Resolves the AU mock provider from `app.marketDataRegistry.catalog.get("AU")`; calls `_setNextSearchError`. Returns 204. Entry added to `e2eRegistry` audit array.

**`libs/test-e2e/src/assistants/settings/{SettingsActions,SettingsArrange,SettingsAssert}.ts` / `libs/test-e2e/src/pages/settings/SettingsDrawerPage.ts`**
- New AAA actions: `clickMarketChip`, `closeCatalog`.
- New AAA arrange: `injectSearchError`.
- New AAA assertions: `catalogLiveItemHasBadge`, `catalogLiveSearchUnavailableIsVisible`, `catalogItemIsHidden`, `backfillBadgeIs`.
- New page elements in `SettingsDrawerPage`: market chip locators, `liveSearchingMessage` (testid `catalog-live-loading`), `liveUnavailableMessage` (testid `catalog-live-unavailable`).

---

## 2. Optimistic Synthetic Catalog Item Lifecycle

When a user toggles a live result row in `InstrumentCatalogSheet`, `onToggleTicker(key, liveItem)` is called with the `InstrumentCatalogItemDto` from the search result. `useMonitoredTickers.toggleTicker` appends a `LiveSourcedInstrumentCatalogItemDto` to local `instruments` state.

**Lifecycle:**
1. **On toggle** — synthetic row appears immediately in the sheet (optimistic). `barsBackfillStatus: "pending"`, `__liveSourced: true`.
2. **On save** — `PUT /monitored-tickers` persists `{ticker, marketCode}` pairs. The `__liveSourced` marker is NOT sent in the request payload (it is stripped by `parseMonitoredTickerKey`).
3. **On `backfill_complete` SSE** — `handleBackfillEvent` in `useMonitoredTickers` flips the row's `barsBackfillStatus` to `"ready"`. The `__liveSourced` marker survives this update (the handler only mutates `barsBackfillStatus`, not the full row).
4. **On next sheet open** — `useMonitoredTickers` remounts, fetches `/monitored-tickers`, and the server returns the now-persisted instrument. The synthetic row is overwritten by the authoritative DTO. `__liveSourced` does NOT persist beyond the remount.

---

## 3. LIVE Badge Persistence

The `__liveSourced: true` marker on the synthetic row survives the `backfill_complete` SSE event. The badge renderer reads the marker to decide whether to show the `LIVE` label. On the next `useMonitoredTickers` mount (new drawer open), the server DTO does not carry `__liveSourced` — the badge resets.

This design means LIVE is visible for the life of the current settings drawer session, and disappears on the next open (by which point the ticker is a first-class catalog entry).

---

## 4. Error State Collapse

Three distinct backend failure modes map to one user-facing message (`tickersSearchLiveUnavailable`):

| HTTP | Code | Trigger |
|---|---|---|
| 429 | `rate_limit_exceeded` | Per-IP request budget exhausted |
| 503 | `provider_rate_limited` | Yahoo Finance shared budget exhausted (`Retry-After` header present) |
| 503 | `search_unavailable` | Generic upstream failure (`X-Search-Degraded: true` header) |

The web service catches all three and throws `SearchUnavailableError`. The component catches `SearchUnavailableError` and sets a `liveError` flag; all other errors re-throw. The UI renders `tickersSearchLiveUnavailable` for the `liveError` state.

---

## 5. Known UX Trade-offs

- **AU chip discoverability** — The sheet defaults to `All Markets`. Users must click `AU` to unlock live-search fallback. Existing flows (TW catalog, US catalog) are unchanged. If telemetry reveals users are not finding the AU chip, consider making the `AU` chip the default when `monitoredTickers` already contains AU entries, or adding a hint text. Revisit in KZO-189 if adoption data is available.

- **No live search in ALL mode** — `InstrumentCombobox` only fires `searchInstruments` when `marketCodeFilter === "AU"`. ALL mode leaves the empty state as `tickerNoMatches`. This is intentional: cross-market live search would require aggregating results from multiple providers with different rate-limit budgets. Scope deferred.

---

## 6. Validator Evidence

8/8 suites green (pre-PR gate `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`):

| Suite | Result |
|---|---|
| 1 Lint | Clean |
| 2 Typecheck | Clean |
| 3 Web unit | 341 passed |
| 4 API unit | 939 passed |
| 5 Integration | 593 passed |
| 6 E2E bypass | 196 passed (incl. `au-ticker-discovery-aaa.spec.ts` happy path + degraded state) |
| 7 E2E OAuth | 87 passed |
| 8 API HTTP | 202 passed |

---

## 7. Reference

- **Parent backend transition:** `docs/004-notes/kzo-172/transition-202605051045-au-stock-ingestion.md`
- **Pre-PR code review:** `docs/004-notes/kzo-188/review-202605051700-iter1.md` — 1 MEDIUM finding (testid mismatch `catalog-live-searching` → `catalog-live-loading` in `SettingsDrawerPage.ts`) resolved before PR.
- **Linear:** KZO-188 — https://linear.app/kzokv/issue/KZO-188
