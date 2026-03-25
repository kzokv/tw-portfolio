import { test, expect } from "../fixtures/demo-test";

// These tests verify demo user data visibility across pages.
// They use the /__e2e/demo-session fixture which bypasses the rate limiter.
// Sign-in UI flow is tested separately in auth-demo.spec.ts (which exhausts
// the 5/60s demoRateBuckets limit — that's why this file can't use real sign-in).

test.describe("Demo user — data visibility across pages", () => {
  test("demo user can see seeded transactions on the symbol detail page", async ({ page }) => {
    // Navigate to the symbol detail page for 2330 (seeded with 3 trades: 2 BUYs + 1 SELL)
    await page.goto("/symbols/2330", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("symbol-history-section")).toBeVisible({ timeout: 20_000 });
    // Soft-wait for hydration — SSE keeps persistent connection so networkidle never resolves
    await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});

    // Verify transactions are rendered — the table should have rows, not empty state
    const rows = page.getByTestId("transaction-row");
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });

    // Demo data seeds 3 trades for 2330: BUY 2@98000, BUY 1@99500, SELL 1@101000
    await expect(rows).toHaveCount(3);

    // Verify at least one BUY and one SELL are visible
    await expect(rows.filter({ hasText: "BUY" }).first()).toBeVisible();
    await expect(rows.filter({ hasText: "SELL" }).first()).toBeVisible();

    // Verify mutation buttons are accessible (edit + delete on each row)
    const firstRow = rows.first();
    await expect(firstRow.getByTestId("edit-transaction-button")).toBeVisible();
    await expect(firstRow.getByTestId("delete-transaction-button")).toBeVisible();
  });

  test("demo user sees holdings on the portfolio page", async ({ page }) => {
    // Navigate to portfolio
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    // Wait for the holdings section to appear (client-side fetch via useDashboardData)
    await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});

    // Demo data seeds trades for 2330, 2317, 2454, 2881, 0050.
    // Holdings should show open positions > 0 once the page hydrates.
    const holdingsSection = page.getByTestId("holdings-table");
    await expect(holdingsSection).toBeVisible({ timeout: 20_000 });

    // Verify at least one holding row is rendered (not "No holdings yet")
    const holdingRows = holdingsSection.locator("tbody tr");
    await expect(holdingRows.first()).toBeVisible({ timeout: 10_000 });

    // Verify a known seeded symbol appears in the holdings table
    await expect(holdingsSection).toContainText("2330");
  });

  test("demo user sees empty state on symbol page without trades", async ({ page }) => {
    // Navigate to a symbol with no seeded trades (00919 has no demo data)
    await page.goto("/symbols/00919", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("symbol-history-section")).toBeVisible({ timeout: 20_000 });

    // Should show 0 ledger entries — not an error page
    await expect(page.getByTestId("symbol-history-section")).toContainText("0");
  });
});
