import { test } from "@tw-portfolio/test-e2e/fixtures/demoPages";

// Demo user data visibility tests. Uses demoBase fixture which bypasses the rate limiter.
// Sign-in UI flow is tested in auth-demo-aaa.spec.ts.

test.describe("Demo user — data visibility across pages", () => {
  test("demo user can see seeded transactions on the symbol detail page", async ({ ticker }) => {
    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.rowCountIs(3);
    await ticker.assert.rowMatchingTextsCount(["Jan 15, 2026", "BUY"], 1);
    await ticker.assert.rowMatchingTextsCount(["Jan 22, 2026", "BUY"], 1);
    await ticker.assert.rowMatchingTextsCount(["Feb 15, 2026", "SELL"], 1);
    await ticker.assert.firstRowHasMutationControls();
  });

  test("demo user sees holdings on the portfolio page", async ({ portfolio }) => {
    await portfolio.actions.navigateToPortfolio();
    await portfolio.assert.holdingsTableIsVisible();
    await portfolio.assert.firstHoldingRowIsVisible();
    await portfolio.assert.holdingsTableContains("2330");
  });

  test("demo user sees empty state on symbol page without trades", async ({ ticker }) => {
    await ticker.actions.navigateToTicker("00919");
    await ticker.assert.sectionContains("0");
  });
});
