import { expect, type Page } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

const MD_BREAKPOINT_PX = 768;

async function assertNoBodyOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (scrollWidth > clientWidth + 1) {
    throw new Error(`body scroll-width (${scrollWidth}) exceeds viewport width (${clientWidth})`);
  }
}

async function assertWithinViewport(
  page: Page,
  testId: string,
) {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: "visible" });
  const readLayout = async () => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    return box && viewport
      ? { x: box.x, width: box.width, viewportWidth: viewport.width }
      : null;
  };
  await expect.poll(
    async () => {
      const layout = await readLayout();
      if (!layout) return `missing layout box for ${testId}`;
      if (layout.x < -1 || layout.x + layout.width > layout.viewportWidth + 1) {
        return `${testId} is clipped outside the viewport (${layout.x}..${layout.x + layout.width} vs ${layout.viewportWidth})`;
      }
      return "ready";
    },
    { message: `${testId} has a stable in-viewport layout box` },
  ).toBe("ready");
}

test.describe("frontend redesign mobile fit", () => {
  test("[mobile-fit-portfolio-A]: validate portfolio controls → stay visible without page overflow", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width >= MD_BREAKPOINT_PX,
      "Mobile-only — exercises the <md dropdown control path",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/portfolio");
    await page.getByTestId("portfolio-holdings-style-control").waitFor({ state: "visible" });
    await page.getByTestId("portfolio-holdings-style-dashboard").waitFor({ state: "visible" });
    await page.getByTestId("portfolio-holdings-style-portfolio").waitFor({ state: "visible" });
    await page.getByTestId("holdings-display-mode-select").waitFor({ state: "visible" });
    await page.getByTestId("holdings-allocation-basis-select").waitFor({ state: "visible" });

    await assertWithinViewport(page, "portfolio-holdings-style-control");
    await assertWithinViewport(page, "holdings-display-mode-select");
    await assertWithinViewport(page, "holdings-allocation-basis-select");
    await assertWithinViewport(page, "portfolio-refresh-button");
    await assertNoBodyOverflow(page);
  });

  test("[mobile-fit-reports-A]: validate reports controls → stay visible without page overflow", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width >= MD_BREAKPOINT_PX,
      "Mobile-only — exercises the <md dropdown control path",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/reports?tab=daily-review&scope=all&range=1Y");
    await page.getByTestId("reports-controls").waitFor({ state: "visible" });
    await page.getByTestId("reports-open-quick-actions").waitFor({ state: "visible" });
    await page.getByTestId("reports-holdings-presets-select-reports.dailyReview.topMovers").waitFor({ state: "visible" });

    await assertWithinViewport(page, "reports-controls");
    await assertWithinViewport(page, "reports-open-quick-actions");
    await assertWithinViewport(page, "reports-holdings-presets-select-reports.dailyReview.topMovers");
    await assertNoBodyOverflow(page);

    await appShell.actions.navigateToRouteForResponsiveTest("/reports?tab=portfolio&scope=all&range=1Y");
    await page.getByTestId("reports-performance-timeline-select").waitFor({ state: "visible" });
    await page.getByTestId("reports-holdings-presets-select-reports.portfolio.holdings").waitFor({ state: "visible" });
    await assertWithinViewport(page, "reports-performance-timeline-select");
    await assertWithinViewport(page, "reports-holdings-presets-select-reports.portfolio.holdings");
    await assertNoBodyOverflow(page);
  });

  test("[mobile-fit-ticker-A]: validate ticker account breakdown cards → stay visible without page overflow", async ({
    appShell,
    page,
  }) => {
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width >= MD_BREAKPOINT_PX,
      "Mobile-only — exercises the <md dropdown control path",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/tickers/2330");
    await page.getByTestId("ticker-tab-select").waitFor({ state: "visible" });
    await page.getByTestId("ticker-chart-range-select").waitFor({ state: "visible" });
    await page.getByTestId("ticker-chart-timeline-select").waitFor({ state: "visible" });
    await page.getByTestId("ticker-account-breakdown").waitFor({ state: "visible" });
    await page.getByTestId("ticker-account-breakdown-reporting-currency").waitFor({ state: "visible" });

    await assertWithinViewport(page, "ticker-tab-select");
    await assertWithinViewport(page, "ticker-chart-range-select");
    await assertWithinViewport(page, "ticker-chart-timeline-select");
    await assertWithinViewport(page, "ticker-account-breakdown");
    await assertWithinViewport(page, "ticker-account-breakdown-reporting-currency");
    await assertNoBodyOverflow(page);
  });
});
