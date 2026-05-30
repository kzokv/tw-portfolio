---
slug: kzo-188
source: scope-grill
created: 2026-05-05
tickets: [KZO-188]
required_reading:
  - docs/004-notes/kzo-172/scope-todo-202605021330-au-stock-ingestion.md
  - docs/004-notes/kzo-172/transition-202605051045-au-stock-ingestion.md
  - .worklog/scopes/kzo-172/debate-result.md
superseded_by: null
---

# Todo: KZO-188 — AU Ticker Discovery UI

> **For agents starting a fresh session:** read all files listed in `required_reading` above. The KZO-172 transition note documents the backend slice this UI consumes; the debate-result enumerates the 4 Frontend sub-gaps that became this ticket's acceptance criteria.

## Locked Decisions Summary

This scope was produced through `/scope-grill` over 11 questions + a Phase 1.5 gap check that surfaced 2 critical gaps + 4 non-critical items + 5 additions from the parent KZO-172 doc review.

Backend slice (`searchInstruments` provider, `GET /market-data/search` route, mock fixture with CBA, HTTP suite) is shipped at HEAD on `dev`. This ticket wires the frontend.

## Standalone Deployability

KZO-188 ships on its own — no other tickets blocked. End-to-end AU discovery flow works once merged: chip = AU → type → live results → save → backfill enrichment → catalog row materialized for next session.

## Implementation Steps

### Phase 1 — Web service + debounce hook

- [x] Create `apps/web/lib/hooks/useDebouncedValue.ts` — generic `useDebouncedValue<T>(value: T, delayMs: number): T`. `useState` + `useEffect` + `setTimeout`; cleanup clears pending timer on every value change. No `AbortController` inside the hook — caller owns abort.
- [x] Create `apps/web/features/settings/services/instrumentSearchService.ts`:
  - Export `searchInstruments(q: string, marketCode: MarketCode, signal?: AbortSignal): Promise<InstrumentCatalogItemDto[]>`.
  - Calls `GET /market-data/search?q={q}&market_code={marketCode}` via `getJson` (passing `{ signal }`).
  - Branches on response status:
    - `200` → return `body.instruments`.
    - `429` OR (`503` AND `X-Search-Degraded: true` header) OR `503 provider_rate_limited` → throw `SearchUnavailableError` (export new typed error class from same file).
  - Per `service-error-pattern.md`: machine code lives at `body.error`, NOT `body.code`.
  - Per `nextjs-server-cookie-access.md`: this is a client-context call; `getJson` is browser-side. No server-side variant needed.

### Phase 2 — `InstrumentCatalogSheet` chip group + live search

- [x] Add a 4-button market-chip group at the top of the sheet (above the type-filter chips).
  - Buttons: `All Markets · TW · US · AU`.
  - Default state: `All Markets`.
  - Filter the existing `instruments` prop **client-side** by `marketCode` — no backend route change.
  - Use the same `inline-flex / gap-1 / rounded-md` styling as the existing type-filter chip group at `InstrumentCatalogSheet.tsx:96-112`.
- [x] Wire live-search trigger inside the sheet:
  - `useDebouncedValue(search, 300)` produces `debouncedQuery`.
  - `useEffect` fires when `debouncedQuery.length >= 2 && marketChip === "AU" && filteredCatalogCount === 0` (where `filteredCatalogCount` is the count after BOTH market chip + type filter).
  - Effect creates `AbortController`, calls `searchInstruments(debouncedQuery, "AU", controller.signal)`, stores results in local state. Cleanup `controller.abort()`.
  - Error caught → store `SearchUnavailableError` flag; render `tickersSearchLiveUnavailable` message.
  - Loading state (in-flight): render `tickersSearchLiveSearching` indicator.
- [x] Render live results in place of the empty state when filtered catalog count is 0 AND live results exist:
  - Each live row: same row layout as catalog rows, plus a small `LIVE` badge (i18n: `tickersSearchLiveBadge`).
  - Live results pass through the same type filter (post-classification). Hidden-by-filter results dropped silently.
  - `tickersSearchEmptyState` ("No tickers found.") renders only when both catalog AND live return 0 (or live didn't fire because chip ≠ AU).
- [x] Drop the count line at `InstrumentCatalogSheet.tsx:117` in three modes (loading, live-results-shown, empty-search). Keep it (i18n-templated) only when catalog has results.
- [x] Toggle a live row → call `onToggleTicker(key, liveItem)` with the synthetic `InstrumentCatalogItemDto` as the second arg.

### Phase 3 — Toggle handler signature + optimistic synthetic catalog item

- [x] Change `useMonitoredTickers` toggle signature from `(key: string) => void` to `(key: string, liveItem?: InstrumentCatalogItemDto) => void`.
- [x] When `liveItem` is passed, append the synthetic to local `instruments` state (idempotent on key collision):
  - `barsBackfillStatus: "pending"`
  - Non-DTO marker `__liveSourced: true` for badge persistence
  - All other fields populated from the search result row.
- [x] Update `MonitoredTickersSection` toggle call sites to pass `undefined` as the second arg (existing catalog-row path). Pure refactor, no behavior change.
- [x] Verify SSE `backfill_complete` event in `useMonitoredTickers.handleBackfillEvent` correctly flips the synthetic row's `barsBackfillStatus` to `ready` (existing wiring; should require no change).

### Phase 4 — `InstrumentCombobox` live-search fallback + `liveResults` Map

- [x] Add component-local `liveResults: Map<string, TransactionInstrumentOption>` keyed by `${ticker}|${marketCode}`. Populated on `commitSelection`. Queried as fallback in the `selectedInstrument` lookup at `InstrumentCombobox.tsx:50-57` so un-catalogued live picks render their formatted display string after commit.
- [x] Wire live-search trigger:
  - `useDebouncedValue(query, 300)` produces `debouncedQuery`.
  - Effect fires when `debouncedQuery.length >= 2 && marketCodeFilter === "AU" && filtered.items.length === 0`.
  - `AbortController` + `searchInstruments` call → store live results in local state.
- [x] Render live results below catalog matches in the listbox (or in place of empty state when `filtered.items.length === 0`):
  - Same row layout as catalog options.
  - `LIVE` badge per row.
  - `data-testid="tx-ticker-option-{ticker}-{marketCode}"` (matches existing pattern; live picks behave identically once committed).
- [x] Render loading + error states as small inline strings inside the listbox (matches existing `isLoading` rendering at `InstrumentCombobox.tsx:214-215`).
- [x] **No live search in ALL mode** (`marketCodeFilter === null`). Empty-state stays as `tickerNoMatches`. Document in transition note.

### Phase 5 — i18n keys (en + zh-Hant)

- [x] Add 9 new keys under `settings.tickers*` in `apps/web/features/settings/i18n.ts`:
  - `tickersSearchLiveBadge` — `"LIVE"` / `"即時"`
  - `tickersSearchLiveSearching` — `"Searching Yahoo Finance…"` / `"搜尋 Yahoo Finance…"`
  - `tickersSearchLiveUnavailable` — `"Search temporarily unavailable. Try again in a few minutes."` / `"搜尋暫時無法使用，請稍後再試。"`
  - `tickersSearchEmptyState` — `"No tickers found."` / `"找不到符合的標的。"`
  - `tickersMarketChipAll` — `"All Markets"` / `"全部市場"`
  - `tickersMarketChipTw` — `"TW"` / `"TW"`
  - `tickersMarketChipUs` — `"US"` / `"US"`
  - `tickersMarketChipAu` — `"AU"` / `"AU"`
- [x] Migrate hardcoded `"No instruments found."` at `InstrumentCatalogSheet.tsx:123` → `dict.settings.tickersSearchEmptyState`.
- [x] Migrate hardcoded `"{count} instrument{s}"` count line at `InstrumentCatalogSheet.tsx:117` → new templated key (e.g. `tickersCatalogCount: "{count} instruments"` / `"{count} 個標的"`). Use `.replace("{count}", String(n))` per `nextjs-i18n-serialization.md` — string templates only, no functions.

### Phase 6 — Test-only error injection endpoint

- [x] In `apps/api/src/routes/registerRoutes.ts`:
  - Add `POST /__e2e/inject-search-error` handler.
  - Gate with `assertE2ESeedEnabled()` per `e2e-seed-vs-reset-guards.md` (NOT `assertE2EResetEnabled` — this is additive, not destructive; must work in oauth mode if/when needed).
  - Resolve the AU mock provider from `app.marketDataRegistry.catalog.get("AU")`; cast to `MockYahooFinanceAuMarketDataProvider`; call `_setNextSearchError(new Error("simulated_upstream_failure"))`.
  - Return `204`.
- [x] Add `"POST /__e2e/inject-search-error"` to the `e2eRegistry` array at `registerRoutes.ts:409-417` (audit surface).

### Phase 7 — E2E spec

- [x] Create `apps/web/tests/e2e/specs/au-ticker-discovery-aaa.spec.ts` (bypass-mem profile, parallel to `au-backfill-aaa.spec.ts`).
- [x] **Spec 1 — happy path (CBA discovery → save → backfill enrichment):**
  1. Open settings → Tickers tab → click `Browse full catalog` button (`browse-catalog-btn`).
  2. Click `AU` chip in the sheet.
  3. Type `"CBA"` into the catalog search input.
  4. Wait for live result row with `LIVE` badge AND `data-testid="catalog-item-CBA"`.
  5. Toggle the checkbox.
  6. Click `tickers-save-btn`. Wait for `PUT /monitored-tickers` response (assert payload includes `{ ticker: "CBA", marketCode: "AU" }`).
  7. **Pre-attach** the SSE wait listener BEFORE the save click (per `react-useEventStream-preconnect-pattern.md`).
  8. Wait for `backfill_complete` SSE event (or status flip on the row) — multi-state regex per `playwright-fast-sse-assertions.md`: `/backfilling|ready|recomputed/`.
- [x] **Spec 2 — degraded state:**
  1. POST to `/__e2e/inject-search-error` (test fixture helper).
  2. Open sheet → click `AU` chip → type `"CBA"`.
  3. Assert `tickersSearchLiveUnavailable` message renders.
  4. Mock auto-clears the next-search-error after one fire — subsequent searches in the same test would succeed (don't rely on the error persisting).
- [x] Reserved CBA ticker per `e2e-shared-memory-bars-ticker-hygiene.md` (already in the rule's reservation list — no rule update needed).

### Phase 8 — Vitest unit coverage

- [x] Extend `apps/web/test/features/portfolio/InstrumentCombobox.test.tsx` (or add a new `*-live-results.test.tsx`):
  - Render combobox in `marketCodeFilter="AU"` mode with empty catalog.
  - Mock `instrumentSearchService.searchInstruments` to return `[{ ticker: "CBA", ... }]`.
  - Type "CBA" → wait for live result → click → assert `onSelect("CBA", "AU")` fires.
  - Assert post-commit `inputValue` displays the formatted live row (proves `liveResults` Map fallback works).
  - Add a second test for the SearchUnavailableError path.
- [x] Optional: add `apps/web/test/features/settings/InstrumentCatalogSheet.test.tsx` for the chip filter + live-search trigger logic. Lower priority than the combobox test; the E2E covers the integration.

### Phase 9 — Pre-PR security audit

- [x] Code Reviewer + Implementer audit: NO `dangerouslySetInnerHTML` anywhere in new code. All live-row text rendered via JSX text nodes. Matches existing precedent at `InstrumentCatalogSheet.tsx:158` and `InstrumentCombobox.tsx:242` (verified Security F5 ACCEPT in KZO-172 debate).
- [x] Verify the web service does NOT log the raw query string at `error` level (CRLF hygiene per Security F2). Should be passed as a structured field, not interpolated into the message.

### Phase 10 — Pre-PR full gate + documentation

- [x] Run pre-PR full gate per `.claude/rules/full-test-suite.md`:
  ```bash
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```
- [x] Pre-PR code review per `.claude/rules/code-review-before-pr.md` → produce review doc at `docs/004-notes/kzo-188/review-{YYYYMMDDHHmm}-iter1.md`. Work the fix list top-down with TDD validation before opening the PR.
- [x] Create transition note at `docs/004-notes/kzo-188/transition-{YYYYMMDDHHmm}-au-ticker-discovery-ui.md`. Cover:
  - What shipped (sheet chip + live search, combobox liveResults Map, debounce hook, web service, E2E + degraded state, i18n migration).
  - Optimistic synthetic catalog item lifecycle (Phase 3): synthetic persists for the session, overwritten on next sheet open.
  - LIVE badge persistence (`__liveSourced` marker survives backfill_complete; resets on next sheet remount).
  - Error state collapse (3 backend codes → 1 user message).
  - Known UX trade-offs:
    - AU chip discoverability: default `All Markets`; user clicks `AU` to discover. Revisit if telemetry shows users not finding it.
    - ALL mode in combobox does not fall back to live search (chip-driven only).
  - Reference KZO-172 transition for the parent backend slice.

## Open Items (non-blocking)

None surfaced. KZO-189 / KZO-190 / KZO-177 already exist as separate tickets per the parent decomposition.

## References

- **UI mockup (frozen):** `docs/004-notes/kzo-188/mockup-202605051556-au-ticker-discovery.png` (composite of all 6 sheet/combobox states + acceptance legend; source HTML alongside).
- **Linear:** KZO-188 — https://linear.app/kzokv/issue/KZO-188
- **Parent ticket:** KZO-172 (backend slice) — https://linear.app/kzokv/issue/KZO-172
- **Frozen records:**
  - KZO-172 scope-todo: `docs/004-notes/kzo-172/scope-todo-202605021330-au-stock-ingestion.md`
  - KZO-172 transition: `docs/004-notes/kzo-172/transition-202605051045-au-stock-ingestion.md`
  - KZO-172 debate result: `.worklog/scopes/kzo-172/debate-result.md`
  - KZO-171 spike: `docs/004-notes/kzo-171/spike-202605021115-au-provider.md`
- **Repo rules invoked:**
  - `.claude/rules/nextjs-i18n-serialization.md` (string templates only)
  - `.claude/rules/playwright-fast-sse-assertions.md` (multi-state regex)
  - `.claude/rules/playwright-web-bundle-rebuild.md` (rebuild for E2E)
  - `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` (CBA reserved)
  - `.claude/rules/e2e-seed-vs-reset-guards.md` (`assertE2ESeedEnabled` for `/__e2e/inject-search-error`)
  - `.claude/rules/service-error-pattern.md` (`body.error` not `body.code`; 429 vs 503 distinction)
  - `.claude/rules/react-useEventStream-preconnect-pattern.md` (pre-attach SSE listener)
  - `.claude/rules/code-review-before-pr.md` (formal pre-PR review phase)
  - `.claude/rules/full-test-suite.md` (8-suite gate)
  - `.claude/rules/phased-ticket-scope-completeness.md` (standalone-deployability — satisfied)
  - `.claude/rules/agent-team-workflow.md` (parallel Phase 1/2 contract for Tier 2)
- **Precedent files:**
  - `apps/api/src/routes/registerRoutes.ts:3130` (the route this ticket consumes)
  - `apps/api/src/services/market-data/providers/mockYahooFinanceAu.ts:211` (mock fixture + `_setNextSearchError`)
  - `apps/web/features/settings/components/InstrumentCatalogSheet.tsx` (target file)
  - `apps/web/components/portfolio/InstrumentCombobox.tsx` (target file; lines 50-57 lookup, 68-72 commit effect)
  - `apps/web/features/settings/hooks/useMonitoredTickers.ts` (toggle handler signature change)
  - `apps/web/features/settings/services/monitoredTickersService.ts` (web service precedent)
  - `apps/web/tests/e2e/specs/au-backfill-aaa.spec.ts` (E2E spec parallel)
