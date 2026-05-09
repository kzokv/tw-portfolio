/**
 * KZO-196 — E2E spec for the AU-only GICS sector filter on the
 * `InstrumentCatalogSheet` (settings → tickers → browse full catalog).
 *
 * Acceptance behavior covered:
 *   [A1] AU chip → sector dropdown visible; ALL/TW/US → hidden.
 *   [A2] Selecting a sector narrows visible AU rows by industry-group expansion.
 *   [A3] Live-search results show regardless of sector filter (search bypass).
 *   [A4] Industry-group label is rendered on rows where data is present;
 *        absent on null-group rows.
 *
 * Reserved tickers (per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`):
 *   - `AUGICS01`–`AUGICS05` reserved for KZO-196 catalog seeds. No daily-bars
 *     seeds are used in this spec, so the global-bars collision rule does not
 *     apply, but the prefix is still grep-verified unique to prevent future
 *     bar-seed collisions.
 *
 * Dependencies (see `.worklog/team/qa-plan.md`):
 *   - Backend: `/__e2e/seed-instruments` Zod schema must accept
 *     `gicsIndustryGroup: string | null` on each instrument.
 *   - Frontend: testids `catalog-sector-select` and
 *     `catalog-item-{ticker}-industry` per the locked design.
 *
 * Companion rules followed:
 *   - `.claude/rules/playwright-navigation-patterns.md` — no `networkidle`.
 *   - `.claude/rules/e2e-aaa-guardrails.md` — 2 workers max, no `fullyParallel`.
 *   - `.claude/rules/e2e-seed-vs-reset-guards.md` — seed-instruments uses the
 *     additive seed guard.
 *   - `.claude/rules/playwright-page-object-testid-drift.md` — locator strings
 *     in `SettingsDrawerPage` are added in the same diff as this spec.
 *   - `.claude/rules/playwright-web-bundle-rebuild.md` — invoke via
 *     `npm run test:e2e:bypass:mem --prefix apps/web` (rebuilds the standalone
 *     bundle before running).
 */

import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

/**
 * Build a fixture catalog covering ≥3 sectors + a null-group row so the spec
 * can exercise the dropdown gate, the narrow logic, and the "no label when
 * null" assertion in a single seed call.
 *
 * Industry-group strings match the canonical S&P/MSCI labels in
 * `libs/shared-types/src/gics.ts`.
 */
function makeAuFixture() {
  return [
    {
      ticker: "AUGICS01",
      name: "AUGICS Banks Co",
      instrumentType: "STOCK" as const,
      marketCode: "AU",
      barsBackfillStatus: "ready",
      gicsIndustryGroup: "Banks", // Financials sector
    },
    {
      ticker: "AUGICS02",
      name: "AUGICS Insurance Co",
      instrumentType: "STOCK" as const,
      marketCode: "AU",
      barsBackfillStatus: "ready",
      gicsIndustryGroup: "Insurance", // Financials sector
    },
    {
      ticker: "AUGICS03",
      name: "AUGICS Materials Co",
      instrumentType: "STOCK" as const,
      marketCode: "AU",
      barsBackfillStatus: "ready",
      gicsIndustryGroup: "Materials", // Materials sector
    },
    {
      ticker: "AUGICS04",
      name: "AUGICS Energy Co",
      instrumentType: "STOCK" as const,
      marketCode: "AU",
      barsBackfillStatus: "ready",
      gicsIndustryGroup: "Energy", // Energy sector
    },
    {
      ticker: "AUGICS05",
      name: "AUGICS No GICS Co",
      instrumentType: "STOCK" as const,
      marketCode: "AU",
      barsBackfillStatus: "ready",
      gicsIndustryGroup: null, // No label rendered
    },
  ];
}

test.describe("AU GICS sector filter", () => {
  // No fullyParallel — MemoryPersistence catalog array is process-global; we
  // mirror the discipline of `au-catalog-browser-aaa.spec.ts`.
  test.describe.configure({ mode: "default" });

  // ── A1 ────────────────────────────────────────────────────────────────────
  test("[A1]: sector dropdown is visible only when AU chip selected", async ({
    appShell,
    settings,
  }) => {
    // Arrange: seed at least one AU + one TW row so each chip has content.
    await settings.arrange.seedInstruments([
      ...makeAuFixture(),
      {
        ticker: "TWGICS001",
        name: "TW No GICS",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
      },
    ]);

    // Act: navigate → open catalog.
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();
    await settings.assert.catalogIsVisible();

    // Default chip is "All" → dropdown hidden.
    await settings.assert.sectorFilterIsHidden();

    // TW chip → still hidden.
    await settings.actions.clickMarketChip("TW");
    await settings.assert.sectorFilterIsHidden();

    // US chip → still hidden (no US rows but the gating is on chip identity).
    await settings.actions.clickMarketChip("US");
    await settings.assert.sectorFilterIsHidden();

    // AU chip → dropdown becomes visible.
    await settings.actions.clickMarketChip("AU");
    await settings.assert.sectorFilterIsVisible();
  });

  // ── A2 ────────────────────────────────────────────────────────────────────
  test("[A2]: selecting a sector narrows AU rows by industry-group expansion", async ({
    appShell,
    settings,
  }) => {
    await settings.arrange.seedInstruments(makeAuFixture());

    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();
    await settings.actions.clickMarketChip("AU");
    await settings.assert.sectorFilterIsVisible();

    // Without a sector filter, all 5 rows are visible.
    await settings.assert.catalogItemIsVisible("AUGICS01");
    await settings.assert.catalogItemIsVisible("AUGICS02");
    await settings.assert.catalogItemIsVisible("AUGICS03");
    await settings.assert.catalogItemIsVisible("AUGICS04");
    await settings.assert.catalogItemIsVisible("AUGICS05");

    // Select "Financials" — expands to {Banks, Financial Services, Insurance};
    // AUGICS01 (Banks) + AUGICS02 (Insurance) remain; Materials/Energy/null hide.
    await settings.actions.selectSectorFilter("Financials");
    await settings.assert.catalogItemIsVisible("AUGICS01");
    await settings.assert.catalogItemIsVisible("AUGICS02");
    await settings.assert.catalogItemIsHidden("AUGICS03");
    await settings.assert.catalogItemIsHidden("AUGICS04");
    await settings.assert.catalogItemIsHidden("AUGICS05");

    // Reset to "All sectors" — every AU row visible again.
    await settings.actions.selectSectorFilter("");
    await settings.assert.catalogItemIsVisible("AUGICS01");
    await settings.assert.catalogItemIsVisible("AUGICS03");
    await settings.assert.catalogItemIsVisible("AUGICS04");
    await settings.assert.catalogItemIsVisible("AUGICS05");
  });

  // ── A4 ────────────────────────────────────────────────────────────────────
  // Run before A3 because A3 has heavier interactions (live-search) and A4 is
  // the simpler render-only assertion that doubles as a sanity check on the
  // industry-group label testid.
  test("[A4]: industry-group label is rendered on rows that have it; absent on null-group rows", async ({
    appShell,
    settings,
  }) => {
    await settings.arrange.seedInstruments(makeAuFixture());

    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();
    await settings.actions.clickMarketChip("AU");

    // Banks row carries an industry-group label that resolves to the Banks i18n
    // string. The exact text is locale-dependent ("Banks" in en); use a regex
    // for resilience against future re-translations.
    await settings.assert.industryLabelIsVisible("AUGICS01", /banks/i);
    await settings.assert.industryLabelIsVisible("AUGICS03", /materials/i);
    await settings.assert.industryLabelIsVisible("AUGICS04", /energy/i);

    // Null-group row → label not rendered.
    await settings.assert.industryLabelIsHidden("AUGICS05");
  });

  // ── A3 ────────────────────────────────────────────────────────────────────
  // Live-search bypass: even when a sector filter is active, a live-search hit
  // for a ticker outside that sector must render. This guards the contract that
  // the search box drives a separate query path that ignores the sector narrow.
  //
  // The dev_bypass mock provider seam returns deterministic results (see
  // `apps/api/src/services/market-data/providers/index.ts`). When the seeded
  // catalog already contains a matching row, the typed query is treated as a
  // local-filter hit; the sector filter must NOT hide the matching row when the
  // user has typed a query that exactly matches its ticker.
  test("[A3]: live-search hits are visible regardless of active sector filter", async ({
    appShell,
    settings,
  }) => {
    await settings.arrange.seedInstruments(makeAuFixture());

    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();
    await settings.actions.clickMarketChip("AU");

    // Narrow to Financials — Materials row should be hidden.
    await settings.actions.selectSectorFilter("Financials");
    await settings.assert.catalogItemIsHidden("AUGICS03");

    // Type a search query that targets the Materials row. The component's
    // search-driven render path must show AUGICS03 even though the active
    // sector filter would otherwise hide it.
    await settings.actions.searchCatalog("AUGICS03");
    await settings.assert.catalogItemIsVisible("AUGICS03");
  });
});
