import { test } from "@vakwen/test-e2e/fixtures/appPages";

async function assertStickyTopbarAcrossRoutes(
  goToRoute: Array<{ label: string; goto: () => Promise<void> }>,
  appShell: {
    assert: {
      topBarIsPinnedToViewport: (maxOffset?: number) => Promise<void>;
      topBarRemainsStickyAfterMainScroll: () => Promise<void>;
    };
  },
): Promise<void> {
  for (const route of goToRoute) {
    await test.step(route.label, async () => {
      await route.goto();
      await appShell.assert.topBarIsPinnedToViewport();
      await appShell.assert.topBarRemainsStickyAfterMainScroll();
    });
  }
}

test("[sticky-topbar]: desktop scroll on dashboard, ticker, dividends → top bar stays pinned", async ({
  appShell,
  dividends,
  ticker,
}) => {
  await appShell.actions.setViewport(1440, 900);

  await assertStickyTopbarAcrossRoutes(
    [
      { label: "dashboard", goto: () => appShell.actions.navigateToRoute("/dashboard") },
      { label: "ticker-2330", goto: () => ticker.actions.navigateToTicker("2330") },
      { label: "dividends", goto: () => dividends.actions.navigateToCalendar() },
    ],
    appShell,
  );
});

test("[sticky-topbar]: mobile scroll on dashboard, ticker, dividends → top bar stays pinned", async ({
  appShell,
  dividends,
  ticker,
}) => {
  await appShell.actions.setViewport(390, 844);

  await assertStickyTopbarAcrossRoutes(
    [
      { label: "dashboard", goto: () => appShell.actions.navigateToRouteForResponsiveTest("/dashboard") },
      { label: "ticker-2330", goto: () => ticker.actions.navigateToTicker("2330") },
      { label: "dividends", goto: () => dividends.actions.navigateToCalendar() },
    ],
    appShell,
  );
});
