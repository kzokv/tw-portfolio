import type { Locator, Page } from "@playwright/test";
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

async function seedDesktopFitHolding(e2eUserId: string, ticker: string) {
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
}

async function assertStickyHoldingsTable(table: Locator, label: string) {
  await table.waitFor({ state: "visible" });
  await table.locator("thead th").first().waitFor({ state: "visible" });
  await table.locator("tbody tr > :first-child").first().waitFor({ state: "visible" });
  const stickyState = await table.evaluate((tableElement) => {
    const frame = tableElement.parentElement as HTMLElement | null;
    const firstHeader = tableElement.querySelector<HTMLElement>("thead th");
    const firstBodyCell = tableElement.querySelector<HTMLElement>("tbody tr > :first-child");
    if (!frame || !firstHeader || !firstBodyCell) {
      return {
        missing: {
          frame: !frame,
          firstHeader: !firstHeader,
          firstBodyCell: !firstBodyCell,
        },
      };
    }

    const headerBeforeTop = firstHeader.getBoundingClientRect().top;
    const firstBodyBeforeLeft = firstBodyCell.getBoundingClientRect().left;
    frame.scrollTop = Math.min(72, Math.max(0, frame.scrollHeight - frame.clientHeight));
    frame.scrollLeft = Math.min(72, Math.max(0, frame.scrollWidth - frame.clientWidth));

    const frameStyle = window.getComputedStyle(frame);
    const headerStyle = window.getComputedStyle(firstHeader);
    const firstBodyStyle = window.getComputedStyle(firstBodyCell);
    return {
      missing: null,
      frameOverflowX: frameStyle.overflowX,
      frameOverflowY: frameStyle.overflowY,
      frameScrollLeft: frame.scrollLeft,
      frameScrollTop: frame.scrollTop,
      headerPosition: headerStyle.position,
      headerTop: headerStyle.top,
      headerTopDelta: firstHeader.getBoundingClientRect().top - headerBeforeTop,
      firstBodyLeft: firstBodyStyle.left,
      firstBodyLeftDelta: firstBodyCell.getBoundingClientRect().left - firstBodyBeforeLeft,
      firstBodyPosition: firstBodyStyle.position,
    };
  });

  if (stickyState.missing) {
    throw new Error(`${label} missing sticky targets: ${JSON.stringify(stickyState.missing)}`);
  }
  if (stickyState.headerPosition !== "sticky" || stickyState.headerTop !== "0px") {
    throw new Error(`${label} header is not sticky at top: ${JSON.stringify(stickyState)}`);
  }
  if (stickyState.firstBodyPosition !== "sticky" || stickyState.firstBodyLeft !== "0px") {
    throw new Error(`${label} first column is not sticky at left: ${JSON.stringify(stickyState)}`);
  }
  if (!["auto", "scroll"].includes(stickyState.frameOverflowY)) {
    throw new Error(`${label} frame is not vertically scrollable when needed: ${JSON.stringify(stickyState)}`);
  }
  if (stickyState.frameScrollLeft > 0 && Math.abs(stickyState.firstBodyLeftDelta) > 1) {
    throw new Error(`${label} first column moved during horizontal scroll: ${JSON.stringify(stickyState)}`);
  }
}

test.describe("frontend redesign desktop fit", () => {
  test("[desktop-fit-dashboard-A]: validate holdings and quick actions -> stay visible without clipping", async ({
    appShell,
    e2eUserId,
    page,
  }) => {
    await seedDesktopFitHolding(e2eUserId, "6891");

    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/dashboard");
    await page.getByTestId("dashboard-holdings-section").waitFor({ state: "visible" });

    await assertStickyHoldingsTable(page.getByTestId("dashboard-holdings-section").locator("table").first(), "dashboard holdings");
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
    await seedDesktopFitHolding(e2eUserId, ticker);

    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/portfolio");
    await page.getByTestId("portfolio-holdings-section").waitFor({ state: "visible" });
    await page.getByTestId("holdings-table").waitFor({ state: "visible" });

    await assertStickyHoldingsTable(page.getByTestId("holdings-table"), "portfolio holdings");
    await assertWithinViewport(page, "portfolio-holdings-section");
    await assertNoClippedControlText(page, "portfolio-holdings-section");
    await assertNoBodyOverflow(page);
  });

  test("[desktop-fit-reports-A]: validate reports holdings cards -> stay visible without clipping", async ({
    appShell,
    e2eUserId,
    page,
  }) => {
    await seedDesktopFitHolding(e2eUserId, "6895");

    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/reports?tab=portfolio&scope=all&range=1Y");
    await page.getByTestId("reports-page").waitFor({ state: "visible" });
    await page.getByTestId("reports-holdings-table-reports.portfolio.holdings").waitFor({ state: "visible" });

    await assertStickyHoldingsTable(page.getByTestId("reports-holdings-table-reports.portfolio.holdings"), "reports holdings");
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
