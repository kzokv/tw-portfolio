import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

test("desktop shell supports collapse persistence and route navigation", async ({
  appShell,
  portfolio,
  transactions,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await portfolio.actions.navigateToPortfolio();
  await portfolio.assert.portfolioIntroIsVisible();

  await appShell.assert.desktopSidebarIsVisible();
  await appShell.assert.desktopSidebarCollapsedStateIs(false);
  await appShell.assert.desktopNavToggleIsVisible();

  await appShell.actions.toggleDesktopSidebar();
  await appShell.assert.desktopSidebarCollapsedStateIs(true);

  await appShell.actions.reloadPage();
  await appShell.assert.desktopSidebarCollapsedStateIs(true);

  await appShell.actions.navigateViaSidebar("portfolio");
  await appShell.assert.isOnRoute(/\/portfolio$/);
  await appShell.assert.appIsReady();
  await portfolio.assert.portfolioIntroIsVisible();
  await appShell.assert.sidebarLinkIsCurrent("portfolio");

  await appShell.actions.toggleDesktopSidebar();
  await appShell.assert.desktopSidebarCollapsedStateIs(false);

  await appShell.actions.navigateViaSidebar("transactions");
  await appShell.assert.isOnRoute(/\/transactions$/);
  await appShell.assert.appIsReady();
  await transactions.assert.introIsVisible();
  await appShell.assert.sidebarLinkIsCurrent("transactions");
});

test("desktop quick search navigates to routes and ticker detail without icon overlap", async ({
  appShell,
  ticker,
}) => {
  await appShell.actions.setViewport(1440, 960);
  await appShell.actions.navigateToRoute("/transactions");

  await appShell.assert.desktopSearchPaddingLeftAtLeast(48);

  await appShell.actions.fillDesktopSearch("portfolio");
  await appShell.assert.searchResultsAreVisible();
  await appShell.actions.clickQuickSearchRoute("portfolio", "desktop");
  await appShell.assert.isOnRoute(/\/portfolio$/);
  await appShell.assert.appIsReady();

  await appShell.actions.fillDesktopSearch("2330");
  await appShell.assert.searchResultsAreVisible();
  await appShell.assert.quickSearchTickerIsVisible("2330");
  await appShell.actions.clickQuickSearchTicker("2330");
  await appShell.assert.isOnRoute(/\/tickers\/2330$/);
  await ticker.assert.titleContains("2330");
});

test("mobile drawer and mobile quick search stay usable without horizontal overflow", async ({
  appShell,
  transactions,
}) => {
  await appShell.actions.setViewport(390, 844);
  await appShell.actions.navigateToRoute("/transactions");

  await appShell.assert.mobileNavToggleIsVisible();
  await appShell.assert.mobileSearchButtonIsVisible();

  await appShell.actions.openMobileSearch();
  await appShell.assert.mobileSearchSheetIsVisible();
  await appShell.actions.fillMobileSearch("transactions");
  await appShell.actions.clickQuickSearchRoute("transactions", "mobile");

  await appShell.assert.isOnRoute(/\/transactions$/);
  await appShell.assert.appIsReady();
  await transactions.assert.introIsVisible();

  await appShell.actions.openMobileNavigation();
  await appShell.actions.navigateViaMobileSidebar("portfolio");
  await appShell.assert.isOnRoute(/\/portfolio/);
  await appShell.assert.appIsReady();
  await appShell.assert.documentHasNoHorizontalOverflow();
});
