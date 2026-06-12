import { expect, type Page } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

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
  test("[mobile-fit-portfolio-A]: portfolio controls stay visible without page overflow", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRouteForResponsiveTest("/portfolio");
    await page.getByTestId("portfolio-holdings-style-control").waitFor({ state: "visible" });
    await page.getByTestId("portfolio-holdings-style-dashboard").waitFor({ state: "visible" });
    await page.getByTestId("portfolio-holdings-style-portfolio").waitFor({ state: "visible" });

    await assertWithinViewport(page, "portfolio-holdings-style-control");
    await assertWithinViewport(page, "portfolio-refresh-button");
    await assertNoBodyOverflow(page);
  });

  test("[mobile-fit-reports-A]: reports controls stay visible without page overflow", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRouteForResponsiveTest("/reports?tab=daily-review&scope=all&range=1Y");
    await page.getByTestId("reports-controls").waitFor({ state: "visible" });
    await page.getByTestId("reports-open-quick-actions").waitFor({ state: "visible" });

    await assertWithinViewport(page, "reports-controls");
    await assertWithinViewport(page, "reports-open-quick-actions");
    await assertNoBodyOverflow(page);
  });

  test("[mobile-fit-ticker-A]: ticker account breakdown cards stay visible without page overflow", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRouteForResponsiveTest("/tickers/2330");
    await page.getByTestId("ticker-account-breakdown").waitFor({ state: "visible" });
    await page.getByTestId("ticker-account-breakdown-reporting-currency").waitFor({ state: "visible" });

    await assertWithinViewport(page, "ticker-account-breakdown");
    await assertWithinViewport(page, "ticker-account-breakdown-reporting-currency");
    await assertNoBodyOverflow(page);
  });
});
