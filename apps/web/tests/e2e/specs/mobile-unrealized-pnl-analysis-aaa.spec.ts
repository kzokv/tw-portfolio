import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import type { Page } from "@playwright/test";

const SM_BREAKPOINT_PX = 640;

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

test("[mobile-analysis-unrealized-pnl-A]: open analysis workspace on mobile → page remains usable without overflow", async ({
  appShell,
  page,
}) => {
  const viewport = page.viewportSize();
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(
    !viewport || viewport.width >= SM_BREAKPOINT_PX,
    "Mobile-only — verifies the analysis chart and ranking stack under sm",
  );

  await forceAnalysisPreviewFallback(page);
  await appShell.actions.navigateToRouteForResponsiveTest("/analysis/unrealized-pnl");
  await page.getByRole("heading", { name: "Unrealized P&L Analysis" }).waitFor({ state: "visible" });
  await page.getByLabel("Unrealized P&L comparison chart").waitFor({ state: "visible" });
  await page.getByTestId("analysis-chart-legend").getByText("NVIDIA Corporation").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Filters Show filters/ }).click();
  await page.getByText("Top drivers", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("Manual tickers", { exact: true }).waitFor({ state: "visible" });
  await page.getByTestId("analysis-ticker-picker-trigger").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Manual tickers", exact: true }).click();
  await page.waitForURL(/selection=manualTickers/);
  await page.locator("button").filter({ hasText: /^5$/ }).waitFor({ state: "hidden" });
  await page.getByTestId("analysis-ticker-picker-trigger").click();
  await page.getByTestId("analysis-ticker-picker").getByText("US:NVDA:NVIDIA Corporation").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.getByTestId("analysis-ticker-picker").waitFor({ state: "hidden" });
  await page.getByTestId("analysis-selected-detail").getByText("Selected ticker detail").waitFor({ state: "visible" });
  await page.getByTestId("analysis-focus-scrub").waitFor({ state: "visible" });

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  await appShell.assert.mxAssertTruthy(
    scrollWidth <= clientWidth + 1,
    `analysis page scroll-width (${scrollWidth}) must fit viewport (${clientWidth})`,
  );
});
