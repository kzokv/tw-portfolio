import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

test("[reports-realized-pnl-A]: report drilldown route opens filtered transaction history with preserved returnTo", async ({
  appShell,
  page,
}) => {
  const drilldownPath = "/transactions?type=SELL&pnl=realized&marketCode=AU&from=2026-05-21&to=2026-06-21&returnTo=%2Freports%3Ftab%3Ddaily-review%26scope%3DAU%26range%3D1M";

  await appShell.actions.setViewport(1440, 960);
  await page.goto(new URL(drilldownPath, TestEnv.appBaseUrl).href, { waitUntil: "domcontentloaded" });
  await page.getByTestId("transaction-history-browser").waitFor({ state: "visible" });

  const url = new URL(page.url());
  await appShell.assert.mxAssertEqual(url.pathname, "/transactions", "drilldown pathname");
  await appShell.assert.mxAssertEqual(url.searchParams.get("type"), "SELL", "drilldown type filter");
  await appShell.assert.mxAssertEqual(url.searchParams.get("pnl"), "realized", "drilldown pnl filter");
  await appShell.assert.mxAssertEqual(url.searchParams.get("marketCode"), "AU", "drilldown market scope");
  await appShell.assert.mxAssertEqual(url.searchParams.get("from"), "2026-05-21", "drilldown from date");
  await appShell.assert.mxAssertEqual(url.searchParams.get("to"), "2026-06-21", "drilldown to date");
  await appShell.assert.mxAssertEqual(
    url.searchParams.get("returnTo"),
    "/reports?tab=daily-review&scope=AU&range=1M",
    "drilldown returnTo",
  );
  await appShell.assert.mxAssertEqual(
    await page.getByTestId("transaction-history-back-link").getAttribute("href"),
    "/reports?tab=daily-review&scope=AU&range=1M",
    "back-to-report link",
  );
  await page.getByTestId("transaction-history-active-chips").waitFor({ state: "visible" });
});
