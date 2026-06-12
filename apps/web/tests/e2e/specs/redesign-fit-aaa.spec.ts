import type { Page } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { seedQuoteBars } from "./helpers/anonymousShare.js";
import { seedTransactionForUser } from "./helpers/sharing.js";

async function assertNoBodyOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (scrollWidth > clientWidth + 1) {
    throw new Error(`body scroll-width (${scrollWidth}) exceeds viewport width (${clientWidth})`);
  }
}

async function assertWithinViewport(page: Page, testId: string) {
  const locator = page.getByTestId(testId);
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box) throw new Error(`${testId} has no layout box`);
  if (!viewport) throw new Error("viewport is unavailable");
  if (box.x < -1) throw new Error(`${testId} left edge is outside viewport: ${box.x}`);
  if (box.x + box.width > viewport.width + 1) {
    throw new Error(`${testId} right edge ${box.x + box.width} exceeds viewport width ${viewport.width}`);
  }
}

async function assertNoClippedControlText(page: Page, rootTestId: string) {
  const clipped = await page.getByTestId(rootTestId).evaluate((root) => {
    const candidates = Array.from(root.querySelectorAll<HTMLElement>("button, a, input, [role='button'], [data-radix-select-trigger]"));
    return candidates
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const text = element.textContent?.trim() || element.getAttribute("placeholder") || element.getAttribute("aria-label") || "";
        return text.length > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      .map((element) => element.textContent?.trim() || element.getAttribute("placeholder") || element.getAttribute("aria-label") || element.tagName)
      .slice(0, 5);
  });
  if (clipped.length > 0) {
    throw new Error(`${rootTestId} has clipped control text: ${clipped.join(", ")}`);
  }
}

async function waitForAnimationsToSettle(page: Page, testId: string) {
  await page.waitForFunction((targetTestId) => {
    const target = document.querySelector(`[data-testid="${targetTestId}"]`);
    if (!target) return false;
    return target.getAnimations({ subtree: true }).every((animation) =>
      animation.playState === "finished" || animation.playState === "idle",
    );
  }, testId);
}

test.describe("frontend redesign desktop fit", () => {
  test("[desktop-fit-dashboard-A]: validate holdings and quick actions -> stay visible without clipping", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/dashboard");
    await page.getByTestId("dashboard-holdings-section").waitFor({ state: "visible" });

    await assertWithinViewport(page, "dashboard-holdings-section");
    await assertNoClippedControlText(page, "dashboard-holdings-section");
    await page.getByTestId("floating-quick-actions-trigger").click();
    await waitForAnimationsToSettle(page, "floating-quick-actions-sheet");
    await assertWithinViewport(page, "floating-quick-actions-sheet");
    await assertNoClippedControlText(page, "floating-quick-actions-sheet");
    await assertNoBodyOverflow(page);
  });

  test("[desktop-fit-portfolio-A]: validate holdings table controls -> stay visible without clipping", async ({
    appShell,
    e2eUserId,
    page,
  }) => {
    const ticker = "6893";
    await seedTransactionForUser(e2eUserId, {
      ticker,
      quantity: 8,
      unitPrice: 120,
      tradeDate: "2026-02-04",
    });
    await seedQuoteBars([
      {
        ticker,
        barDate: "2026-05-15",
        open: 150,
        high: 150,
        low: 150,
        close: 150,
        volume: 1000,
      },
    ]);

    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/portfolio");
    await page.getByTestId("portfolio-holdings-section").waitFor({ state: "visible" });
    await page.getByTestId("holdings-table").waitFor({ state: "visible" });

    await assertWithinViewport(page, "portfolio-holdings-section");
    await assertNoClippedControlText(page, "portfolio-holdings-section");
    await assertNoBodyOverflow(page);
  });

  test("[desktop-fit-reports-A]: validate reports holdings cards -> stay visible without clipping", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/reports?tab=portfolio&scope=all&range=1Y");
    await page.getByTestId("reports-page").waitFor({ state: "visible" });
    await page.getByTestId("reports-holdings-table-reports.portfolio.holdings").waitFor({ state: "visible" });

    await assertWithinViewport(page, "reports-page");
    await assertNoClippedControlText(page, "reports-page");
    await assertNoBodyOverflow(page);
  });

  test("[desktop-fit-ticker-A]: validate ticker account breakdown -> stay visible without clipping", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/tickers/2330?marketCode=TW");
    await page.getByTestId("ticker-account-breakdown").waitFor({ state: "visible" });

    await assertWithinViewport(page, "ticker-account-breakdown");
    await assertNoClippedControlText(page, "ticker-account-breakdown");
    await assertNoBodyOverflow(page);
  });

  test("[desktop-fit-sharing-A]: validate sharing route shell -> stay visible without clipping", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/sharing");
    await page.getByRole("heading", { name: /sharing/i }).waitFor({ state: "visible" });

    await assertNoBodyOverflow(page);
  });
});
