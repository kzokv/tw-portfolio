import { test, expect } from "../fixtures/test";
import { gotoRoute, openMobileNavigation, waitForAppReady } from "../helpers/flows";

test("desktop shell supports collapse persistence and route navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await gotoRoute(page, "/");

  await expect(page.getByTestId("dashboard-performance-card")).toBeVisible();
  await expect(page.getByTestId("dashboard-allocation-card")).toBeVisible();
  await page.getByTestId("dashboard-performance-range-3m").click();
  await expect(page.getByTestId("dashboard-performance-card")).toContainText(/Portfolio Trend|投資組合走勢/);

  const desktopSidebar = page.getByTestId("desktop-sidebar");
  await expect(desktopSidebar).toBeVisible();
  await expect(desktopSidebar).toHaveAttribute("data-collapsed", "false");
  await expect(page.getByTestId("desktop-nav-toggle")).toBeVisible();

  await page.getByTestId("desktop-nav-toggle").click();
  await expect(desktopSidebar).toHaveAttribute("data-collapsed", "true");

  await page.reload();
  await waitForAppReady(page);
  await expect(desktopSidebar).toHaveAttribute("data-collapsed", "true");

  await desktopSidebar.getByTestId("sidebar-link-portfolio").click();
  await expect(page).toHaveURL(/\/portfolio$/);
  await waitForAppReady(page);
  await expect(page.getByTestId("portfolio-intro")).toBeVisible();
  await expect(desktopSidebar.getByTestId("sidebar-link-portfolio")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("desktop-nav-toggle").click();
  await expect(desktopSidebar).toHaveAttribute("data-collapsed", "false");

  await desktopSidebar.getByTestId("sidebar-link-transactions").click();
  await expect(page).toHaveURL(/\/transactions$/);
  await waitForAppReady(page);
  await expect(page.getByTestId("transactions-intro")).toBeVisible();
  await expect(desktopSidebar.getByTestId("sidebar-link-transactions")).toHaveAttribute("aria-current", "page");
});

test("desktop quick search navigates to routes and symbol detail without icon overlap", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await gotoRoute(page, "/");

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
  await desktopResults.getByRole("button", { name: /2330/ }).click();
  await expect(page).toHaveURL(/\/symbols\/2330$/);
  await expect(page.getByTestId("symbol-history-title")).toContainText("2330");
});

test("mobile drawer and mobile quick search stay usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoRoute(page, "/");

  await expect(page.getByTestId("mobile-nav-toggle")).toBeVisible();
  await expect(page.getByTestId("topbar-search-button")).toBeVisible();

  await page.getByTestId("topbar-search-button").click();
  await expect(page.getByTestId("topbar-search-sheet")).toBeVisible();
  await page.getByTestId("topbar-search-sheet-input").fill("transactions");
  await page.getByRole("button", { name: /Transactions|交易/ }).click();

  await expect(page).toHaveURL(/\/transactions$/);
  await waitForAppReady(page);
  await expect(page.getByTestId("transactions-intro")).toBeVisible();

  await openMobileNavigation(page);
  await page.getByTestId("mobile-sidebar").getByTestId("sidebar-link-dashboard").click();
  await expect(page).toHaveURL(/\/$/);
  await waitForAppReady(page);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
});
