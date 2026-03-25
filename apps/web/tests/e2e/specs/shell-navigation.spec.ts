import { test, expect } from "../fixtures/test";
import { gotoRoute, openMobileNavigation, reloadRoute, waitForAppReady } from "../helpers/flows";

// These flows all cold-start the same shell surfaces and are flaky under parallel
// first-load contention against the dev web/api servers used by Playwright.
test.describe.configure({ mode: "serial" });

test("desktop shell supports collapse persistence and route navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await gotoRoute(page, "/portfolio");
  await expect(page.getByTestId("portfolio-intro")).toBeVisible();

  const desktopSidebar = page.getByTestId("desktop-sidebar");
  await expect(desktopSidebar).toBeVisible();
  await expect(desktopSidebar).toHaveAttribute("data-collapsed", "false");
  await expect(page.getByTestId("desktop-nav-toggle")).toBeVisible();

  await page.getByTestId("desktop-nav-toggle").click();
  await expect(desktopSidebar).toHaveAttribute("data-collapsed", "true");

  await reloadRoute(page);
  await expect(desktopSidebar).toHaveAttribute("data-collapsed", "true");

  await desktopSidebar.getByTestId("sidebar-link-portfolio").click();
  await expect(page).toHaveURL(/\/portfolio$/);
  await waitForAppReady(page);
  await expect(page.getByTestId("portfolio-intro")).toBeVisible();
  await expect(desktopSidebar.getByTestId("sidebar-link-portfolio")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("desktop-nav-toggle").click();
  await expect(desktopSidebar).toHaveAttribute("data-collapsed", "false");
  // Wait for the link to be visible — the sidebar DOM structure changes during collapse/expand
  // (links move in/out of Tooltip.Trigger wrappers), so we must wait for stability before clicking.
  await expect(desktopSidebar.getByTestId("sidebar-link-transactions")).toBeVisible();

  await desktopSidebar.getByTestId("sidebar-link-transactions").click();
  await expect(page).toHaveURL(/\/transactions$/);
  await waitForAppReady(page);
  await expect(page.getByTestId("transactions-intro")).toBeVisible();
  await expect(desktopSidebar.getByTestId("sidebar-link-transactions")).toHaveAttribute("aria-current", "page");
});

test("desktop quick search navigates to routes and symbol detail without icon overlap", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await gotoRoute(page, "/transactions");

  const searchInput = page.getByTestId("topbar-search");
  const desktopResults = page.getByTestId("topbar-search-results");
  const paddingLeft = await searchInput.evaluate((input) => Number.parseFloat(getComputedStyle(input).paddingLeft));
  expect(paddingLeft).toBeGreaterThanOrEqual(48);

  await searchInput.fill("portfolio");
  await expect(desktopResults).toBeVisible();
  await desktopResults.getByTestId("quick-search-item-route-portfolio").click();
  await expect(page).toHaveURL(/\/portfolio$/);
  await waitForAppReady(page);

  await page.getByTestId("topbar-search").fill("2330");
  await expect(desktopResults).toBeVisible();
  const symbolButton = desktopResults.getByRole("button", { name: /2330/ });
  await expect(symbolButton).toBeVisible();
  await symbolButton.click();
  await expect(page).toHaveURL(/\/tickers\/2330$/, { timeout: 15_000 });
  await expect(page.getByTestId("symbol-history-title")).toContainText("2330", { timeout: 15_000 });
});

test("mobile drawer and mobile quick search stay usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoRoute(page, "/transactions");

  await expect(page.getByTestId("mobile-nav-toggle")).toBeVisible();
  await expect(page.getByTestId("topbar-search-button")).toBeVisible();

  await page.getByTestId("topbar-search-button").click();
  await expect(page.getByTestId("topbar-search-sheet")).toBeVisible();
  await page.getByTestId("topbar-search-sheet-input").fill("transactions");
  await page.getByTestId("quick-search-item-route-transactions").click();

  await expect(page).toHaveURL(/\/transactions$/);
  await waitForAppReady(page);
  await expect(page.getByTestId("transactions-intro")).toBeVisible();

  await openMobileNavigation(page);
  await page.getByTestId("mobile-sidebar").getByTestId("sidebar-link-portfolio").click();
  await expect(page).toHaveURL(/\/portfolio/);
  await waitForAppReady(page);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
});
