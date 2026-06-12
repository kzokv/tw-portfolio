import { test } from "@vakwen/test-e2e/fixtures/appPages";

test.describe("portfolio and ticker follow-up controls", () => {
  test("[portfolio-style-A]: holdings style switches between Portfolio Holdings and Dashboard Top Holdings", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/portfolio");
    await appShell.assert.appIsReady();

    const styleControl = page.getByTestId("portfolio-holdings-style-control");
    await styleControl.waitFor({ state: "visible" });

    await appShell.assert.mxAssertEqual(
      await styleControl.getByTestId("portfolio-holdings-style-portfolio").getAttribute("data-state"),
      "on",
      "Portfolio Holdings is the default style",
    );
    await page.getByTestId("portfolio-holdings-section").waitFor({ state: "visible" });

    await styleControl.getByTestId("portfolio-holdings-style-dashboard").click();
    await appShell.assert.mxAssertEqual(
      await styleControl.getByTestId("portfolio-holdings-style-dashboard").getAttribute("data-state"),
      "on",
      "Dashboard Top Holdings style is selected",
    );
    await page.getByTestId("dashboard-holdings-preview").waitFor({ state: "visible" });

    await styleControl.getByTestId("portfolio-holdings-style-portfolio").click();
    await appShell.assert.mxAssertEqual(
      await styleControl.getByTestId("portfolio-holdings-style-portfolio").getAttribute("data-state"),
      "on",
      "Portfolio Holdings style is selected",
    );
    await page.getByTestId("portfolio-holdings-section").waitFor({ state: "visible" });
  });

  test("[ticker-range-A]: custom ticker range writes URL state and rejects ranges over ten years", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.setViewport(1440, 960);
    await appShell.actions.navigateToRoute("/tickers/2330");
    await appShell.assert.appIsReady();

    const rangeControls = page.getByTestId("ticker-chart-range-controls");
    await rangeControls.waitFor({ state: "visible" });
    await rangeControls.getByRole("button", { name: "Custom" }).click();

    const customRange = page.getByTestId("ticker-chart-custom-range");
    await customRange.waitFor({ state: "visible" });
    await customRange.getByLabel("Start date").fill("2025-01-01");
    await customRange.getByLabel("End date").fill("2025-06-30");
    await customRange.getByRole("button", { name: "Apply" }).click();

    await page.waitForURL(/chartRange=CUSTOM/);
    await appShell.assert.mxAssertEqual(
      new URL(page.url()).searchParams.get("chartStart"),
      "2025-01-01",
      "custom chart start is reflected in the URL",
    );
    await appShell.assert.mxAssertEqual(
      new URL(page.url()).searchParams.get("chartEnd"),
      "2025-06-30",
      "custom chart end is reflected in the URL",
    );

    await customRange.getByLabel("Start date").fill("2010-01-01");
    await customRange.getByLabel("End date").fill("2025-06-30");
    await customRange.getByRole("button", { name: "Apply" }).click();
    const customRangeError = page.getByText(/custom range within 10 years/i);
    await customRangeError.waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(
      await customRangeError.isVisible(),
      true,
      "custom range over 10 years shows validation error",
    );
  });
});
