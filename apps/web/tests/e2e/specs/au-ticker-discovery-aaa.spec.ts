/**
 * KZO-188 — AU ticker discovery E2E (dev_bypass / MemoryPersistence).
 *
 * Covers the browser-facing acceptance criteria for the AU live-search flow:
 *   - User opens InstrumentCatalogSheet → clicks AU chip → types a query →
 *     sees a live result sourced from Yahoo Finance (mocked via
 *     MockYahooFinanceAuMarketDataProvider) → toggles the row → saves →
 *     CBA appears in the tickers list with a backfill badge.
 *   - When the AU mock's search backend is degraded (one-time error injection),
 *     the sheet renders the i18n "Search temporarily unavailable" message.
 *
 * Ticker: CBA (Commonwealth Bank of Australia) — reserved for this spec per
 * `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`. CBA is already in
 * the rule's reservation list — no update needed.
 *
 * CBA is NOT in `AU_RESERVED_INSTRUMENTS` (not seeded by `fetchInstrumentCatalog`
 * by default), so typing "CBA" exercises the live-search fallback path via
 * `searchInstruments` rather than finding the ticker in the local catalog.
 *
 * Memory-mode constraint: pg-boss is null in memory mode, so the backfill job
 * queue won't run automatically. The backfill badge will show "pending" immediately
 * after save rather than transitioning to "ready". The assertion uses a multi-state
 * regex to accept any valid badge state per `.claude/rules/playwright-fast-sse-assertions.md`.
 *
 * Infrastructure check: `POST /__e2e/inject-search-error` is added by the Fullstack
 * Implementer (Slice 6). These tests will be TDD-red until that endpoint lands.
 *
 * Companion rules followed:
 *   - .claude/rules/e2e-aaa-guardrails.md — 2 workers max, no fullyParallel.
 *   - .claude/rules/playwright-navigation-patterns.md — no networkidle.
 *   - .claude/rules/playwright-web-bundle-rebuild.md — use `npm run test:e2e:bypass:mem`.
 *   - .claude/rules/playwright-fast-sse-assertions.md — multi-state regex for badge.
 *   - .claude/rules/react-useEventStream-preconnect-pattern.md — pre-attach wait before save.
 *   - .claude/rules/e2e-shared-memory-bars-ticker-hygiene.md — CBA reserved.
 *   - .claude/rules/e2e-seed-vs-reset-guards.md — inject-search-error uses assertE2ESeedEnabled.
 */

import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

test.describe("AU ticker discovery", () => {
  test.describe.configure({ mode: "default" });

  // KZO-188 Codex P1 follow-up: this test runs BEFORE the [CBA discovery → save]
  // test on purpose. Once that test saves CBA, the API persists CBA into the
  // AU catalog (via `replaceManualSelections`'s `market_data.instruments`
  // upsert), and MemoryPersistence's catalog map is process-global — there is
  // no per-test isolation. Typing "CBA" with CBA already in catalog produces
  // `filtered.length > 0`, which disables the live-search branch the
  // unavailable-state UX hinges on. Keeping this test first guarantees the
  // catalog is clean of CBA at the moment the live search fires.
  test("[catalog]: AU live search unavailable → error message renders", async ({
    appShell,
    settings,
  }) => {
    // ── Arrange: inject a one-time search error into the AU mock provider ──
    // POST /__e2e/inject-search-error calls _setNextSearchError() on the mock.
    // The mock auto-clears the error after one `searchInstruments` call fires,
    // so subsequent searches in the same test would succeed.
    // Per e2e-seed-vs-reset-guards.md: uses assertE2ESeedEnabled (additive guard).
    await settings.arrange.injectSearchError();

    // Navigate to settings → Tickers tab → catalog
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();
    await settings.assert.catalogIsVisible();

    // ── Act: click AU chip → type "CBA" → trigger the degraded search ─────
    await settings.actions.clickMarketChip("AU");

    // Typing "CBA" fires the live search. The injected error causes the mock's
    // searchInstruments to throw, which the service maps to SearchUnavailableError.
    // The sheet renders the tickersSearchLiveUnavailable i18n message.
    await settings.actions.searchCatalog("CBA");

    // ── Assert: error message is visible ──────────────────────────────────
    // i18n en: "Search temporarily unavailable. Try again in a few minutes."
    // Uses data-testid="catalog-live-unavailable" per the Implementer testid map.
    await settings.assert.catalogLiveSearchUnavailableIsVisible();

    // The live row should NOT be visible (search errored out).
    await settings.assert.catalogItemIsHidden("CBA");
  });

  test("[catalog]: CBA live discovery → toggle → save → backfill badge appears", async ({
    appShell,
    settings,
  }) => {
    // ── Arrange: navigate to settings Tickers tab ─────────────────────────
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();

    // ── Act 1: Open catalog → click AU chip → type "CBA" ─────────────────
    await settings.actions.openCatalog();
    await settings.assert.catalogIsVisible();

    // Click the AU market chip to restrict the catalog to AU instruments.
    // With AU chip active and CBA not in the local catalog, the component
    // fires a live search via searchInstruments() after a 300ms debounce.
    await settings.actions.clickMarketChip("AU");

    // Type "CBA" — triggers live search (debounce 300ms) because:
    //   debouncedQuery.length >= 2 && marketChip === "AU" && filteredCatalogCount === 0
    await settings.actions.searchCatalog("CBA");

    // ── Assert 1: Live result row with LIVE badge ─────────────────────────
    // CBA is seeded into MockYahooFinanceAuMarketDataProvider.searchInstruments()
    // but NOT in AU_RESERVED_INSTRUMENTS (not in the local catalog). The live
    // result row uses the same `catalog-item-CBA` testid as catalog rows plus
    // a nested LIVE badge element.
    await settings.assert.catalogItemIsVisible("CBA");
    await settings.assert.catalogLiveItemHasBadge("CBA");

    // ── Act 2: Toggle CBA checkbox ────────────────────────────────────────
    await settings.actions.toggleCatalogItem("CBA");
    await settings.assert.catalogItemIsChecked("CBA");

    // ── Act 3: Close catalog, save ────────────────────────────────────────
    // Go back to tickers tab — selections flow from catalog to the tickers list.
    await settings.actions.closeCatalog();
    await settings.assert.catalogIsHidden();

    // saveTickers() internally pre-attaches the PUT /monitored-tickers wait
    // before clicking save, satisfying the pre-attach contract from
    // react-useEventStream-preconnect-pattern.md.
    await settings.actions.saveTickers();

    // ── Assert 2: Saved confirmation + CBA appears in tickers list ─────────
    // tickersSavedMessageIsVisible + manualTickerIsVisible("CBA") together
    // prove that CBA/AU was persisted — no raw expect on the response body.
    await settings.assert.tickersSavedMessageIsVisible();
    await settings.assert.manualTickerIsVisible("CBA");

    // ── Assert 4: Backfill badge shows any valid status ────────────────────
    // Multi-state regex per playwright-fast-sse-assertions.md: the badge may
    // show "pending" (memory mode — no pg-boss), "backfilling" (optimistic
    // after SSE backfill_started fires), or "ready" (after backfill_complete).
    // We accept all three states since memory mode does not run the full
    // pg-boss job lifecycle.
    await settings.assert.backfillBadgeIs("CBA", /pending|backfilling|ready/);
  });
});
