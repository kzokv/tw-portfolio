/**
 * KZO-194 — AU catalog browser E2E (dev_bypass / MemoryPersistence).
 *
 * Covers the browser-facing acceptance criteria for the AU bulk-catalog flow:
 *   AC #1: After seeding 101 AU instruments, Settings → Tickers → Browse Full
 *           Catalog → click AU chip → catalog list renders ≥100 rows.
 *   AC #2: Clicking the AU chip filters the catalog to AU-only instruments.
 *   AC #3: Clicking "All" chip after AU shows all seeded markets together.
 *
 * Ticker hygiene (per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`):
 *   - `MemoryPersistence` keeps daily bars in a SINGLE process-global array.
 *     This spec seeds via `/__e2e/seed-instruments` (catalog rows only, no bars),
 *     so the global-bars collision rule does NOT apply.
 *   - Reserved AU tickers NOT seeded as bar entries here: BHP, CSL, VAS, WBC,
 *     AFI, GMG, IMD, CBA. We use synthetic tickers (AUCAT001 … AUCAT101) that
 *     cannot collide with any real reserved ticker.
 *   - "AUCAT" prefix chosen to avoid collision with "AUTEST" (used by HTTP spec).
 *
 * Navigation follows `.claude/rules/playwright-navigation-patterns.md`:
 *   - `navigateToRoute` uses `waitUntil: "load"` internally — never `networkidle`.
 *
 * Bundle prerequisite: run `npm run build -w @tw-portfolio/web` or use
 * `npm run test:e2e:bypass:mem --prefix apps/web` to get a fresh bundle
 * (per `.claude/rules/playwright-web-bundle-rebuild.md`).
 *
 * Companion rules followed:
 *   - .claude/rules/e2e-aaa-guardrails.md — 2 workers max, no fullyParallel.
 *   - .claude/rules/playwright-navigation-patterns.md — no networkidle.
 *   - .claude/rules/e2e-seed-vs-reset-guards.md — seed-instruments uses assertE2ESeedEnabled.
 *   - .claude/rules/e2e-shared-memory-bars-ticker-hygiene.md — AUCAT prefix, no bar seeds.
 */

import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

/** Generate N synthetic AU ticker strings: "AUCAT001" ... "AUCAT{N}" */
function generateAuTickers(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    `AUCAT${String(i + 1).padStart(3, "0")}`,
  );
}

const AU_TICKER_COUNT = 101; // seed 101 to safely exceed the ≥100 threshold

test.describe("AU catalog browser", () => {
  // No fullyParallel — MemoryPersistence catalog array is process-global.
  test.describe.configure({ mode: "default" });

  // ── AC #1 ──────────────────────────────────────────────────────────────────
  // After seeding 101 AU instruments the catalog list renders ≥100 visible rows
  // once the AU market chip is clicked.

  test("[catalog]: AU chip → ≥100 rows visible after bulk AU seed", async ({
    appShell,
    settings,
  }) => {
    // ── Arrange: seed 101 AU instruments + 1 TW instrument BEFORE navigation ──
    // The catalog sheet fetches on mount — seed must be in place before the
    // component mounts per `.claude/rules/playwright-navigation-patterns.md`
    // (seed-before-navigate contract).
    //
    // IMPORTANT: `/__e2e/seed-instruments` calls `_replaceInstruments` which
    // CLEARS and REPLACES the entire user-scoped catalog. Two separate calls
    // would cause the second call (TWCAT001) to wipe the first (101 AU items).
    // Both markets must be seeded in a SINGLE combined call.
    const auTickers = generateAuTickers(AU_TICKER_COUNT);
    await settings.arrange.seedInstruments([
      ...auTickers.map((ticker) => ({
        ticker,
        name: `AU Catalog Test ${ticker}`,
        instrumentType: "STOCK" as const,
        marketCode: "AU",
        barsBackfillStatus: "ready",
      })),
      // One TW instrument for the market-isolation sanity fixture
      {
        ticker: "TWCAT001",
        name: "TW Catalog Test 001",
        instrumentType: "STOCK" as const,
        marketCode: "TW",
        barsBackfillStatus: "ready",
      },
    ]);

    // ── Act: navigate → open catalog → click AU chip ────────────────────────
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();
    await settings.assert.catalogIsVisible();

    await settings.actions.clickMarketChip("AU");

    // Wait for the catalog list to populate — the list element should be visible
    // and contain rows after the chip click triggers a client-side filter.
    // We wait for the first seeded ticker to appear as a proxy for list readiness.
    await settings.assert.catalogItemIsVisible("AUCAT001");

    // ── Assert: catalog list contains ≥100 items under the AU chip ──────────
    // `catalogItemCountAtLeast` counts `[data-testid^="catalog-item-"]` within
    // the catalog list container. The catalog renders up to 100 items initially
    // (incremental-render window); 101 seeded AU items → 100 rendered → ≥100.
    await settings.assert.catalogItemCountAtLeast(100);
  });

  // ── AC #2 ──────────────────────────────────────────────────────────────────
  // The AU chip filters to AU-only instruments — TW instruments are absent.

  test("[catalog]: AU chip hides TW-market instruments", async ({
    appShell,
    settings,
  }) => {
    // Arrange: seed one AU + one TW instrument
    await settings.arrange.seedInstruments([
      {
        ticker: "AUCAT001",
        name: "AU Catalog Test 001",
        instrumentType: "STOCK",
        marketCode: "AU",
        barsBackfillStatus: "ready",
      },
      {
        ticker: "TWCAT001",
        name: "TW Catalog Test 001",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
      },
    ]);

    // Navigate → open catalog
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();
    await settings.assert.catalogIsVisible();

    // Click AU chip
    await settings.actions.clickMarketChip("AU");
    await settings.assert.catalogItemIsVisible("AUCAT001");

    // TWCAT001 should be hidden (it is a TW market instrument)
    await settings.assert.catalogItemIsHidden("TWCAT001");
  });

  // ── AC #3 ──────────────────────────────────────────────────────────────────
  // Switching back to "All" chip shows instruments from both AU and TW markets.

  test("[catalog]: All chip re-shows TW instruments after AU chip active", async ({
    appShell,
    settings,
  }) => {
    // Arrange: seed AU + TW instruments
    await settings.arrange.seedInstruments([
      {
        ticker: "AUCAT002",
        name: "AU Catalog Test 002",
        instrumentType: "ETF",
        marketCode: "AU",
        barsBackfillStatus: "ready",
      },
      {
        ticker: "TWCAT002",
        name: "TW Catalog Test 002",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
      },
    ]);

    // Navigate → open catalog
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();
    await settings.assert.catalogIsVisible();

    // Click AU chip — TW instruments hidden
    await settings.actions.clickMarketChip("AU");
    await settings.assert.catalogItemIsVisible("AUCAT002");
    await settings.assert.catalogItemIsHidden("TWCAT002");

    // Click All chip — both markets visible again
    await settings.actions.clickMarketChip("all");
    await settings.assert.catalogItemIsVisible("AUCAT002");
    await settings.assert.catalogItemIsVisible("TWCAT002");
  });
});
