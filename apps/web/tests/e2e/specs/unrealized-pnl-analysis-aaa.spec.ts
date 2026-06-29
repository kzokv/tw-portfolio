import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import type { Page } from "@playwright/test";

async function forceAnalysisPreviewFallback(page: Page) {
  const appOrigin = new URL(TestEnv.appBaseUrl).origin;
  await page.route("**/analysis/unrealized-pnl**", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin || url.pathname !== "/analysis/unrealized-pnl") {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ message: "analysis preview fallback" }),
    });
  });
}

test("[analysis-unrealized-pnl-A]: open analysis, select ticker lines, and scrub focus → URL state is preserved", async ({
  appShell,
  page,
}) => {
  await forceAnalysisPreviewFallback(page);
  await appShell.actions.setViewport(1440, 960);
  await page.goto(new URL("/analysis", TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });

  await page.getByRole("heading", { name: "Analysis workspaces" }).waitFor({ state: "visible" });
  await page.getByRole("link", { name: "Open analysis" }).click();
  await page.getByRole("heading", { name: "Unrealized P&L Analysis" }).waitFor({ state: "visible" });
  await page.getByText("Preview contract fallback").waitFor({ state: "visible" });
  await page.getByLabel("Unrealized P&L comparison chart").waitFor({ state: "visible" });

  await page.getByLabel("Lines").fill("8");
  await page.waitForURL(/comparisonLineCount=8/);
  await appShell.assert.mxAssertEqual(new URL(page.url()).searchParams.get("comparisonLineCount"), "8", "line count URL state");

  await page.locator("button[role='checkbox']").first().click();
  await page.waitForURL(/selectionMode=manual/);
  const selectionUrl = new URL(page.url());
  await appShell.assert.mxAssertEqual(selectionUrl.searchParams.get("selectionMode"), "manual", "manual selection URL state");
  await appShell.assert.mxAssertEqual(selectionUrl.searchParams.get("view"), "compare", "comparison view URL state");
  await appShell.assert.mxAssertTruthy(Boolean(selectionUrl.searchParams.get("selectedTickers")), "selected ticker URL state");

  await page.getByTestId("analysis-focus-scrub").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForURL(/focus=/);
  await appShell.assert.mxAssertTruthy(Boolean(new URL(page.url()).searchParams.get("focus")), "focus date URL state");
});

test("[analysis-unrealized-pnl-B]: open reports summary deep-link → analysis route state is preserved", async ({
  appShell,
  page,
}) => {
  await forceAnalysisPreviewFallback(page);
  await appShell.actions.setViewport(1440, 960);
  await page.goto(new URL("/reports?tab=daily-review&scope=US&range=1M", TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });

  const link = page.getByTestId("reports-summary-unrealized-pnl-analysis-link");
  await link.waitFor({ state: "visible" });

  const href = await link.getAttribute("href");
  await appShell.assert.mxAssertTruthy(Boolean(href?.startsWith("/analysis/unrealized-pnl")), "reports summary analysis link target");
  const target = new URL(href ?? "/analysis/unrealized-pnl", TestEnv.appBaseUrl);
  await appShell.assert.mxAssertEqual(target.searchParams.get("range"), "1M", "reports range maps into analysis state");
  await appShell.assert.mxAssertEqual(target.searchParams.get("markets"), "US", "reports scope maps into analysis state");

  await link.click();
  await page.getByRole("heading", { name: "Unrealized P&L Analysis" }).waitFor({ state: "visible" });
  await appShell.assert.isOnRoute(/\/analysis\/unrealized-pnl/);
});
